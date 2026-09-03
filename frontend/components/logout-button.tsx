'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { logout } from '@/lib/auth-client';

/**
 * Déconnexion.
 *
 * `router.refresh()` après l'appel : les composants serveur ont mis en cache un
 * rendu « connecté », il faut les forcer à recalculer avec la session révoquée.
 */
export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    // La déconnexion ne peut pas échouer côté API (elle est idempotente) : même
    // en cas de coupure réseau, on ramène l'utilisateur à l'accueil plutôt que
    // de le laisser sur un écran qu'il croit encore authentifié.
    try {
      await logout();
    } finally {
      router.replace('/');
      router.refresh();
    }
  };

  return (
    <button type="button" className="link mt-12" onClick={submit} disabled={pending}>
      {pending ? 'Déconnexion…' : 'Se déconnecter'}
    </button>
  );
}
