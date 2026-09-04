'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { District, OwnerPropertyDetail } from '@/lib/api';
import { PhotoUploader } from './photo-uploader';
import { DiagnosticsUploader } from './diagnostics-uploader';
import {
  createDraft,
  submitForReview,
  updateDraft,
  type ApiFailure,
  type PropertyDraft,
} from '@/lib/owner-client';

const ENERGY = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

const CONTRACTS = [
  { value: 'CDI', label: 'CDI' },
  { value: 'PUBLIC_SECTOR', label: 'Fonction publique' },
  { value: 'STUDENT', label: 'Étudiant avec garant' },
  { value: 'CDD', label: 'CDD' },
  { value: 'SELF_EMPLOYED', label: 'Indépendant' },
  { value: 'RETIRED', label: 'Retraité' },
];

const GUARANTOR = [
  { value: 'REQUIRED', label: 'Exigé' },
  { value: 'OPTIONAL', label: 'Facultatif' },
  { value: 'NONE', label: 'Non demandé' },
];

/** Les montants circulent en centimes ; le formulaire saisit des euros. */
const toEuros = (cents: number | null | undefined) =>
  cents === null || cents === undefined || cents === 0 ? '' : String(Math.round(cents / 100));
const toCents = (value: string) => {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
};
const toNumber = (value: string) => {
  const n = Number(value);
  return value !== '' && Number.isFinite(n) ? n : undefined;
};

interface FormState {
  title: string;
  addressLine: string;
  districtSlug: string;
  rooms: string;
  surfaceM2: string;
  floor: string;
  rent: string;
  charges: string;
  furnished: boolean;
  energyRating: string;
  gesRating: string;
  availableFrom: string;
  description: string;
  guarantorRequirement: string;
  acceptedContractTypes: string[];
}

function initialState(property: OwnerPropertyDetail | null, districts: District[]): FormState {
  return {
    title: property && property.title !== 'Nouveau bien' ? property.title : '',
    addressLine: property?.addressLine ?? '',
    districtSlug: property?.districtSlug ?? districts[0]?.slug ?? '',
    rooms: property?.rooms ? String(property.rooms) : '',
    surfaceM2: property?.surfaceM2 ? String(property.surfaceM2) : '',
    floor: property?.floor ?? '',
    rent: toEuros(property?.rentCents),
    charges: toEuros(property?.chargesCents),
    furnished: property?.furnished ?? false,
    energyRating: property?.energyRating ?? '',
    gesRating: property?.gesRating ?? '',
    // L'input date attend `AAAA-MM-JJ` ; l'API renvoie un ISO complet.
    availableFrom: property?.availableFrom ? property.availableFrom.slice(0, 10) : '',
    description: property?.description ?? '',
    guarantorRequirement: property?.guarantorRequirement ?? 'REQUIRED',
    acceptedContractTypes: property?.acceptedContractTypes ?? ['CDI', 'PUBLIC_SECTOR'],
  };
}

/**
 * Formulaire de dépôt d'annonce.
 *
 * Un même composant sert la création et la modification : à la première
 * sauvegarde sans référence, il crée le brouillon puis remplace l'URL par celle
 * du bien. Le propriétaire peut ainsi enregistrer un travail incomplet et y
 * revenir, comme le montre la maquette.
 */
export function PropertyForm({
  property,
  districts,
}: {
  property: OwnerPropertyDetail | null;
  districts: District[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initialState(property, districts));
  const [reference, setReference] = useState(property?.reference ?? null);
  const [pending, setPending] = useState<'save' | 'submit' | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [saved, setSaved] = useState(false);

  const readOnly = property !== null && property.status !== 'DRAFT';

  const set =
    <K extends keyof FormState>(field: K) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const target = event.target;
      const value =
        target instanceof HTMLInputElement && target.type === 'checkbox'
          ? target.checked
          : target.value;
      setForm((current) => ({ ...current, [field]: value as FormState[K] }));
      setSaved(false);
    };

  const toggleContract = (value: string) => {
    setForm((current) => ({
      ...current,
      acceptedContractTypes: current.acceptedContractTypes.includes(value)
        ? current.acceptedContractTypes.filter((entry) => entry !== value)
        : [...current.acceptedContractTypes, value],
    }));
    setSaved(false);
  };

  /** N'envoie que ce qui est renseigné : un brouillon peut rester incomplet. */
  const toPayload = (): PropertyDraft => ({
    ...(form.title ? { title: form.title } : {}),
    description: form.description,
    addressLine: form.addressLine,
    districtSlug: form.districtSlug,
    ...(toNumber(form.rooms) !== undefined ? { rooms: toNumber(form.rooms) } : {}),
    ...(toNumber(form.surfaceM2) !== undefined
      ? { surfaceM2: toNumber(form.surfaceM2) }
      : {}),
    floor: form.floor,
    ...(toCents(form.rent) !== undefined ? { rentCents: toCents(form.rent) } : {}),
    ...(toCents(form.charges) !== undefined ? { chargesCents: toCents(form.charges) } : {}),
    furnished: form.furnished,
    ...(form.energyRating ? { energyRating: form.energyRating } : {}),
    ...(form.gesRating ? { gesRating: form.gesRating } : {}),
    availableFrom: form.availableFrom,
    guarantorRequirement: form.guarantorRequirement,
    acceptedContractTypes: form.acceptedContractTypes,
  });

  const save = async (): Promise<string | null> => {
    setPending('save');
    setError(null);
    try {
      const payload = toPayload();
      const result = reference
        ? await updateDraft(reference, payload)
        : await createDraft(payload);

      setReference(result.reference);
      setSaved(true);
      // L'URL suit le brouillon créé : recharger la page ne repart plus de zéro.
      if (!reference) {
        window.history.replaceState(null, '', `/proprietaires/biens/${result.reference}`);
      }
      router.refresh();
      return result.reference;
    } catch (failure) {
      setError(failure as ApiFailure);
      return null;
    } finally {
      setPending(null);
    }
  };

  const submit = async () => {
    const ref = reference ?? (await save());
    if (!ref) return;

    setPending('submit');
    setError(null);
    try {
      // On enregistre d'abord : soumettre un formulaire modifié mais non
      // sauvegardé contrôlerait l'ancienne version.
      await updateDraft(ref, toPayload());
      await submitForReview(ref);
      router.push('/proprietaires/biens');
      router.refresh();
    } catch (failure) {
      setError(failure as ApiFailure);
      setPending(null);
    }
  };

  return (
    <div className="split mt-24">
      <div>
        <h2 className="h mb-12">Le bien</h2>
        <div className="panel" style={{ padding: '19px 20px' }}>
          <div className="form form--2">
            <label className="field form__full">
              <span className="label label--ink">Titre de l’annonce</span>
              <input
                className="field__box"
                value={form.title}
                onChange={set('title')}
                placeholder="2 pièces meublé, Outre-Seille"
                disabled={readOnly}
              />
            </label>

            <label className="field form__full">
              <span className="label label--ink">Adresse</span>
              <input
                className="field__box"
                value={form.addressLine}
                onChange={set('addressLine')}
                placeholder="11 rue Mazelle"
                disabled={readOnly}
              />
            </label>

            <label className="field">
              <span className="label label--ink">Quartier</span>
              <select
                className="field__box"
                value={form.districtSlug}
                onChange={set('districtSlug')}
                disabled={readOnly}
              >
                {districts.map((district) => (
                  <option key={district.slug} value={district.slug}>
                    {district.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="label label--ink">Nombre de pièces</span>
              <input
                className="field__box"
                type="number"
                min={1}
                value={form.rooms}
                onChange={set('rooms')}
                disabled={readOnly}
              />
            </label>

            <label className="field">
              <span className="label label--ink">Surface habitable (m²)</span>
              <input
                className="field__box"
                type="number"
                min={1}
                value={form.surfaceM2}
                onChange={set('surfaceM2')}
                disabled={readOnly}
              />
            </label>

            <label className="field">
              <span className="label label--ink">Étage</span>
              <input
                className="field__box"
                value={form.floor}
                onChange={set('floor')}
                placeholder="2 / 4"
                disabled={readOnly}
              />
            </label>

            <label className="field">
              <span className="label label--ink">Loyer hors charges (€)</span>
              <input
                className="field__box"
                type="number"
                min={0}
                value={form.rent}
                onChange={set('rent')}
                disabled={readOnly}
              />
            </label>

            <label className="field">
              <span className="label label--ink">Provision sur charges (€)</span>
              <input
                className="field__box"
                type="number"
                min={0}
                value={form.charges}
                onChange={set('charges')}
                disabled={readOnly}
              />
            </label>

            <label className="field">
              <span className="label label--ink">Ameublement</span>
              <select
                className="field__box"
                value={form.furnished ? 'true' : 'false'}
                onChange={(event) => {
                  setForm((c) => ({ ...c, furnished: event.target.value === 'true' }));
                  setSaved(false);
                }}
                disabled={readOnly}
              >
                <option value="false">Non meublé</option>
                <option value="true">Meublé</option>
              </select>
              <span className="field__hint">
                Détermine la durée du bail : 3 ans si nu, 1 an si meublé.
              </span>
            </label>

            <label className="field">
              <span className="label label--ink">Disponible à partir du</span>
              <input
                className="field__box"
                type="date"
                value={form.availableFrom}
                onChange={set('availableFrom')}
                disabled={readOnly}
              />
              <span className="field__hint">Vide = disponible immédiatement.</span>
            </label>

            <label className="field form__full">
              <span className="label label--ink">Description</span>
              <textarea
                className="field__box"
                value={form.description}
                onChange={set('description')}
                disabled={readOnly}
              />
              <span className="field__hint">
                Le contrôle Bail vérifie la cohérence avec les diagnostics.
              </span>
            </label>
          </div>
        </div>

        <h2 className="h mt-32 mb-12">Photos</h2>
        <PhotoUploader
          reference={reference}
          photos={property?.photos ?? []}
          readOnly={readOnly}
        />

        <h2 className="h mt-32 mb-12">Diagnostics</h2>
        <div className="panel" style={{ padding: '19px 20px' }}>
          <div className="form form--2">
            <label className="field">
              <span className="label label--ink">Classe DPE</span>
              <select
                className="field__box"
                value={form.energyRating}
                onChange={set('energyRating')}
                disabled={readOnly}
              >
                <option value="">Non renseignée</option>
                {ENERGY.map((letter) => (
                  <option key={letter} value={letter}>
                    {letter}
                  </option>
                ))}
              </select>
              <span className="field__hint">Obligatoire pour diffuser l’annonce.</span>
            </label>

            <label className="field">
              <span className="label label--ink">Classe GES</span>
              <select
                className="field__box"
                value={form.gesRating}
                onChange={set('gesRating')}
                disabled={readOnly}
              >
                <option value="">Non renseignée</option>
                {ENERGY.map((letter) => (
                  <option key={letter} value={letter}>
                    {letter}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="p-sm mt-16">
            La classe affichée sur l’annonce est saisie ici ; le fichier du diagnostic
            se dépose ci-dessous. Les deux sont nécessaires : l’agent qui contrôle
            vérifie que la classe correspond bien au document.
          </p>
        </div>

        <div className="mt-16">
          <DiagnosticsUploader
            reference={reference}
            documents={property?.documents ?? []}
            readOnly={readOnly}
          />
        </div>

        <h2 className="h mt-32 mb-12">Critères de sélection</h2>
        <div className="panel" style={{ padding: '19px 20px' }}>
          <label className="field" style={{ maxWidth: 280 }}>
            <span className="label label--ink">Garant</span>
            <select
              className="field__box"
              value={form.guarantorRequirement}
              onChange={set('guarantorRequirement')}
              disabled={readOnly}
            >
              {GUARANTOR.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-16">
            <span className="label label--ink">Types de contrat acceptés</span>
            <div className="filters__chips mt-8">
              {CONTRACTS.map((contract) => (
                <button
                  key={contract.value}
                  type="button"
                  className="chip"
                  aria-pressed={form.acceptedContractTypes.includes(contract.value)}
                  onClick={() => toggleContract(contract.value)}
                  disabled={readOnly}
                >
                  {contract.label}
                </button>
              ))}
            </div>
          </div>

          <p className="p-sm mt-16">
            Le revenu minimum exigé est calculé à 3 × le loyer charges comprises. Vous
            recevrez le taux d’effort de chaque candidat, jamais ses pièces.
          </p>
        </div>
      </div>

      <aside>
        {/* Motif du dernier renvoi. Il s'affiche là où la correction se fait,
            et non dans une notification qu'on aurait pu manquer : le
            back-office promet au contrôleur qu'il est « transmis au
            propriétaire », la promesse se tient ici. */}
        {property?.reviewNote ? (
          <div className="panel pad mb-16" role="status">
            <span className="label label--accent">Correction demandée</span>
            <p className="p-sm mt-8">{property.reviewNote}</p>
            <p className="field__hint mt-10">
              Corrigez ce point puis soumettez de nouveau votre annonce. Rien n’est
              perdu : votre fiche est conservée telle quelle.
            </p>
          </div>
        ) : null}

        <div className="panel panel--strong tick" style={{ padding: '19px 20px' }}>
          <span className="label label--ink">Avant publication</span>

          {property ? (
            <div className="mt-12">
              {property.blockers.length === 0 && property.warnings.length === 0 ? (
                <span className="badge badge--ok">Prêt à soumettre</span>
              ) : (
                <div className="holding__checks">
                  {property.blockers.map((blocker) => (
                    <span key={blocker} className="badge badge--reject badge--nodot">
                      {blocker}
                    </span>
                  ))}
                  {property.warnings.map((warning) => (
                    <span key={warning} className="badge badge--pending badge--nodot">
                      {warning}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="p-sm mt-8">
              Les contrôles apparaîtront après le premier enregistrement.
            </p>
          )}

          {error ? (
            <div className="auth__error mt-16" role="alert">
              {error.message}
              {error.blockers?.length ? (
                <ul className="mt-8">
                  {error.blockers.map((blocker) => (
                    <li key={blocker}>· {blocker}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {readOnly ? (
            <p className="p-sm mt-16">
              Ce bien est au contrôle et n’est plus modifiable. Retirez-le de la
              publication pour reprendre sa fiche.
            </p>
          ) : (
            <>
              <button
                type="button"
                className="btn btn--ghost btn-block mt-16"
                onClick={save}
                disabled={pending !== null}
              >
                {pending === 'save' ? 'Enregistrement…' : 'Enregistrer le brouillon'}
              </button>

              <button
                type="button"
                className="btn btn-block mt-10"
                onClick={submit}
                disabled={pending !== null}
              >
                {pending === 'submit' ? 'Envoi…' : 'Soumettre au contrôle'}
              </button>

              {saved ? (
                <p className="booking__response mt-10">Brouillon enregistré</p>
              ) : null}

              <p className="field__hint mt-10">
                La mise en ligne est décidée après contrôle des diagnostics et de la
                cohérence — sous 2 h en moyenne.
              </p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
