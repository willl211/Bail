'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { deletePhoto, uploadPhoto, type ApiFailure } from '@/lib/owner-client';

interface Photo {
  id: string;
  label: string;
  url: string | null;
}

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED = 'image/jpeg,image/png,image/webp';

/**
 * Photos de l'annonce.
 *
 * Les envois se font un fichier à la fois, en série : envoyer six photos en
 * parallèle rendrait l'ordre d'arrivée — donc les positions — imprévisible.
 *
 * La taille est vérifiée avant l'envoi. L'API la revérifie de toute façon, mais
 * refuser localement évite de faire téléverser 20 Mo à quelqu'un pour lui
 * annoncer ensuite que c'était trop gros.
 */
export function PhotoUploader({
  reference,
  photos,
  readOnly,
}: {
  reference: string | null;
  photos: Photo[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);

  if (!reference) {
    return (
      <div className="panel" style={{ padding: '19px 20px' }}>
        <p className="p-sm">
          Enregistrez d’abord le brouillon : les photos ont besoin d’une référence de
          bien à laquelle se rattacher.
        </p>
      </div>
    );
  }

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);

    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_BYTES) {
          throw {
            message: `« ${file.name} » dépasse 8 Mo. Réduisez l’image avant de l’envoyer.`,
          } satisfies ApiFailure;
        }
        await uploadPhoto(reference, file);
      }
      router.refresh();
    } catch (failure) {
      setError(failure as ApiFailure);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const onRemove = async (photoId: string) => {
    setBusy(true);
    setError(null);
    try {
      await deletePhoto(reference, photoId);
      router.refresh();
    } catch (failure) {
      setError(failure as ApiFailure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel" style={{ padding: '19px 20px' }}>
      <div className="photo-grid">
        {photos.map((photo, index) => (
          <figure key={photo.id} className="photo-tile">
            {photo.url ? (
              // Pas de `next/image` : les photos viennent du stockage objet, dont
              // le domaine change selon l'environnement. L'optimiseur exigerait
              // de déclarer chaque hôte, pour un gain nul sur des vignettes.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo.url} alt={photo.label} loading="lazy" />
            ) : (
              <div className="photo" style={{ height: '100%' }} />
            )}

            <figcaption className="photo-tile__bar">
              <span className="label">
                {String(index + 1).padStart(2, '0')} · {photo.label}
              </span>
              {!readOnly ? (
                <button
                  type="button"
                  className="link"
                  onClick={() => onRemove(photo.id)}
                  disabled={busy}
                >
                  Retirer
                </button>
              ) : null}
            </figcaption>
          </figure>
        ))}

        {!readOnly ? (
          <button
            type="button"
            className="drop"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            <span className="drop__mark">+</span>
            <span className="label mt-8">{busy ? 'Envoi…' : 'Ajouter'}</span>
          </button>
        ) : null}
      </div>

      <input
        ref={input}
        type="file"
        accept={ACCEPTED}
        multiple
        hidden
        onChange={(event) => onFiles(event.target.files)}
      />

      {error ? (
        <div className="auth__error mt-16" role="alert">
          {error.message}
        </div>
      ) : null}

      <p className="field__hint mt-12">
        JPEG, PNG ou WebP · 8 Mo maximum par photo. Six photos sont recommandées : les
        annonces qui en comptent au moins six reçoivent nettement plus de candidatures.
      </p>
    </div>
  );
}
