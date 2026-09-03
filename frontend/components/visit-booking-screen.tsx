'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type {
  BookableSlot,
  VisitBookingView,
  VisitPrerequisite,
  VisitStatus,
  VisitType,
  VisitView,
} from '@/lib/api';
import * as fmt from '@/lib/format';
import { bookVisit, cancelVisit, type VisitFailure } from '@/lib/visits-client';

const TYPES: {
  value: VisitType;
  eyebrow: string;
  title: string;
  text: string;
  tags: string[];
}[] = [
  {
    value: 'ACCOMPANIED',
    eyebrow: 'Sur place',
    title: 'Visite accompagnée',
    text: 'Un agent vous ouvre le logement et répond à vos questions.',
    tags: ['Agent sur place'],
  },
  {
    value: 'VIDEO',
    eyebrow: 'À distance',
    title: 'Visite en visio',
    text: 'Un agent filme en direct et suit vos demandes de cadrage.',
    tags: ['Caméra obligatoire'],
  },
];

const VISIT_STATUS: Record<VisitStatus, { label: string; tone: string }> = {
  REQUESTED: { label: 'Demandé', tone: 'badge badge--pending' },
  PENDING_CHECKS: { label: 'À confirmer', tone: 'badge badge--pending' },
  CONFIRMED: { label: 'Confirmé', tone: 'badge badge--ok' },
  IN_PROGRESS: { label: 'En cours', tone: 'badge badge--ok' },
  COMPLETED: { label: 'Effectué', tone: 'badge badge--mute' },
  CANCELLED: { label: 'Annulé', tone: 'badge badge--mute' },
  NO_SHOW: { label: 'Non honoré', tone: 'badge badge--reject' },
};

const PREREQ_TONE: Record<VisitPrerequisite['state'], string> = {
  ok: 'badge badge--ok',
  pending: 'badge badge--pending',
  info: 'badge badge--mute',
};

const PREREQ_LABEL: Record<VisitPrerequisite['state'], string> = {
  ok: 'Validée',
  pending: 'À faire',
  info: 'Information',
};

/** Regroupe les créneaux par jour, comme les colonnes du planning. */
function byDay(slots: BookableSlot[]): { key: string; label: string; slots: BookableSlot[] }[] {
  const days = new Map<string, BookableSlot[]>();
  for (const slot of slots) {
    const key = slot.startsAt.slice(0, 10);
    days.set(key, [...(days.get(key) ?? []), slot]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entries]) => ({
      key,
      label: fmt.dayHeading(entries[0].startsAt),
      slots: entries,
    }));
}

/**
 * Prise de rendez-vous de visite — écran 5.
 *
 * MVP v0 : visite accompagnée ou visio, jamais de visite autonome par boîtier
 * connecté (CLAUDE.md règle 1).
 */
export function VisitBookingScreen({
  reference,
  initial,
  visits,
}: {
  reference: string;
  initial: VisitBookingView;
  visits: VisitView[];
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [type, setType] = useState<VisitType>('ACCOMPANIED');
  const [slotId, setSlotId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<VisitFailure | null>(null);

  const days = useMemo(() => byDay(view.slots), [view.slots]);
  const selected = view.slots.find((slot) => slot.id === slotId) ?? null;
  const blocked = view.blockers.length > 0;

  const submit = async () => {
    if (!slotId) return;
    setPending(true);
    setError(null);
    try {
      setView(await bookVisit(reference, slotId, type));
      setSlotId(null);
      // Le bandeau « Mes visites » vient du rendu serveur : sans ça, le
      // rendez-vous qu'on vient de prendre y manquerait.
      router.refresh();
    } catch (failure) {
      setError(failure as VisitFailure);
    } finally {
      setPending(false);
    }
  };

  const cancel = async () => {
    if (!view.visit) return;
    setPending(true);
    setError(null);
    try {
      await cancelVisit(view.visit.id);
      router.refresh();
      // L'annulation renvoie la liste des visites, pas l'écran de réservation :
      // on le recharge pour retrouver le créneau libéré.
      window.location.reload();
    } catch (failure) {
      setError(failure as VisitFailure);
      setPending(false);
    }
  };

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="page__head">
        <div>
          <span className="label label--accent">
            Visite · {view.property.reference} · {view.property.addressLine}
          </span>
          <h1 className="d3 mt-8">
            {view.visit ? 'Votre rendez-vous' : 'Choisir un créneau'}
          </h1>
        </div>
        {view.applicationStatus === 'SHORTLISTED' ||
        view.applicationStatus === 'VISIT_SCHEDULED' ? (
          <span className="badge badge--ok">Candidature retenue</span>
        ) : null}
      </div>

      <div className="split mt-24">
        <div>
          {blocked && !view.visit ? (
            <div className="panel pad">
              <span className="label label--ink">Rendez-vous indisponible</span>
              <ul className="checklist mt-10">
                {view.blockers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className="flex gap-12 wrap mt-16">
                <Link href={`/biens/${reference}/candidater`} className="btn btn-sm">
                  Voir ma candidature
                </Link>
                <Link href="/dossier" className="link link--accent">
                  Compléter mon dossier →
                </Link>
              </div>
            </div>
          ) : null}

          {!view.visit && !blocked ? (
            <>
              <h2 className="h mb-12">Type de visite</h2>
              <div className="opts">
                {TYPES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="opt"
                    aria-pressed={type === option.value}
                    onClick={() => {
                      setType(option.value);
                      // Un créneau retenu peut ne pas accepter l'autre type :
                      // mieux vaut le relâcher que réserver un rendez-vous
                      // impossible.
                      setSlotId(null);
                    }}
                  >
                    <span className="label label--accent">{option.eyebrow}</span>
                    <div className="opt__t">{option.title}</div>
                    <p className="p-sm">{option.text}</p>
                    <div className="flex gap-8 wrap mt-12">
                      <span className="badge badge--mute badge--nodot">
                        {view.durations[option.value]} min
                      </span>
                      {option.tags.map((tag) => (
                        <span key={tag} className="badge badge--mute badge--nodot">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>

              <h2 className="h mt-32 mb-12">Créneaux disponibles</h2>
              <div className="days">
                {days.map((day) => (
                  <div key={day.key} className="day">
                    <div className="day__h">{day.label}</div>
                    {day.slots.map((slot) => {
                      const allowed = slot.allowedTypes.includes(type);
                      return (
                        <button
                          key={slot.id}
                          type="button"
                          className="slot"
                          aria-pressed={slotId === slot.id}
                          disabled={!allowed}
                          title={
                            allowed ? undefined : 'Ce créneau n’accepte pas ce type de visite'
                          }
                          onClick={() => setSlotId(slot.id)}
                        >
                          {fmt.timeOfDay(slot.startsAt)}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              <p className="field__hint mt-10">
                Créneaux ouverts par le propriétaire. Annulation possible jusqu’à{' '}
                {view.cancellationDeadlineHours} heures avant le rendez-vous.
              </p>
            </>
          ) : null}

          <h2 className="h mt-32 mb-12">Avant le rendez-vous</h2>
          <div className="panel panel--strong">
            {view.prerequisites.map((prerequisite) => (
              <div key={prerequisite.key} className="doc">
                <div className="doc__head">
                  <div>
                    <div className="doc__n">{prerequisite.label}</div>
                    <div className="doc__m">
                      {prerequisite.blocking ? 'Obligatoire' : 'Pour information'}
                    </div>
                  </div>
                  <div className="doc__c">{prerequisite.detail}</div>
                  <div className="doc__a">
                    <span className={PREREQ_TONE[prerequisite.state]}>
                      {PREREQ_LABEL[prerequisite.state]}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside>
          <div className="panel panel--strong tick">
            <div className="pad" style={{ borderBottom: '1px solid var(--line-softer)' }}>
              <span className="label label--ink">Récapitulatif</span>
              <div className="d3 mt-8">
                {view.visit
                  ? fmt.appointment(view.visit.scheduledAt)
                  : selected
                    ? fmt.appointment(selected.startsAt)
                    : 'Aucun créneau choisi'}
              </div>
              <p className="p-sm mt-6">
                {view.visit
                  ? `${view.visit.type === 'VIDEO' ? 'Visite en visio' : 'Visite accompagnée'} · ${view.visit.durationMinutes} minutes`
                  : `${type === 'VIDEO' ? 'Visite en visio' : 'Visite accompagnée'} · ${view.durations[type]} minutes`}
              </p>
            </div>

            <div className="pad">
              <div className="kv">
                <span className="kv__k">Bien</span>
                <span className="kv__v">{view.property.reference}</span>
              </div>
              <div className="kv">
                <span className="kv__k">Adresse</span>
                <span className="kv__v">{view.property.addressLine}</span>
              </div>
              <div className="kv">
                <span className="kv__k">Agent</span>
                <span className="kv__v">
                  {view.visit?.agentName ?? 'Affecté avant le rendez-vous'}
                </span>
              </div>
              {view.visit ? (
                <div className="kv">
                  <span className="kv__k">Statut</span>
                  <span className="kv__v">
                    <span className={VISIT_STATUS[view.visit.status].tone}>
                      {VISIT_STATUS[view.visit.status].label}
                    </span>
                  </span>
                </div>
              ) : null}
              {view.visit?.videoRoomUrl ? (
                <div className="kv">
                  <span className="kv__k">Lien visio</span>
                  <span className="kv__v">
                    {view.drivers.video === 'mock' ? (
                      <span className="badge badge--pending badge--nodot">
                        Prestataire simulé
                      </span>
                    ) : (
                      <a className="link" href={view.visit.videoRoomUrl}>
                        Rejoindre
                      </a>
                    )}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="pad wash" style={{ borderTop: '1px solid var(--line-softer)' }}>
              {error ? (
                <div className="auth__error mb-12" role="alert">
                  {error.message}
                </div>
              ) : null}

              {view.visit ? (
                <>
                  <p className="p-sm">
                    Rendez-vous enregistré. Vous recevrez un rappel deux heures avant,
                    avec l’adresse exacte et le numéro de l’agent.
                  </p>
                  {view.visit.cancellable ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn-block mt-12"
                      onClick={cancel}
                      disabled={pending}
                    >
                      {pending ? 'Annulation…' : 'Annuler le rendez-vous'}
                    </button>
                  ) : (
                    <p className="field__hint mt-10">
                      Le délai d’annulation en ligne est passé. Contactez Bail.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-block"
                    onClick={submit}
                    disabled={pending || blocked || slotId === null}
                  >
                    {pending ? 'Confirmation…' : 'Confirmer le rendez-vous'}
                  </button>
                  <p className="field__hint mt-10">
                    {slotId === null
                      ? 'Choisissez d’abord un créneau.'
                      : 'Vous recevrez un rappel deux heures avant, avec l’adresse exacte et le numéro de l’agent.'}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="panel mt-16 pad">
            <span className="label label--ink">Vos visites</span>
            {visits.length === 0 ? (
              <p className="p-sm mt-8">Aucun rendez-vous pour l’instant.</p>
            ) : (
              <div className="log mt-12">
                {visits.map((visit) => (
                  <div
                    key={visit.id}
                    className={`log__entry log__entry--${
                      visit.status === 'CANCELLED' || visit.status === 'NO_SHOW'
                        ? 'reject'
                        : visit.status === 'COMPLETED' || visit.status === 'CONFIRMED'
                          ? 'ok'
                          : 'pending'
                    }`}
                  >
                    <span className="log__date">
                      {fmt.logStamp(visit.scheduledAt)}
                    </span>
                    <div>
                      <span className="log__title">
                        <b>{visit.propertyReference}</b> — {visit.district}
                      </span>
                      <span className="log__note">
                        {visit.type === 'VIDEO' ? 'Visio' : 'Accompagnée'} ·{' '}
                        {VISIT_STATUS[visit.status].label.toLowerCase()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
