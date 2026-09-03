import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { OwnerAside } from '@/components/owner-aside';
import { SlotManager } from '@/components/slot-manager';
import {
  ApiError,
  getCurrentUser,
  getOwnerProperty,
  getOwnerSlots,
  getOwnerSummary,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ reference: string }> };

export const metadata: Metadata = { title: 'Créneaux de visite' };

/**
 * Créneaux de visite d'un bien — volet propriétaire de l'écran 5.
 *
 * La maquette annonce des créneaux « ouverts par le propriétaire et l'agent du
 * secteur ». Seul le propriétaire en ouvre pour l'instant : le back-office qui
 * permettrait à un agent d'en ajouter n'existe pas encore.
 */
export default async function OwnerVisitSlotsPage({ params }: Params) {
  const { reference } = await params;
  const user = await getCurrentUser();

  if (!user) redirect('/proprietaires');
  if (user.role !== 'OWNER') redirect('/');

  let property;
  let slots;
  try {
    [property, slots] = await Promise.all([
      getOwnerProperty(reference),
      getOwnerSlots(reference),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const summary = await getOwnerSummary();

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="app">
        <OwnerAside user={user} summary={summary} current="properties" />

        <div className="body">
          <div className="page__head">
            <div>
              <span className="label label--accent">
                {property.reference} · {property.district}
              </span>
              <h1 className="d3 mt-8">Créneaux de visite</h1>
            </div>
            <Link href={`/proprietaires/biens/${reference}`} className="btn btn--ghost btn-sm">
              Retour au bien
            </Link>
          </div>

          <div className="split split--wide mt-24">
            <div>
              <h2 className="h mb-12">Ouvrir des créneaux</h2>
              <SlotManager reference={reference} initial={slots} />
            </div>

            <aside>
              <div className="panel pad wash">
                <span className="label label--accent">Comment ça marche</span>
                <p className="p-sm mt-8">
                  Seuls les candidats que vous avez retenus voient ces créneaux et
                  peuvent en réserver un. Un créneau réservé ne se retire pas :
                  il faut annuler le rendez-vous, ce qui prévient le locataire.
                </p>
                <p className="field__hint mt-10">
                  Un agent Bail est affecté avant le rendez-vous. Vous n’avez pas
                  à être présent.
                </p>
              </div>

              <div className="panel pad mt-16">
                <span className="label label--ink">Candidatures</span>
                <p className="p-sm mt-8">
                  Retenez d’abord un candidat depuis l’écran des candidatures :
                  sans cela, personne ne peut réserver.
                </p>
                <Link
                  href={`/proprietaires/candidatures?bien=${encodeURIComponent(reference)}`}
                  className="btn btn--ghost btn-sm mt-12"
                >
                  Voir les candidatures
                </Link>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
