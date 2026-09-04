'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { saveProperty, unsaveProperty } from '@/lib/saved-client';

/**
 * Met un bien de côté, ou l'en retire.
 *
 * Comble le vide entre « je regarde » et « je candidate » : sans lui, un
 * visiteur qui hésite n'a aucun moyen de retrouver un bien le lendemain.
 *
 * Un compte est exigé. Le visiteur anonyme n'est donc pas refoulé mais conduit
 * vers la création de dossier, **avec son intention conservée** — comme pour une
 * candidature. Un propriétaire ou un agent ne voit pas le bouton du tout :
 * l'afficher pour le voir échouer en 403 serait une promesse en l'air.
 *
 * L'état bascule avant la réponse du serveur. Sur une action aussi anodine,
 * attendre un aller-retour rend l'interface poussive ; en cas d'échec, l'état
 * revient et le message s'affiche.
 */
export function SaveButton({
  reference,
  initiallySaved,
  role,
  variant = 'full',
  autoSave = false,
}: {
  reference: string;
  initiallySaved: boolean;
  /** `null` pour un visiteur anonyme. */
  role: 'OWNER' | 'TENANT' | 'AGENT' | null;
  /**
   * `icon` sur une carte de résultat (posé en absolu sur la vignette),
   * `inline` dans une liste (même apparence, placé dans le flux),
   * `full` sur la fiche annonce.
   */
  variant?: 'icon' | 'inline' | 'full';
  /**
   * Sauvegarde dès l'affichage, sans clic.
   *
   * Sert au retour d'inscription : quelqu'un a cliqué sur l'étoile en anonyme,
   * on l'a envoyé créer un compte, il revient — lui redemander de cliquer
   * reviendrait à lui faire payer deux fois la même intention.
   */
  autoSave?: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initiallySaved);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const autoDone = useRef(false);

  // Sauvegarde automatique au retour d'inscription. Le garde empêche le double
  // montage de React d'envoyer deux requêtes, et l'URL est nettoyée pour qu'un
  // rechargement ne rejoue pas l'action.
  //
  // Déclaré avant tout retour anticipé : les hooks doivent s'exécuter dans le
  // même ordre à chaque rendu, y compris pour un propriétaire qui ne verra
  // jamais ce bouton.
  useEffect(() => {
    if (!autoSave || autoDone.current || role !== 'TENANT' || saved) return;
    autoDone.current = true;

    saveProperty(reference)
      .then(() => {
        setSaved(true);
        router.refresh();
      })
      .catch(() => setError(true))
      .finally(() => {
        window.history.replaceState(null, '', window.location.pathname);
      });
  }, [autoSave, reference, role, saved, router]);

  // Ni le propriétaire ni l'agent n'ont de liste de biens sauvegardés.
  if (role === 'OWNER' || role === 'AGENT') return null;

  const label = saved ? 'Retirer de mes biens sauvegardés' : 'Sauvegarder ce bien';

  const basculer = async () => {
    if (role === null) {
      // L'intention est conservée : après inscription, le locataire retrouve le
      // bien qui l'a amené là.
      router.push(`/dossier?bien=${encodeURIComponent(reference)}`);
      return;
    }

    const avant = saved;
    setSaved(!avant);
    setPending(true);
    setError(false);
    try {
      setSaved(avant ? await unsaveProperty(reference) : await saveProperty(reference));
      // La liste sauvegardée est rendue côté serveur : sans ça, elle resterait
      // périmée jusqu'au prochain rechargement complet.
      router.refresh();
    } catch {
      setSaved(avant);
      setError(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      // `save` et non `btn` : ce n'est pas une action principale, et lui donner
      // le poids visuel du bouton « Candidater » brouillerait la hiérarchie.
      className={`save save--${variant}${saved ? ' save--on' : ''}`}
      onClick={(event) => {
        // Sur une carte de résultat, le bouton est à l'intérieur du lien vers la
        // fiche : sans cette interception, sauvegarder ferait aussi naviguer.
        event.preventDefault();
        event.stopPropagation();
        void basculer();
      }}
      disabled={pending}
      aria-pressed={role === null ? undefined : saved}
      aria-label={variant === 'full' ? undefined : label}
      title={error ? 'Enregistrement impossible. Réessayez.' : label}
    >
      <span aria-hidden className="save__mark">
        {saved ? '★' : '☆'}
      </span>
      {variant === 'full' ? <span>{saved ? 'Bien sauvegardé' : 'Sauvegarder'}</span> : null}
    </button>
  );
}
