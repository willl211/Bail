import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { CandidacyScreen } from '@/components/candidacy-screen';
import { ApiError, getCandidacyPreview, getCurrentUser, getTenantApplications } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ reference: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { reference } = await params;
  return { title: `Candidature · ${reference}` };
}

/**
 * Candidature à un bien — écran 4 du build-order.
 *
 * Réservé à un locataire connecté : sans compte, rien à transmettre. Le guard
 * qui compte est celui de l'API (rôle `TENANT`) ; cette redirection n'évite
 * qu'un écran vide.
 */
export default async function CandidacyPage({ params }: Params) {
  const { reference } = await params;
  const user = await getCurrentUser();

  if (!user) redirect(`/dossier?candidature=${encodeURIComponent(reference)}`);
  if (user.role !== 'TENANT') redirect('/');

  let preview;
  try {
    preview = await getCandidacyPreview(reference);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const applications = await getTenantApplications();

  return (
    <CandidacyScreen reference={reference} initial={preview} applications={applications} />
  );
}
