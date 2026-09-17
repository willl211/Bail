import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccountRegistrationForm } from '@/components/account-registration-form';
import { AuthScenery } from '@/components/auth-scenery';
import { accountEntry } from '@/lib/account-navigation';
import { TenantFileScreen } from '@/components/tenant-file-screen';
import { getCurrentUser, getTenantFile } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Mon dossier',
  description:
    'Rassemblez vos justificatifs, suivez leur examen par l’équipe et retrouvez votre dossier pour chaque candidature. Vos pièces restent privées.',
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
    text: 'Ajoutez ses informations et justificatifs si vous présentez un garant.',
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
  searchParams: Promise<{ candidature?: string; bien?: string }>;
}) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  // Bien qu'on voulait candidater — ou seulement mettre de côté — avant d'avoir
  // un compte : on y renvoie une fois le dossier ouvert, plutôt que de perdre
  // l'intention en route. Sauvegarder demande un compte, mais c'est justement
  // au moment où l'on hésite : abandonner là serait perdre la personne.
  const returnTo = params.candidature
    ? `/biens/${encodeURIComponent(params.candidature)}/candidater`
    : params.bien
      ? // `?sauvegarder=1` : le bien est mis de côté à l'arrivée, sans que la
        // personne ait à recliquer sur l'étoile qui l'a amenée ici.
        `/biens/${encodeURIComponent(params.bien)}?sauvegarder=1`
      : null;

  // Un propriétaire n'a pas de dossier locataire : l'API le lui refuserait
  // (403), autant le renvoyer chez lui plutôt que de lui montrer une erreur.
  if (user?.role === 'OWNER') redirect('/proprietaires/biens');
  if (user?.role === 'AGENT') redirect('/back-office');

  if (user) {
    if (returnTo) redirect(returnTo);
    const file = await getTenantFile();
    return <TenantFileScreen user={user} initial={file} />;
  }

  return (
    <main className="page">
      <div className="auth auth--welcome">
        <div className="auth__form">
          <span className="label label--accent">Espace locataire</span>
          <h1 className="d2 mt-12">
            Un dossier.
            <br />
            Toutes vos candidatures.
          </h1>
          <p className="p mt-16">
            {params.bien
              ? 'Créez votre dossier ou connectez-vous : ce bien sera mis de côté, et vous le retrouverez ici.'
              : returnTo
                ? 'Créez votre dossier ou connectez-vous pour reprendre votre candidature.'
                : 'Vos pièces une seule fois, vérifiées par whoma. Ensuite, chaque candidature part en un clic.'}
          </p>

          <AccountRegistrationForm
            role="TENANT"
            redirectTo={returnTo ?? undefined}
            loginHref={accountEntry('/connexion', params)}
          />

          <p className="field__hint mt-16">
            Vos justificatifs sont accessibles à l’équipe chargée du contrôle. Les propriétaires reçoivent une synthèse du dossier.
          </p>
        </div>

        <AuthScenery title="Faites place à votre prochain chez-vous.">
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

            <div className="panel pad mt-24 wash" style={{ maxWidth: 440 }}>
              <span className="label label--accent">Un dossier facile à examiner</span>
              <p className="p-sm mt-8">
                Un dossier complet aide le propriétaire à examiner votre
                candidature ; il reste libre de sa sélection.
              </p>
            </div>
        </AuthScenery>
      </div>
    </main>
  );
}
