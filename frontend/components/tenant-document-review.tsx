import type { TenantFileView, TenantSlotView } from '@/lib/api';
import { TenantDocuments } from './tenant-documents';

const PRIORITY: Record<string, number> = { REJECTED: 0, EXPIRED: 1, MISSING: 2 };

/** Les documents validés restent consultables, tandis que les actions passent en premier. */
export function TenantDocumentReview({
  slots,
  readOnly,
  onChange,
}: {
  slots: TenantSlotView[];
  readOnly: boolean;
  onChange: (view: TenantFileView) => void;
}) {
  const attention = slots
    .filter((slot) => slot.status in PRIORITY)
    .sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status]);
  const waiting = slots.filter(
    (slot) => slot.status === 'PENDING' || slot.status === 'PROCESSING',
  );
  const verified = slots.filter((slot) => slot.status === 'VERIFIED');
  return (
    <div className="tenant-document-review">
      {attention.length ? (
        <section className="tenant-document-batch" aria-label="Documents à traiter">
          <h3>
            À traiter <span>{attention.length}</span>
          </h3>
          <p>
            Commencez par ces pièces. Les motifs du contrôle sont indiqués sur chaque ligne.
          </p>
          <TenantDocuments slots={attention} readOnly={readOnly} onChange={onChange} />
        </section>
      ) : slots.length ? (
        <p className="tenant-documents-clear">
          Aucune pièce à fournir ou à remplacer pour le moment.
        </p>
      ) : null}
      {waiting.length ? (
        <section className="tenant-document-batch" aria-label="Documents en cours de contrôle">
          <h3>
            En cours de contrôle <span>{waiting.length}</span>
          </h3>
          <p>Ces pièces ont bien été reçues. Aucune action n’est nécessaire pour le moment.</p>
          <TenantDocuments slots={waiting} readOnly={readOnly} onChange={onChange} />
        </section>
      ) : null}
      {verified.length ? (
        <details className="tenant-verified-documents">
          <summary>
            Documents validés <span>{verified.length}</span>
            <small>Consulter les fichiers</small>
          </summary>
          <TenantDocuments slots={verified} readOnly={readOnly} onChange={onChange} />
        </details>
      ) : null}
    </div>
  );
}
