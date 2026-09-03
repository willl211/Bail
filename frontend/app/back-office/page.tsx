import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BackofficeScreen } from '@/components/backoffice-screen';
import {
  getAdminAgents,
  getAdminFiles,
  getAdminJournal,
  getAdminLeases,
  getAdminProperties,
  getAdminProviders,
  getAdminSummary,
  getAdminVisits,
  getCurrentUser,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Back-office' };

/**
 * Back-office de l'agence.
 *
 * Réservé au rôle `AGENT`, qui couvre l'agent de terrain et l'administrateur
 * (README, règle 9). Le contrôle qui compte est le guard de rôle côté API ;
 * cette redirection n'évite qu'un écran vide.
 */
export default async function BackofficePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/dossier');
  if (user.role !== 'AGENT') redirect('/');

  const [summary, providers, files, properties, leases, visits, agents, journal] =
    await Promise.all([
      getAdminSummary(),
      getAdminProviders(),
      getAdminFiles(),
      getAdminProperties(),
      getAdminLeases(),
      getAdminVisits(),
      getAdminAgents(),
      getAdminJournal(),
    ]);

  return (
    <BackofficeScreen
      summary={summary}
      providers={providers}
      files={files}
      properties={properties}
      leases={leases}
      visits={visits}
      agents={agents}
      journal={journal}
    />
  );
}
