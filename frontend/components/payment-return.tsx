'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function ReturnStatus({ confirmed }: { confirmed: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const result = params.get('paiement');
  useEffect(() => {
    if (result !== 'retour' || confirmed) return;
    let attempts = 0;
    const timer = setInterval(() => {
      router.refresh();
      if (++attempts >= 10) clearInterval(timer);
    }, 3000);
    return () => clearInterval(timer);
  }, [result, confirmed, router]);
  if (!result) return null;
  return <div className="panel pad mt-16" role="status">
    <p className="p-sm">{confirmed ? 'Confirmation reçue de Stripe.' : result === 'annule'
      ? 'Vous avez quitté Stripe. Vous pouvez reprendre le paiement avec le bouton ci-dessous.'
      : 'Retour de Stripe : nous attendons la confirmation. Le statut est actualisé automatiquement pendant 30 secondes.'}</p>
    {!confirmed && result !== 'annule' ? <button className="link mt-8" onClick={() => router.refresh()}>Actualiser le statut</button> : null}
  </div>;
}

export function PaymentReturn({ confirmed }: { confirmed: boolean }) {
  return <Suspense><ReturnStatus confirmed={confirmed} /></Suspense>;
}
