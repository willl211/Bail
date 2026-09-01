import { UpcomingScreen } from '@/components/upcoming-screen';

export const metadata = { title: 'Vérification des dossiers' };

export default function VerificationPage() {
  return (
    <UpcomingScreen
      step="VÉRIFICATION"
      title="Comment les dossiers sont vérifiés"
      text="La page explicative du contrôle d'identité et de revenus sera rédigée quand le prestataire de vérification aura été choisi — il est mocké pendant tout le développement."
    />
  );
}
