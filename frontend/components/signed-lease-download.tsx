'use client';

import { useState } from 'react';
import { downloadSignedLease } from '@/lib/lease-client';

export function SignedLeaseDownload({ reference }: { reference: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadSignedLease(reference);
    } catch (failure) {
      setError((failure as { message: string }).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="btn btn--ghost btn-block mt-12"
        onClick={download}
        disabled={busy}
      >
        {busy ? 'Préparation…' : 'Télécharger le bail signé et sa preuve'}
      </button>
      {error ? (
        <p role="alert" className="auth__error mt-10">
          {error}
        </p>
      ) : null}
    </>
  );
}
