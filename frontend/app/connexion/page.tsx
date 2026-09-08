import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/api';
import { accountDestination, type AccountIntent } from '@/lib/account-navigation';
import { AccountLoginForm } from '@/components/account-login-form';
import { AuthScenery } from '@/components/auth-scenery';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Mon compte',
  description:
    'Connectez-vous à votre espace whoma ou créez votre compte locataire ou propriétaire.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<AccountIntent>;
}) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  const intent = {
    candidature: typeof params.candidature === 'string' ? params.candidature : undefined,
    bien: typeof params.bien === 'string' ? params.bien : undefined,
  };
  if (user) redirect(accountDestination(user.role, intent));
  return (
    <main className="page">
      <div className="auth auth--welcome">
        <div className="auth__form">
          <span className="label label--accent">Votre espace whoma</span>
          <h1 className="d2 mt-12">Bienvenue chez vous.</h1>
          <p className="p mt-16">
            Connectez-vous pour retrouver votre dossier, vos biens ou vos candidatures.
          </p>
          <AccountLoginForm intent={intent} />
        </div>
        <AuthScenery title="La suite commence ici.">
          <p className="p-sm">
            Un logement à trouver, un bien à louer. Retrouvez tout ce qui compte dans un même
            espace.
          </p>
          <div className="auth-scenery__notes">
            <div>
              <span className="label">Côté locataire</span>
              <p>Un dossier, toutes vos candidatures.</p>
            </div>
            <div>
              <span className="label">Côté propriétaire</span>
              <p>Vos biens et vos candidats, au même endroit.</p>
            </div>
          </div>
        </AuthScenery>
      </div>
    </main>
  );
}
