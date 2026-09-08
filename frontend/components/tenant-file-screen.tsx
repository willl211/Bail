'use client';

import { useState } from 'react';
import type { CurrentUser, TenantFileView } from '@/lib/api';
import { VerifyEmailNotice } from './verify-email-notice';
import { submitFile, type TenantFailure } from '@/lib/tenant-client';
import { TenantAside } from './tenant-aside';
import { TenantDocumentReview } from './tenant-document-review';
import { TenantGuarantorForm } from './tenant-guarantor-form';
import { TenantProfileForm } from './tenant-profile-form';
import { TenantFileOverview, type TenantSection } from './tenant-file-overview';

const SECTIONS = [
  ['overview', 'Vue d’ensemble'],
  ['profile', 'Ma situation'],
  ['documents', 'Mes documents'],
  ['guarantor', 'Mon garant'],
] as const;

export function TenantFileScreen({
  user,
  initial,
}: {
  user: CurrentUser;
  initial: TenantFileView;
}) {
  const [file, setFile] = useState(initial);
  const [section, setSection] = useState<TenantSection>('overview');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TenantFailure | null>(null);
  const [notice, setNotice] = useState('');
  const locked = file.status === 'UNDER_REVIEW';
  const visible = file.slots.filter((slot) => slot.required || slot.documents.length > 0);
  const ownSlots = visible.filter((slot) => slot.group !== 'guarantor');
  const guarantorSlots = visible.filter((slot) => slot.group === 'guarantor');
  const updateFile = (next: TenantFileView) => {
    setNotice(
      file.status === 'VERIFIED' && next.status !== 'VERIFIED'
        ? 'Modification enregistrée. Votre dossier doit être vérifié à nouveau ; il est maintenant en attente de contrôle.'
        : 'Modification enregistrée. Le suivi du dossier a été actualisé.',
    );
    setFile(next);
  };
  const submit = async () => {
    if (pending || locked || file.missing.length > 0) return;
    setPending(true);
    setError(null);
    setNotice('');
    try {
      setFile(await submitFile());
    } catch (failure) {
      setError(failure as TenantFailure);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page tenant-page">
      {user.emailVerified ? null : <VerifyEmailNotice email={user.email} />}
      <div className="app tenant-app">
        <TenantAside user={user} file={file} current="file" />
        <div className="body tenant-file">
          <div className="page__head">
            <div>
              <span className="label label--accent">Espace locataire</span>
              <h1 className="d3 mt-8">Mon dossier</h1>
              <p className="p-sm mt-10">Votre prochaine location se prépare ici.</p>
            </div>
          </div>
          <nav className="tenant-file-nav" aria-label="Rubriques du dossier">
            {SECTIONS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={section === key}
                aria-controls={`tenant-section-${key}`}
                onClick={() => setSection(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          {locked && section !== 'overview' ? (
            <p className="reminder tenant-review-notice">
              Votre dossier est en cours de contrôle. La consultation reste possible ; les
              modifications sont temporairement suspendues.
            </p>
          ) : null}
          {notice ? (
            <div className="tenant-update-notice" role="status">
              <p>{notice}</p>
              <button
                type="button"
                aria-label="Fermer la confirmation"
                onClick={() => setNotice('')}
              >
                ×
              </button>
            </div>
          ) : null}
          <section
            id="tenant-section-overview"
            hidden={section !== 'overview'}
            aria-label="Vue d’ensemble"
          >
            <TenantFileOverview
              file={file}
              onSelect={setSection}
              onSubmit={submit}
              pending={pending}
              error={error?.message}
            />
          </section>
          {/* Les formulaires restent montés pour conserver les saisies entre rubriques. */}
          <section
            id="tenant-section-profile"
            hidden={section !== 'profile'}
            aria-label="Ma situation"
          >
            <div className="tenant-section-heading">
              <h2>Ma situation</h2>
              <p>Un résumé de votre activité et de votre budget.</p>
            </div>
            <div className="tenant-form-panel">
              <TenantProfileForm file={file} readOnly={locked} onChange={updateFile} />
            </div>
          </section>
          <section
            id="tenant-section-documents"
            hidden={section !== 'documents'}
            aria-label="Mes documents"
          >
            <div className="tenant-section-heading">
              <h2>Mes documents</h2>
              <p>Les pièces qui demandent votre attention apparaissent en premier.</p>
            </div>
            {ownSlots.length === 0 ? (
              <p className="reminder">
                Renseignez votre situation pour connaître les pièces attendues.
              </p>
            ) : (
              <TenantDocumentReview slots={ownSlots} readOnly={locked} onChange={updateFile} />
            )}
            <p className="tenant-document-note">
              PDF, JPG, PNG ou WebP · 10 Mo maximum par fichier. Ajouter ou retirer une pièce
              d’un dossier vérifié relance son contrôle.
            </p>
          </section>
          <section
            id="tenant-section-guarantor"
            hidden={section !== 'guarantor'}
            aria-label="Mon garant"
          >
            <div className="tenant-section-heading">
              <h2>Mon garant</h2>
              <p>
                Choisissez votre type de garantie, puis renseignez les informations utiles.
              </p>
            </div>
            <TenantGuarantorForm file={file} readOnly={locked} onChange={updateFile} />
            {guarantorSlots.length ? (
              <div className="tenant-document-group">
                <h3>Documents du garant enregistré</h3>
                <TenantDocumentReview
                  slots={guarantorSlots}
                  readOnly={locked}
                  onChange={updateFile}
                />
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
