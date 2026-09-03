'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ApplicationStatus } from '@/lib/api';
import { acceptApplication } from '@/lib/lease-client';
import {
  rejectApplication,
  shortlistApplication,
  type VisitFailure,
} from '@/lib/visits-client';

/** Candidatures déjà tranchées : plus rien à décider ici. */
const DECIDED: ApplicationStatus[] = ['ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'];

/**
 * Décision du propriétaire sur une candidature.
 *
 * « Proposer une visite » retient le candidat — il peut alors choisir un
 * créneau. Ça ne fige rien : plusieurs candidats peuvent être retenus et
 * visiter, c'est l'acceptation finale qui tranchera.
 *
 * Écarter demande une confirmation et un motif : un dossier refusé sans un mot
 * est ce que le marché fait déjà de pire, et le motif est transmis au candidat.
 */
export function ApplicationDecision({
  applicationId,
  status,
}: {
  applicationId: string;
  status: ApplicationStatus;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<'shortlist' | 'reject' | 'accept' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<VisitFailure | null>(null);

  const decided = DECIDED.includes(status);
  const scheduled = status === 'VISIT_SCHEDULED';

  const run = async (action: 'shortlist' | 'reject' | 'accept') => {
    setPending(action);
    setError(null);
    try {
      if (action === 'shortlist') await shortlistApplication(applicationId);
      else if (action === 'accept') {
        const lease = await acceptApplication(applicationId);
        // Accepter ouvre le bail : on y emmène directement, c'est la suite
        // immédiate du geste.
        router.push(`/baux/${lease.reference}`);
        return;
      } else await rejectApplication(applicationId, reason || undefined);
      setConfirming(false);
      setReason('');
      router.refresh();
    } catch (failure) {
      setError(failure as VisitFailure);
    } finally {
      setPending(null);
    }
  };

  if (decided) {
    return (
      <p className="field__hint">
        {status === 'REJECTED'
          ? 'Candidature écartée. Le candidat en a été informé.'
          : 'Cette candidature est tranchée.'}
      </p>
    );
  }

  return (
    <>
      {error ? (
        <div className="auth__error mb-12" role="alert">
          {error.message}
        </div>
      ) : null}

      {confirming ? (
        <>
          <label className="field">
            <span className="label label--ink">
              Motif du refus <span className="doc__opt">transmis au candidat</span>
            </span>
            <textarea
              className="field__box"
              rows={2}
              maxLength={300}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Un autre dossier a été retenu."
            />
          </label>
          <div className="flex gap-10 wrap mt-12">
            <button
              type="button"
              className="btn btn--ghost btn-sm"
              onClick={() => run('reject')}
              disabled={pending !== null}
            >
              {pending === 'reject' ? 'Envoi…' : 'Confirmer le refus'}
            </button>
            <button
              type="button"
              className="link"
              onClick={() => setConfirming(false)}
              disabled={pending !== null}
            >
              Annuler
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex gap-10 wrap">
            <button
              type="button"
              className="btn btn-sm"
              style={{ flex: '1 1 auto' }}
              onClick={() => run('shortlist')}
              disabled={pending !== null || scheduled}
            >
              {pending === 'shortlist'
                ? 'Envoi…'
                : scheduled
                  ? 'Visite planifiée'
                  : 'Proposer une visite'}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn-sm"
              style={{ flex: '1 1 auto' }}
              onClick={() => setConfirming(true)}
              disabled={pending !== null}
            >
              Écarter
            </button>
          </div>
          {/* Attribuer le logement n'a de sens qu'une fois le candidat retenu :
              accepter d'emblée un dossier qu'on n'a pas encore examiné, sans
              visite, n'est pas le parcours. */}
          {status === 'SHORTLISTED' || scheduled ? (
            <button
              type="button"
              className="btn btn--ink btn-block mt-12"
              onClick={() => run('accept')}
              disabled={pending !== null}
            >
              {pending === 'accept' ? 'Ouverture du bail…' : 'Attribuer le logement'}
            </button>
          ) : null}

          <p className="field__hint mt-10">
            {status === 'SHORTLISTED' || scheduled
              ? 'Attribuer le logement ouvre le bail, fige les autres candidatures et retire l’annonce.'
              : 'Retenir un candidat lui ouvre la prise de rendez-vous. Vous pouvez en retenir plusieurs.'}
          </p>
        </>
      )}
    </>
  );
}
