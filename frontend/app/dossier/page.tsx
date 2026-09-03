import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TenantAuthForm } from '@/components/tenant-auth-form';
import { TenantFileScreen } from '@/components/tenant-file-screen';
import { getCurrentUser, getMarketSnapshot, getTenantFile } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Mon dossier',
  description:
    'Déposez vos pièces une seule fois. Bail les vérifie, puis chaque candidature part en un clic — vos documents ne quittent jamais la plateforme.',
};

const STEPS = [
  {
    n: '1',
    title: 'Une pièce d’identité',
    text: 'CNI, passeport ou titre de séjour en cours de validité.',
  },
  {
    n: '2',
    title: 'Vos justificatifs de revenus',
    text: 'Bulletins de salaire et contrat, ou certificat de scolarité si vous étudiez.',
  },
  {
    n: '3',
    title: 'Un garant, si vous en avez un',
    text: 'La plupart des propriétaires à Metz en demandent un.',
  },
];

/**
 * Espace locataire — écran 3 du build-order.
 *
 * Une seule adresse pour deux états : la page d'acquisition publique quand
 * personne n'est connecté, le dossier quand un locataire l'est. Séparer les
 * deux URL obligerait à choisir laquelle mettre dans la navigation, et l'une
 * des deux serait toujours la mauvaise.
 */
export default async function TenantFilePage({
  searchParams,
}: {
  searchParams: Promise<{ candidature?: string }>;
}) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  // Bien qu'on voulait candidater avant d'avoir de compte : on y renvoie une
  // fois le dossier ouvert, plutôt que de perdre l'intention en route.
  const returnTo = params.candidature
    ? `/biens/${encodeURIComponent(params.candidature)}/candidater`
    : null;

  // Un propriétaire n'a pas de dossier locataire : l'API le lui refuserait
  // (403), autant le renvoyer chez lui plutôt que de lui montrer une erreur.
  if (user?.role === 'OWNER') redirect('/proprietaires/biens');
  if (user?.role === 'AGENT') redirect('/');

  if (user) {
    if (returnTo) redirect(returnTo);
    const file = await getTenantFile();
    return <TenantFileScreen user={user} initial={file} />;
  }

  const market = await getMarketSnapshot().catch(() => null);
  const applicants = market?.metrics.find((metric) =>
    metric.key.includes('applicantsPerProperty'),
  );

  return (
    <main className="page">
      <div className="auth">
        <div className="auth__form">
          <span className="label label--accent">Espace locataire</span>
          <h1 className="d2 mt-12">
            Un dossier.
            <br />
            Toutes vos candidatures.
          </h1>
          <p className="p mt-16">
            {returnTo
              ? 'Créez votre dossier ou connectez-vous pour reprendre votre candidature.'
              : 'Vos pièces une seule fois, vérifiées par Bail. Ensuite, chaque candidature part en un clic.'}
          </p>

          <TenantAuthForm redirectTo={returnTo ?? undefined} />

          <p className="field__hint mt-16">
            Documents hébergés en France, jamais transmis aux propriétaires.
          </p>
        </div>

        <div className="auth__side">
          <span className="label label--ink">Ce qu’il vous faudra</span>
          <div className="mt-16" style={{ maxWidth: 440 }}>
            {STEPS.map((step) => (
              <div key={step.n} className="bullet">
                <span className="bullet__i">{step.n}</span>
                <div>
                  <div className="h-sm">{step.title}</div>
                  <p className="p-sm mt-6">{step.text}</p>
                </div>
              </div>
            ))}
          </div>

          {applicants ? (
            <div
              className="panel pad mt-24 wash"
              style={{ maxWidth: 440 }}
            >
              <span className="label label--accent">Marché tendu</span>
              <p className="p-sm mt-8">
                À Metz, un bien reçoit en moyenne{' '}
                <b className="mono">{applicants.value}</b> candidatures. Un
                dossier déjà vérifié passe devant : le propriétaire n’a rien à
                contrôler lui-même.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
