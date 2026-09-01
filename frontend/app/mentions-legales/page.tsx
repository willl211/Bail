import { UpcomingScreen } from '@/components/upcoming-screen';

export const metadata = { title: 'Mentions légales' };

export default function MentionsLegalesPage() {
  return (
    <UpcomingScreen
      step="INFORMATIONS LÉGALES"
      title="Mentions légales"
      text="Numéro de carte professionnelle, garantie financière et assurance RC Pro seront publiés ici une fois ces éléments obtenus. Ces mentions sont obligatoires avant toute mise en ligne commerciale."
    />
  );
}
