import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { LeaseScreen } from '@/components/lease-screen';
import { ApiError, getCurrentUser, getLease } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ reference: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { reference } = await params;
  return { title: `Bail ${reference}` };
}

/**
 * Bail et signature — écran 6 du build-order.
 *
 * Les trois profils y accèdent, mais chacun ne voit que ce qui le concerne :
 * le cloisonnement est fait par l'API sur l'identité du demandeur, pas ici.
 */
export default async function LeasePage({ params }: Params) {
  const { reference } = await params;
  const user = await getCurrentUser();
  if (!user) redirect('/dossier');

  let lease;
  try {
    lease = await getLease(reference);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return <LeaseScreen initial={lease} canSend={user.role === 'OWNER'} />;
}
