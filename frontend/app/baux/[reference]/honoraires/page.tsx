import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { FeesScreen } from '@/components/fees-screen';
import { ApiError, getCurrentUser, getLeaseFees } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ reference: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { reference } = await params;
  return { title: `Honoraires · ${reference}` };
}

/**
 * Règlement des honoraires — écran 7 du build-order.
 *
 * Réservé au locataire du bail : ce sont ses honoraires. Le guard qui compte
 * est celui de l'API ; cette redirection n'évite qu'un écran vide.
 */
export default async function LeaseFeesPage({ params }: Params) {
  const { reference } = await params;
  const user = await getCurrentUser();

  if (!user) redirect('/dossier');
  if (user.role !== 'TENANT') redirect('/');

  let fees;
  try {
    fees = await getLeaseFees(reference);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return <FeesScreen initial={fees} />;
}
