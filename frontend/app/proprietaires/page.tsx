import { UpcomingScreen } from '@/components/upcoming-screen';

export const metadata = { title: 'Espace propriétaire' };

export default function ProprietairesPage() {
  return (
    <UpcomingScreen
      step="PARCOURS PROPRIÉTAIRE · ÉTAPE 2"
      title="Espace propriétaire"
      text="Le dépôt d'annonce, l'abonnement et le suivi des candidatures arrivent à l'étape 2 de l'ordre de construction."
    />
  );
}
