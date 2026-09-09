import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TenantFileScreen } from './tenant-file-screen';
import { SavedScreen } from './saved-screen';
import { submitFile, updateProfile, saveGuarantor, deleteGuarantor } from '@/lib/tenant-client';
import type { CurrentUser, SavedPropertyItem, TenantFileView } from '@/lib/api';

jest.mock('@/lib/tenant-client', () => ({
  submitFile: jest.fn(),
  updateProfile: jest.fn(),
  saveGuarantor: jest.fn(),
  deleteGuarantor: jest.fn(),
  documentFileUrl: jest.fn(),
  uploadDocument: jest.fn(),
  deleteDocument: jest.fn(),
}));
const user: CurrentUser = {
  id: 'tenant',
  role: 'TENANT',
  email: 'camille@exemple.test',
  firstName: 'Camille',
  lastName: 'Ferry',
  phone: null,
  emailVerified: true,
  createdAt: '2026-09-01T10:00:00Z',
};
const file: TenantFileView = {
  revision: 1,
  verifiedRevision: null,
  reference: 'LOC-0871',
  status: 'DRAFT',
  holderName: 'Camille Ferry',
  contractType: 'CDI',
  employerName: 'Atelier',
  inProbationPeriod: false,
  netMonthlyIncomeCents: 298000,
  incomeVerified: false,
  maxRentCents: 99333,
  verifiedSlotCount: 0,
  expectedSlotCount: 1,
  missing: ['Pièce d’identité'],
  awaiting: [],
  groups: { identity: 'MISSING', income: 'MISSING', housing: 'MISSING', guarantor: 'MISSING' },
  slots: [
    {
      type: 'ID_CARD',
      label: 'Pièce d’identité',
      hint: 'Recto et verso',
      group: 'identity',
      max: 1,
      required: true,
      status: 'MISSING',
      documents: [],
    },
  ],
  guarantor: null,
  journal: [],
  submittedAt: null,
  verifiedAt: null,
  verificationDriver: 'mock',
};

function openSection(label: string) {
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Rubriques du dossier' })).getByRole('button', {
      name: label,
    }),
  );
}

const readyFile: TenantFileView = {
  ...file,
  missing: [],
  slots: file.slots.map((slot) => ({ ...slot, status: 'PENDING' })),
};

describe('Dossier locataire par rubriques', () => {
  it('montre le résumé à l’arrivée et garde les formulaires hors de la vue', () => {
    render(<TenantFileScreen user={user} initial={file} />);
    expect(screen.getByRole('region', { name: 'Vue d’ensemble' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Ma situation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Rechercher un bien' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Transmettre mon dossier' })).toBeDisabled();
  });

  it('conserve les champs non enregistrés quand on change de rubrique', () => {
    render(<TenantFileScreen user={user} initial={file} />);
    openSection('Ma situation');
    fireEvent.click(screen.getByRole('button', { name: 'Modifier ma situation' }));
    const employer = within(screen.getByRole('region', { name: 'Ma situation' })).getByRole(
      'textbox',
      { name: 'Employeur' },
    );
    fireEvent.change(employer, { target: { value: 'Nouvel atelier' } });
    openSection('Mes documents');
    expect(screen.getByRole('region', { name: 'Documents à traiter' })).toBeVisible();
    openSection('Ma situation');
    expect(employer).toHaveValue('Nouvel atelier');
  });

  it('transmet un dossier complet et affiche le statut renvoyé', async () => {
    jest.mocked(submitFile).mockResolvedValue({ ...file, missing: [], status: 'SUBMITTED' });
    render(<TenantFileScreen user={user} initial={readyFile} />);
    fireEvent.click(screen.getByRole('button', { name: 'Transmettre mon dossier' }));
    await waitFor(() => expect(submitFile).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: 'Dossier transmis' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Transmettre mon dossier' }),
    ).not.toBeInTheDocument();
  });

  it('laisse le dossier intact et permet de réessayer après un échec', async () => {
    jest.mocked(submitFile).mockRejectedValue({ message: 'Envoi impossible.' });
    render(<TenantFileScreen user={user} initial={readyFile} />);
    fireEvent.click(screen.getByRole('button', { name: 'Transmettre mon dossier' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Envoi impossible.');
    expect(screen.getByRole('button', { name: 'Transmettre mon dossier' })).toBeEnabled();
  });

  it('maintient les modifications verrouillées dans chaque rubrique pendant le contrôle', () => {
    render(<TenantFileScreen user={user} initial={{ ...file, status: 'UNDER_REVIEW' }} />);
    openSection('Ma situation');
    expect(screen.queryByRole('button', { name: 'Modifier ma situation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument();
    openSection('Mes documents');
    expect(screen.queryByRole('button', { name: 'Déposer' })).not.toBeInTheDocument();
    openSection('Mon garant');
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Déclarer un garant' })).not.toBeInTheDocument();
  });

  it('consulte la situation avant édition et restaure les valeurs si on annule', () => {
    render(<TenantFileScreen user={user} initial={file} />);
    openSection('Ma situation');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Atelier')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Modifier ma situation' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Employeur' }), {
      target: { value: 'Saisie abandonnée' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(updateProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Modifier ma situation' }));
    expect(screen.getByRole('textbox', { name: 'Employeur' })).toHaveValue('Atelier');
  });

  it('ne transforme pas un revenu négatif en montant positif', async () => {
    render(<TenantFileScreen user={user} initial={readyFile} />);
    openSection('Ma situation');
    fireEvent.click(screen.getByRole('button', { name: 'Modifier ma situation' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Revenus nets mensuels/ }), {
      target: { value: '-2500' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Revenus illisibles');
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('conserve les centimes lorsque le formulaire est enregistré sans changement', async () => {
    const precise = { ...readyFile, netMonthlyIncomeCents: 298_055 };
    jest.mocked(updateProfile).mockResolvedValue(precise);
    render(<TenantFileScreen user={user} initial={precise} />);
    openSection('Ma situation');
    fireEvent.click(screen.getByRole('button', { name: 'Modifier ma situation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ netMonthlyIncomeCents: 298_055 }),
      ),
    );
  });

  it('explique la remise en contrôle et affiche la situation enregistrée', async () => {
    jest.mocked(updateProfile).mockResolvedValue({
      ...readyFile,
      status: 'SUBMITTED',
      employerName: 'Nouvel atelier',
      contractType: 'CDD',
    });
    render(<TenantFileScreen user={user} initial={{ ...readyFile, status: 'VERIFIED' }} />);
    openSection('Ma situation');
    fireEvent.click(screen.getByRole('button', { name: 'Modifier ma situation' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'CDD' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Employeur' }), {
      target: { value: 'Nouvel atelier' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText(/Votre dossier doit être vérifié à nouveau/)).toBeVisible();
    expect(screen.getByText('Nouvel atelier')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    openSection('Vue d’ensemble');
    expect(screen.getByRole('heading', { name: 'Dossier transmis' })).toBeVisible();
  });

  it('met les pièces refusées avant les manquantes et replie celles qui sont validées', () => {
    const identity = {
      ...file.slots[0],
      label: 'Identité validée',
      status: 'VERIFIED' as const,
    };
    const rejected = {
      ...file.slots[0],
      type: 'PAYSLIP' as const,
      group: 'income' as const,
      label: 'Bulletin illisible',
      status: 'REJECTED' as const,
    };
    const housing = {
      ...file.slots[0],
      type: 'PROOF_OF_ADDRESS' as const,
      group: 'housing' as const,
      label: 'Domicile manquant',
    };
    render(
      <TenantFileScreen user={user} initial={{ ...file, slots: [identity, housing, rejected] }} />,
    );
    openSection('Mes documents');
    const attention = screen.getByRole('region', { name: 'Documents à traiter' });
    const names = [...attention.querySelectorAll('.doc__n')].map((node) => node.textContent);
    expect(names).toEqual(['Bulletin illisible', 'Domicile manquant']);
    expect(screen.getByText('Identité validée')).not.toBeVisible();
    fireEvent.click(screen.getByText('Documents validés'));
    expect(screen.getByText('Identité validée')).toBeVisible();
  });

  it('n’envoie que les champs utiles au type de garant sélectionné', async () => {
    const organisation = {
      id: 'g',
      kind: 'ORGANISATION' as const,
      firstName: null,
      lastName: null,
      organisationName: 'Visale',
      relationship: null,
      netMonthlyIncomeCents: null,
      contractType: null,
    };
    jest.mocked(saveGuarantor).mockResolvedValue({ ...file, guarantor: organisation });
    render(<TenantFileScreen user={user} initial={file} />);
    openSection('Mon garant');
    fireEvent.click(screen.getByRole('radio', { name: /Une personne/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Prénom' }), {
      target: { value: 'Martine' },
    });
    fireEvent.click(screen.getByRole('radio', { name: /Un organisme/ }));
    expect(screen.queryByRole('textbox', { name: 'Prénom' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /Nom de l’organisme/ }), {
      target: { value: 'Visale' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer mon garant' }));
    await waitFor(() =>
      expect(saveGuarantor).toHaveBeenCalledWith({
        kind: 'ORGANISATION',
        organisationName: 'Visale',
      }),
    );
  });

  it('ne retire jamais le garant au simple choix Aucun et permet de revenir en arrière', async () => {
    jest.mocked(deleteGuarantor).mockResolvedValue(file);
    const guarantor = {
      id: 'g',
      kind: 'INDIVIDUAL' as const,
      firstName: 'Martine',
      lastName: 'Ferry',
      organisationName: null,
      relationship: 'Mère',
      netMonthlyIncomeCents: 410000,
      contractType: null,
    };
    render(<TenantFileScreen user={user} initial={{ ...file, guarantor }} />);
    openSection('Mon garant');
    fireEvent.click(screen.getByRole('radio', { name: /Aucun garant/ }));
    expect(deleteGuarantor).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Conserver mon garant' }));
    expect(screen.getByRole('textbox', { name: 'Prénom' })).toHaveValue('Martine');
    fireEvent.click(screen.getByRole('radio', { name: /Aucun garant/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le retrait du garant' }));
    await waitFor(() => expect(deleteGuarantor).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Vous continuez sans garant')).toBeVisible();
  });

  it('garde les biens retirés visibles avec leur vignette, sans lien de candidature', () => {
    const item: SavedPropertyItem = {
      reference: 'MZ-0155',
      title: 'Appartement Sablon',
      district: 'Sablon',
      surfaceM2: 55,
      rooms: 3,
      furnished: false,
      energyRating: 'C',
      totalRentCents: 96500,
      photoUrl: '/images/test-photo.jpg',
      status: 'RENTED',
      available: false,
      savedAt: '2026-09-08T10:00:00Z',
    };
    render(<SavedScreen user={user} file={file} items={[item]} />);
    expect(screen.getByText('Loué')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Voir l’annonce' })).not.toBeInTheDocument();
    const photo = screen.getByRole('img', { name: item.title });
    expect(photo).toHaveAttribute('src', item.photoUrl);
    fireEvent.error(photo);
    expect(screen.getByText('Photo indisponible')).toBeVisible();
  });
});
