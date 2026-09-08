import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OwnerAside } from '@/components/owner-aside';
import { OwnerApplications } from '@/components/owner-applications';
import { getCurrentUser, getOwnerApplications, getOwnerSummary } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Candidatures reçues' };

export default async function OwnerApplicationsPage({ searchParams }: {
  searchParams: Promise<{ bien?: string; candidat?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/proprietaires');
  if (user.role !== 'OWNER') redirect('/');
  const [params, summary, view] = await Promise.all([searchParams, getOwnerSummary(), getOwnerApplications()]);
  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="app">
        <OwnerAside user={user} summary={summary} current="applications" />
        <main className="body"><OwnerApplications view={view} propertyReference={params.bien} candidateId={params.candidat} /></main>
      </div>
    </div>
  );
}
