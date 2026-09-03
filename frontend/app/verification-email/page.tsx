import type { Metadata } from 'next';
import { EmailConfirmation } from '@/components/email-confirmation';

export const metadata: Metadata = { title: 'Confirmation d’adresse' };

/**
 * Le jeton arrive en paramètre d'URL — c'est la seule façon de le transporter
 * dans un lien cliquable depuis un e-mail. Il est retiré de la barre d'adresse
 * dès qu'il a servi, côté client.
 */
export default async function EmailVerificationPage({
  searchParams,
}: {
  searchParams: Promise<{ jeton?: string }>;
}) {
  const { jeton } = await searchParams;
  return <EmailConfirmation token={jeton ?? null} />;
}
