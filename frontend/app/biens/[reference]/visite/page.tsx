import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { VisitBookingScreen } from '@/components/visit-booking-screen';
import { ApiError, getCurrentUser, getTenantVisits, getVisitBookingView } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ reference: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { reference } = await params;
  return { title: `Visite · ${reference}` };
}

/**
 * Prise de rendez-vous de visite — écran 5 du build-order.
 *
 * Réservé à un locataire connecté. Le guard qui compte est celui de l'API
 * (rôle `TENANT`) ; cette redirection n'évite qu'un écran vide.
 */
export default async function VisitPage({ params }: Params) {
  const { reference } = await params;
  const user = await getCurrentUser();

  if (!user) redirect(`/dossier?candidature=${encodeURIComponent(reference)}`);
  if (user.role !== 'TENANT') redirect('/');

  let view;
  try {
    view = await getVisitBookingView(reference);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const visits = await getTenantVisits();

  return <VisitBookingScreen reference={reference} initial={view} visits={visits} />;
}
