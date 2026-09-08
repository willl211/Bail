import type { Metadata } from 'next';
import { EmailChangeConfirmation } from '@/components/email-change-confirmation';

export const metadata: Metadata = {
  title: 'Changer d’adresse e-mail',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default async function EmailChangePage({
  searchParams,
}: {
  searchParams: Promise<{ jeton?: string }>;
}) {
  const { jeton } = await searchParams;
  return <EmailChangeConfirmation token={jeton ?? null} />;
}
