import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/password-forms';

export const metadata: Metadata = { title: 'Mot de passe oublié' };

export default function ForgotPasswordPage() {
  return (
    <div className="page page--narrow">
      <ForgotPasswordForm />
    </div>
  );
}
