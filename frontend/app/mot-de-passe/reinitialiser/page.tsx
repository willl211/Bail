import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/password-forms';

export const metadata: Metadata = { title: 'Nouveau mot de passe' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ jeton?: string }>;
}) {
  const { jeton } = await searchParams;
  return (
    <div className="page page--narrow">
      <ResetPasswordForm token={jeton ?? null} />
    </div>
  );
}
