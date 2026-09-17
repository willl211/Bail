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
  const [error, setError] = useState('');

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await logout();
      router.replace('/');
      router.refresh();
    } catch {
      setError('La déconnexion n’a pas abouti. Vérifiez votre connexion puis réessayez.');
      setPending(false);
    }
  };

  return (
    <>
      <button type="button" className="link mt-12" onClick={submit} disabled={pending}>
        {pending ? 'Déconnexion…' : 'Se déconnecter'}
      </button>
      {error ? <span className="logout-error p-sm" role="alert">{error}</span> : null}
    </>
  );
}
