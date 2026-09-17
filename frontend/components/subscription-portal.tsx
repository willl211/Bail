'use client';

import { useState } from 'react';
import { openBillingPortal } from '@/lib/owner-client';
import { redirectToStripe } from '@/lib/stripe-redirect';

export function SubscriptionPortal() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setBusy(true); setError(null);
    try { redirectToStripe((await openBillingPortal()).url); }
    catch (failure) { setError((failure as { message: string }).message); }
    finally { setBusy(false); }
  };
  return <div className="panel pad">
    <span className="badge badge--pending badge--nodot mb-12">Stripe · mode test</span>
    <p className="p-sm mb-12">Votre carte et vos factures sont gérées dans votre espace sécurisé Stripe.</p>
    {error ? <p className="auth__error mb-12" role="alert">{error}</p> : null}
    <button type="button" className="btn btn--ghost" onClick={open} disabled={busy}>{busy ? 'Ouverture…' : 'Gérer ma carte et mes factures'}</button>
  </div>;
}
