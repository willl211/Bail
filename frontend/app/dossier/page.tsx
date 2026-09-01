import { UpcomingScreen } from '@/components/upcoming-screen';

export const metadata = { title: 'Dossier locataire' };

export default function DossierPage() {
  return (
    <UpcomingScreen
      step="PARCOURS LOCATAIRE · ÉTAPE 3"
      title="Création de compte et dossier numérique"
      text="Le dépôt des justificatifs, leur vérification et le suivi des candidatures arrivent à l'étape 3 de l'ordre de construction. L'écran de recherche et la fiche annonce, consultables sans compte, sont en place."
    />
  );
}
