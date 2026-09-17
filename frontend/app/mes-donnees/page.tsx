import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/api';
import { PrivacyScreen } from '@/components/privacy-screen';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mes données' };
export default async function PrivacyPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/connexion');
  if (user.mfaRequired) redirect('/securite');
  return <PrivacyScreen />;
}
