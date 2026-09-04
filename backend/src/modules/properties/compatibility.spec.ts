import { canRankByCompatibility, compatibilityScore } from './compatibility';
import type { CompatibilityFile, CompatibilityProperty } from './compatibility';

const bien = (overrides: Partial<CompatibilityProperty> = {}): CompatibilityProperty => ({
  rentCents: 70_000,
  chargesCents: 5_000,
  acceptedContractTypes: [],
  guarantorRequirement: 'OPTIONAL',
  ...overrides,
});

const dossier = (overrides: Partial<CompatibilityFile> = {}): CompatibilityFile => ({
  netMonthlyIncomeCents: 250_000,
  verified: true,
  submitted: true,
  contractType: 'CDI',
  hasGuarantor: false,
  guarantorVerified: false,
  ...overrides,
});

/**
 * Barème de compatibilité.
 *
 * Il sert deux choses qui doivent s'accorder : la note figée sur une
 * candidature, que le propriétaire lit, et le classement des annonces, que le
 * locataire voit. Ce qui est tenu ici, c'est donc l'ordre qu'il produit — pas
 * la valeur exacte de chaque note, qui n'a de sens que comparée à une autre.
 */
describe('compatibilityScore', () => {
  it('classe le logement le plus abordable devant', () => {
    // Le seul critère qu'aucune pièce ne rattrape : c'est pour ça qu'il pèse
    // le plus lourd des quatre.
    const abordable = compatibilityScore(bien({ rentCents: 50_000 }), dossier());
    const tendu = compatibilityScore(bien({ rentCents: 110_000 }), dossier());

    expect(abordable).toBeGreaterThan(tendu);
  });

  it('annule la part budget au-delà de 50 % d’effort', () => {
    // 1 250 € pour 2 500 € de revenus : la moitié du salaire passe dans le
    // loyer. Au-delà, rien à retrancher de plus — la note ne devient pas
    // négative, elle plafonne à zéro sur cette part.
    const aLaLimite = compatibilityScore(
      bien({ rentCents: 125_000, chargesCents: 0 }),
      dossier(),
    );
    const bienAuDela = compatibilityScore(
      bien({ rentCents: 400_000, chargesCents: 0 }),
      dossier(),
    );

    expect(aLaLimite).toBe(bienAuDela);
  });

  it('retire vingt points quand le contrat n’est pas accepté', () => {
    const accepte = compatibilityScore(bien({ acceptedContractTypes: ['CDI'] }), dossier());
    const refuse = compatibilityScore(
      bien({ acceptedContractTypes: ['CDI'] }),
      dossier({ contractType: 'CDD' }),
    );

    expect(accepte - refuse).toBe(20);
  });

  it('ne pénalise personne quand le propriétaire n’exclut aucun contrat', () => {
    // Liste vide = rien d'exclu. La lire comme « rien d'accepté » écarterait
    // tout le monde des annonces les plus ouvertes.
    expect(compatibilityScore(bien(), dossier({ contractType: 'CDD' }))).toBe(
      compatibilityScore(bien(), dossier({ contractType: 'CDI' })),
    );
  });

  it('accorde la part garant sans garant quand le bien n’en demande pas', () => {
    const sansExigence = compatibilityScore(
      bien({ guarantorRequirement: 'NONE' }),
      dossier({ hasGuarantor: false }),
    );
    const avecExigence = compatibilityScore(
      bien({ guarantorRequirement: 'REQUIRED' }),
      dossier({ hasGuarantor: false }),
    );

    expect(sansExigence - avecExigence).toBe(10);
  });

  it('distingue un garant vérifié d’un garant seulement déclaré', () => {
    const verifie = compatibilityScore(
      bien({ guarantorRequirement: 'REQUIRED' }),
      dossier({ hasGuarantor: true, guarantorVerified: true }),
    );
    const declare = compatibilityScore(
      bien({ guarantorRequirement: 'REQUIRED' }),
      dossier({ hasGuarantor: true, guarantorVerified: false }),
    );

    expect(verifie - declare).toBe(5);
  });

  it('récompense le dossier vérifié plus que le dossier seulement transmis', () => {
    const verifie = compatibilityScore(bien(), dossier({ verified: true }));
    const transmis = compatibilityScore(bien(), dossier({ verified: false, submitted: true }));
    const brouillon = compatibilityScore(
      bien(),
      dossier({ verified: false, submitted: false }),
    );

    expect(verifie - transmis).toBe(15);
    expect(transmis - brouillon).toBe(15);
  });

  it('reste entre 0 et 100', () => {
    const meilleur = compatibilityScore(
      bien({ rentCents: 10_000, chargesCents: 0, guarantorRequirement: 'NONE' }),
      dossier({ netMonthlyIncomeCents: 1_000_000 }),
    );
    const pire = compatibilityScore(
      bien({
        rentCents: 500_000,
        acceptedContractTypes: ['CDI'],
        guarantorRequirement: 'REQUIRED',
      }),
      dossier({
        netMonthlyIncomeCents: 100_000,
        verified: false,
        submitted: false,
        contractType: 'CDD',
      }),
    );

    expect(meilleur).toBeLessThanOrEqual(100);
    expect(pire).toBeGreaterThanOrEqual(0);
  });

  it('ne compte aucun point budget sans revenus déclarés', () => {
    const sansRevenus = compatibilityScore(bien(), dossier({ netMonthlyIncomeCents: null }));
    const avecRevenus = compatibilityScore(bien(), dossier());

    expect(sansRevenus).toBeLessThan(avecRevenus);
  });
});

describe('canRankByCompatibility', () => {
  it('refuse de classer sans revenus au dossier', () => {
    // Les trois autres parts valent autant sur toutes les annonces : sans le
    // budget, le classement laisserait la moitié du portefeuille ex æquo, et
    // vaudrait moins que la récence.
    expect(canRankByCompatibility(null)).toBe(false);
    expect(canRankByCompatibility(dossier({ netMonthlyIncomeCents: null }))).toBe(false);
    expect(canRankByCompatibility(dossier({ netMonthlyIncomeCents: 0 }))).toBe(false);
  });

  it('classe dès que les revenus sont renseignés, vérifiés ou non', () => {
    // Attendre la vérification priverait du classement ceux qui en ont le plus
    // besoin : ceux qui viennent d'arriver.
    expect(canRankByCompatibility(dossier({ verified: false, submitted: false }))).toBe(true);
  });
});
