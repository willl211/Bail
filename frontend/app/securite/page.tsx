import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/api';
import { MfaScreen } from '@/components/mfa-screen';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sécurité du compte admin' };
export default async function SecurityPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/connexion');
  if (user.role !== 'AGENT') redirect('/');
  if (!user.mfaRequired) redirect('/back-office');
  return <MfaScreen enrolled={!!user.mfaEnrolled} />;
}
