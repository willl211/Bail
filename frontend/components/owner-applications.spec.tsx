import { fireEvent, render, screen } from '@testing-library/react';
import { OwnerApplications } from './owner-applications';
import type { OwnerApplicationsView, OwnerApplication } from '@/lib/api';

jest.mock('./application-decision', () => ({
  ApplicationDecision: ({ applicationId }: { applicationId: string }) => (
    <div data-testid="decision">{applicationId}</div>
  ),
}));

const application = (
  id: string,
  propertyReference: string,
  tenantName: string,
): OwnerApplication => ({
  id,
  propertyReference,
  propertyTitle: 'Logement',
  tenantName,
  tenantInitials: 'AB',
  fileReference: `DOS-${id}`,
  fileStatus: 'VERIFIED',
  netMonthlyIncomeCents: 250000,
  contractType: 'CDI',
  employerName: 'Employeur',
  identityVerified: true,
  message: 'Bonjour',
  effortRate: 0.25,
  guarantorLabel: null,
  verifiedDocumentCount: 3,
  documentCount: 3,
  status: 'SUBMITTED',
  submittedAt: '2026-09-01T10:00:00Z',
});
const view: OwnerApplicationsView = {
  newCount: 2,
  underReviewCount: 0,
  visitsScheduledCount: 0,
  averageResponseHours: null,
  tiles: Array.from({ length: 18 }, (_, index) => ({
    reference: `MZ-${index}`,
    title: `Logement ${index}`,
    district: index === 9 ? 'Queuleu' : 'Sablon',
    addressLine: `${index + 1} rue des Écoles`,
    photoUrl: null,
    status: 'ONLINE' as const,
    open: true,
    applicationCount: index < 2 ? 1 : 0,
    totalRentCents: 75000,
    rooms: 2,
    furnished: false,
    hint: null,
    publishedAt: '2026-09-01T10:00:00Z',
  })),
  applications: [
    application('A', 'MZ-0', 'Camille Ferry'),
    application('B', 'MZ-1', 'Noah Bertrand'),
  ],
};

describe('Candidatures organisées par bien', () => {
  it('pagine un grand portefeuille et retrouve un bien par son adresse sans les accents', () => {
    render(<OwnerApplications view={view} />);
    expect(screen.getAllByRole('link')).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
    expect(screen.getByText('Page 2 sur 3')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: '10 rue des ecoles' },
    });
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/proprietaires/candidatures?bien=MZ-9',
    );
  });

  it('isole les logements qui ont de nouveaux dossiers et permet de réinitialiser une recherche vide', () => {
    render(<OwnerApplications view={view} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Afficher' }), {
      target: { value: 'new' },
    });
    expect(screen.getAllByRole('link')).toHaveLength(2);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'introuvable' } });
    expect(screen.getByText('Aucun bien à afficher')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser la recherche' }));
    expect(screen.getAllByRole('link')).toHaveLength(8);
  });

  it('ne mélange pas les candidats de deux logements et cible la bonne décision', () => {
    render(<OwnerApplications view={view} propertyReference="MZ-0" candidateId="B" />);
    expect(screen.queryByText('Noah Bertrand')).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Dossier de Camille Ferry' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('decision')).toHaveTextContent('A');
    expect(screen.getByRole('link', { name: 'Voir le bien ↗' })).toHaveAttribute(
      'href',
      '/proprietaires/biens/MZ-0',
    );
  });

  it('affiche un état explicite pour un bien sans candidature', () => {
    render(<OwnerApplications view={view} propertyReference="MZ-9" />);
    expect(screen.getByText('Aucune candidature pour ce logement')).toBeInTheDocument();
    expect(screen.queryByTestId('decision')).not.toBeInTheDocument();
  });
});
