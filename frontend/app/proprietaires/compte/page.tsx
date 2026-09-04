import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OwnerAddressForm } from '@/components/owner-address-form';
import { OwnerAside } from '@/components/owner-aside';
import { VerifyEmailNotice } from '@/components/verify-email-notice';
import { getCurrentUser, getOwnerProfile, getOwnerSummary } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Mon compte' };

export default async function OwnerAccountPage() {
  const user = await getCurrentUser();
  // Le contrôle qui compte est le guard de rôle côté API ; cette redirection
  // évite seulement d'afficher un écran vide.
  if (!user) redirect('/proprietaires');
  if (user.role !== 'OWNER') redirect('/');

  const [summary, profile] = await Promise.all([getOwnerSummary(), getOwnerProfile()]);

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      {user.emailVerified ? null : <VerifyEmailNotice email={user.email} />}

      <div className="app">
        <OwnerAside user={user} summary={summary} current="account" />

        <div className="body">
          <OwnerAddressForm initial={profile} />
        </div>
      </div>
    </div>
  );
}
