import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SavedScreen } from '@/components/saved-screen';
import { getCurrentUser, getSavedProperties, getTenantFile } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Biens sauvegardés' };

export default async function SavedPage() {
  const user = await getCurrentUser();
  // Le contrôle qui compte est le guard de rôle côté API ; cette redirection
  // évite seulement d'afficher un écran vide. Un visiteur anonyme est conduit
  // vers la création de dossier, d'où il pourra revenir.
  if (!user) redirect('/dossier');
  if (user.role !== 'TENANT') redirect('/');

  const [items, file] = await Promise.all([getSavedProperties(), getTenantFile()]);
  return <SavedScreen user={user} items={items} file={file} />;
}
