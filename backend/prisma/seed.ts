/**
 * Jeu de données de démonstration.
 *
 * Les 8 biens repris ici sont exactement ceux de la maquette Claude Design
 * (`maquette_interface/project/Seuil Metz.dc.html`), pour que l'écran construit
 * soit comparable au pixel près avec la maquette.
 *
 * Ce que ce seed NE fait PAS, volontairement :
 *  - il ne fige aucun montant d'honoraires ni d'abonnement dans le code : tout
 *    passe par `fee_schedules`, avec `isLegallyApproved = false` tant que
 *    l'avocat n'a pas validé (docs/legal-context.md) ;
 *  - il ne rédige aucune clause de bail : le modèle légal seedé est un squelette
 *    de champs, inactif, à remplacer par le texte fourni par l'avocat
 *    (CLAUDE.md règle 2).
 */
import { createHash } from 'node:crypto';
import {
  EnergyRating,
  GuarantorRequirement,
  LeaseType,
  PrismaClient,
  PropertyStatus,
  RentalZone,
  UserRole,
} from '@prisma/client';

const prisma = new PrismaClient();

const DISTRICTS = [
  { slug: 'centre-ville', name: 'Centre-ville' },
  { slug: 'sablon', name: 'Sablon' },
  { slug: 'nouvelle-ville', name: 'Nouvelle Ville' },
  { slug: 'queuleu', name: 'Queuleu' },
  { slug: 'devant-les-ponts', name: 'Devant-les-Ponts' },
  { slug: 'outre-seille', name: 'Outre-Seille' },
];

interface SeedProperty {
  reference: string;
  title: string;
  districtSlug: string;
  addressLine: string;
  rent: number; // euros, hors charges
  charges: number; // euros
  surfaceM2: number;
  rooms: number;
  bedrooms: number | null;
  floor: string;
  furnished: boolean;
  energyRating: EnergyRating;
  gesRating: EnergyRating;
  constructionYear: number | null;
  availableFrom: string | null; // null = disponible immédiatement
  description: string;
  photos: string[];
}

const PROPERTIES: SeedProperty[] = [
  {
    reference: 'MZ-0142',
    title: '2 pièces, Centre-ville',
    districtSlug: 'centre-ville',
    addressLine: '8 rue Dupont des Loges',
    rent: 690,
    charges: 60,
    surfaceM2: 47,
    rooms: 2,
    bedrooms: 1,
    floor: '3/4',
    furnished: false,
    energyRating: EnergyRating.C,
    gesRating: EnergyRating.C,
    constructionYear: 1928,
    availableFrom: '2026-10-01',
    description:
      "Deux pièces clair au troisième étage d'un immeuble bourgeois, parquet point de Hongrie et moulures conservées. Cuisine séparée équipée, salle d'eau refaite. Chauffage individuel au gaz. À deux pas de la place Saint-Jacques et des commerces du centre.",
    photos: ['photo · séjour', 'photo · cuisine', 'photo · chambre', 'photo · immeuble'],
  },
  {
    reference: 'MZ-0155',
    title: '3 pièces, Sablon',
    districtSlug: 'sablon',
    addressLine: '14 rue de Verdun',
    rent: 880,
    charges: 85,
    surfaceM2: 68,
    rooms: 3,
    bedrooms: 2,
    floor: '1/3',
    furnished: false,
    energyRating: EnergyRating.D,
    gesRating: EnergyRating.D,
    constructionYear: 1930,
    availableFrom: '2026-09-15',
    description:
      "Appartement traversant dans un immeuble de 1930, parquet d'origine et hauteur sous plafond de 2,90 m. Cuisine équipée séparée, salle de bain refaite en 2024, chauffage collectif au gaz. Cave privative en sous-sol.\n\nÀ cinq minutes à pied de la gare de Metz et des lignes Mettis A et B. Commerces de proximité au pied de l'immeuble.",
    photos: ['photo · séjour', 'photo · cuisine', 'photo · chambre', 'photo · immeuble'],
  },
  {
    reference: 'MZ-0161',
    title: 'Studio meublé, Nouvelle Ville',
    districtSlug: 'nouvelle-ville',
    addressLine: '22 avenue Foch',
    rent: 540,
    charges: 45,
    surfaceM2: 26,
    rooms: 1,
    bedrooms: null,
    floor: '5/5',
    furnished: true,
    energyRating: EnergyRating.C,
    gesRating: EnergyRating.C,
    constructionYear: 1908,
    availableFrom: null,
    description:
      "Studio meublé sous combles, entièrement rénové en 2025. Coin cuisine équipé, salle d'eau avec douche à l'italienne, rangements sur mesure. Immeuble avec ascenseur, local à vélos. Idéal étudiant ou jeune actif : arrêt Mettis à 200 m et campus Saulcy à dix minutes.",
    photos: ['photo · pièce', 'photo · cuisine', 'photo · salle d\'eau', 'photo · immeuble'],
  },
  {
    reference: 'MZ-0168',
    title: '4 pièces, Queuleu',
    districtSlug: 'queuleu',
    addressLine: '3 rue des Alliés',
    rent: 1150,
    charges: 110,
    surfaceM2: 92,
    rooms: 4,
    bedrooms: 3,
    floor: 'RDC',
    furnished: false,
    energyRating: EnergyRating.B,
    gesRating: EnergyRating.B,
    constructionYear: 2016,
    availableFrom: '2026-11-01',
    description:
      "Quatre pièces en rez-de-jardin dans une petite copropriété récente. Séjour de 32 m² prolongé par une terrasse plein sud et un jardin privatif clos de 60 m². Cuisine ouverte équipée, trois chambres, deux salles d'eau. Place de parking en sous-sol et local à vélos.",
    photos: ['photo · jardin', 'photo · séjour', 'photo · cuisine', 'photo · terrasse'],
  },
  {
    reference: 'MZ-0173',
    title: '2 pièces meublé, Outre-Seille',
    districtSlug: 'outre-seille',
    addressLine: '11 rue Mazelle',
    rent: 720,
    charges: 70,
    surfaceM2: 44,
    rooms: 2,
    bedrooms: 1,
    floor: '2/3',
    furnished: true,
    energyRating: EnergyRating.D,
    gesRating: EnergyRating.D,
    constructionYear: 1890,
    availableFrom: '2026-10-01',
    description:
      "Deux pièces meublé dans le quartier ancien d'Outre-Seille, poutres apparentes et pierre de Jaumont en façade. Séjour avec coin cuisine entièrement équipé, chambre sur cour au calme. Mobilier récent, literie neuve. Marché couvert et quais de la Seille à proximité immédiate.",
    photos: ['photo · cuisine', 'photo · séjour', 'photo · chambre', 'photo · rue'],
  },
  {
    reference: 'MZ-0180',
    title: '3 pièces, Devant-les-Ponts',
    districtSlug: 'devant-les-ponts',
    addressLine: '27 rue de Paris',
    rent: 820,
    charges: 75,
    surfaceM2: 71,
    rooms: 3,
    bedrooms: 2,
    floor: '2/4',
    furnished: false,
    energyRating: EnergyRating.C,
    gesRating: EnergyRating.C,
    constructionYear: 1972,
    availableFrom: '2026-09-20',
    description:
      'Trois pièces traversant avec balcon, dans une résidence entretenue avec espaces verts. Séjour double exposition, deux chambres avec placards, cuisine indépendante. Double vitrage posé en 2023, chauffage collectif. Cave et place de stationnement extérieure incluses.',
    photos: ['photo · séjour', 'photo · balcon', 'photo · chambre', 'photo · résidence'],
  },
  {
    reference: 'MZ-0186',
    title: 'Loft, Nouvelle Ville',
    districtSlug: 'nouvelle-ville',
    addressLine: '5 rue Charlemagne',
    rent: 1320,
    charges: 120,
    surfaceM2: 104,
    rooms: 3,
    bedrooms: 2,
    floor: '4/4',
    furnished: false,
    energyRating: EnergyRating.B,
    gesRating: EnergyRating.B,
    constructionYear: 1911,
    availableFrom: '2026-12-01',
    description:
      "Ancien atelier réhabilité en loft au dernier étage, 3,60 m sous plafond et verrière plein est. Vaste pièce de vie de 55 m², cuisine ouverte sur mesure, deux chambres cloisonnées, salle de bain avec baignoire. Isolation et menuiseries refaites lors de la réhabilitation.",
    photos: ['photo · volume', 'photo · verrière', 'photo · cuisine', 'photo · chambre'],
  },
  {
    reference: 'MZ-0191',
    title: 'Studio, Centre-ville',
    districtSlug: 'centre-ville',
    addressLine: '2 place Saint-Louis',
    rent: 480,
    charges: 40,
    surfaceM2: 21,
    rooms: 1,
    bedrooms: null,
    floor: '1/3',
    furnished: true,
    energyRating: EnergyRating.E,
    gesRating: EnergyRating.E,
    constructionYear: 1850,
    availableFrom: null,
    description:
      "Studio meublé donnant sur les arcades de la place Saint-Louis. Pièce unique avec coin nuit séparé par une cloison ajourée, kitchenette équipée, salle d'eau. Immeuble classé, escalier en pierre. Emplacement rare, tout le centre historique à pied.",
    photos: ['photo · pièce', 'photo · kitchenette', 'photo · place', 'photo · immeuble'],
  },
];

/**
 * Squelette de bail : uniquement des marqueurs de champs et des intitulés de
 * rubriques imposés par la loi. AUCUNE clause n'est rédigée ici — le texte
 * définitif viendra de l'avocat en droit immobilier (docs/legal-context.md).
 * Le modèle est seedé `isActive = false` : la génération de bail est bloquée
 * tant qu'un texte validé n'a pas été publié.
 */
const LEASE_TEMPLATE_SKELETON = [
  '# {{ titreContrat }}',
  '',
  '## 1. Désignation des parties',
  'Bailleur : {{ bailleurNomComplet }}, {{ bailleurAdresse }}',
  'Locataire : {{ locataireNomComplet }}',
  '',
  '## 2. Objet du contrat',
  'Adresse du logement : {{ logementAdresse }}',
  'Type d\'habitat : {{ logementTypeHabitat }}',
  'Surface habitable : {{ logementSurfaceM2 }} m²',
  'Nombre de pièces principales : {{ logementNombrePieces }}',
  '',
  '## 3. Date de prise d\'effet et durée du contrat',
  'Date de prise d\'effet : {{ bailDateDebut }}',
  'Durée : {{ bailDureeMois }} mois',
  '',
  '## 4. Conditions financières',
  'Loyer mensuel hors charges : {{ loyerMensuel }}',
  'Provision sur charges : {{ provisionCharges }}',
  'Dépôt de garantie : {{ depotGarantie }}',
  '',
  '## 5. Travaux',
  '{{ travauxMention }}',
  '',
  '## 6. Garanties',
  '{{ garantiesMention }}',
  '',
  '## 7. Clause de solidarité et clause résolutoire',
  '{{ clausesLegalesTexteValide }}',
  '',
  '## 8. Honoraires',
  '{{ honorairesMention }}',
  '',
  '## Annexes',
  '{{ listeAnnexes }}',
  '',
  '<!-- TEXTE NON VALIDÉ JURIDIQUEMENT. Ce squelette ne contient aucune clause :',
  '     il attend le modèle fourni par l\'avocat en droit immobilier. -->',
].join('\n');

const LEASE_FIELD_SCHEMA = {
  titreContrat: { type: 'string', required: true },
  bailleurNomComplet: { type: 'string', required: true },
  bailleurAdresse: { type: 'string', required: true },
  locataireNomComplet: { type: 'string', required: true },
  logementAdresse: { type: 'string', required: true },
  logementTypeHabitat: { type: 'enum', values: ['immeuble collectif', 'immeuble individuel'], required: true },
  logementSurfaceM2: { type: 'number', required: true, min: 9 },
  logementNombrePieces: { type: 'integer', required: true, min: 1 },
  bailDateDebut: { type: 'date', required: true },
  bailDureeMois: { type: 'integer', required: true },
  loyerMensuel: { type: 'money', required: true },
  provisionCharges: { type: 'money', required: true },
  depotGarantie: { type: 'money', required: true },
  travauxMention: { type: 'string', required: false },
  garantiesMention: { type: 'string', required: false },
  clausesLegalesTexteValide: { type: 'locked', required: true },
  honorairesMention: { type: 'string', required: true },
  listeAnnexes: { type: 'string', required: true },
} as const;

const checksum = (body: string) => createHash('sha256').update(body, 'utf8').digest('hex');

async function main() {
  console.log('Seed — début');

  // --- Quartiers -------------------------------------------------------------
  for (const [index, district] of DISTRICTS.entries()) {
    await prisma.district.upsert({
      where: { slug: district.slug },
      update: { name: district.name, position: index },
      create: { ...district, position: index, city: 'Metz' },
    });
  }
  console.log(`  ${DISTRICTS.length} quartiers`);

  // --- Utilisateurs de démonstration -----------------------------------------
  const owner = await prisma.user.upsert({
    where: { email: 'proprietaire.demo@seuil.local' },
    update: {},
    create: {
      email: 'proprietaire.demo@seuil.local',
      role: UserRole.OWNER,
      firstName: 'Hélène',
      lastName: 'Marchal',
      phone: '+33 3 87 00 00 01',
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.user.upsert({
    where: { email: 'agent.demo@seuil.local' },
    update: {},
    create: {
      email: 'agent.demo@seuil.local',
      role: UserRole.AGENT,
      firstName: 'Yanis',
      lastName: 'Bertrand',
      emailVerifiedAt: new Date(),
    },
  });
  console.log('  2 utilisateurs de démonstration (propriétaire, agent)');

  // --- Barème d'honoraires ---------------------------------------------------
  // Placeholders alignés sur les plafonds légaux au m². À FIGER avec l'avocat :
  // tant que `isLegallyApproved` est faux, aucun montant ne doit être facturé.
  const feeSchedule = await prisma.feeSchedule.upsert({
    where: { code: 'METZ-2026-PROVISOIRE' },
    update: {},
    create: {
      code: 'METZ-2026-PROVISOIRE',
      label: 'Barème provisoire — pilote Metz',
      zone: RentalZone.ZONE_NON_TENDUE,
      tenantVisitFeeCentsPerSqm: 1000, // 10,00 € / m²
      tenantInventoryFeeCentsPerSqm: 300, // 3,00 € / m²
      ownerFeeCentsPerSqm: 1000,
      ownerSubscriptionMonthlyCents: 3900, // 39 € / mois / bien
      effectiveFrom: new Date('2026-01-01'),
      isActive: true,
      isLegallyApproved: false,
      notes:
        "Valeurs provisoires. Le barème définitif et la zone de tension applicable à Metz doivent être confirmés par l'avocat en droit immobilier avant toute facturation réelle (docs/legal-context.md).",
    },
  });
  console.log(`  barème ${feeSchedule.code} (non validé juridiquement)`);

  // --- Réglages modifiables sans redéploiement -------------------------------
  const settings = [
    {
      key: 'market.metz.averageResponseDelay',
      value: '32 h',
      description:
        "Délai moyen de réponse affiché sur la page d'accueil. Non calculable avant le lancement pilote : valeur saisie, à remplacer par une mesure réelle.",
    },
    {
      key: 'market.metz.filesVerifiedWithoutExchange',
      value: '96 %',
      description:
        'Part des dossiers vérifiés sans échange supplémentaire. Valeur saisie tant que la donnée d\'usage n\'existe pas.',
    },
    {
      key: 'visits.recordingRetentionDays',
      value: 15,
      description:
        'Durée de conservation des enregistrements de visite, en jours (docs/integrations.md).',
    },
    {
      key: 'visits.cameraRequired',
      value: true,
      description:
        'Caméra obligatoire pendant la visite. Décision confirmée : ce réglage est exposé pour audit, pas pour être désactivé.',
    },
    {
      key: 'lease.generationEnabled',
      value: false,
      description:
        "Génération de bail bloquée tant qu'aucun modèle légal validé par un avocat n'est publié.",
    },
  ];
  for (const setting of settings) {
    await prisma.platformSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value, description: setting.description },
      create: setting,
    });
  }
  console.log(`  ${settings.length} réglages plateforme`);

  // --- Modèles de bail (squelettes verrouillés, inactifs) --------------------
  for (const type of [LeaseType.NU, LeaseType.MEUBLE] as const) {
    const code = type === LeaseType.NU ? 'BAIL_NU_LOI_1989' : 'BAIL_MEUBLE_LOI_1989';
    const body = LEASE_TEMPLATE_SKELETON;
    await prisma.leaseTemplate.upsert({
      where: { code_version: { code, version: 1 } },
      update: {},
      create: {
        code,
        version: 1,
        label:
          type === LeaseType.NU
            ? 'Bail de location nue — squelette en attente de validation'
            : 'Bail de location meublée — squelette en attente de validation',
        type,
        body,
        fieldSchema: LEASE_FIELD_SCHEMA as unknown as object,
        checksum: checksum(body),
        legalReference: 'Loi n° 89-462 du 6 juillet 1989',
        isActive: false,
      },
    });
  }
  console.log('  2 modèles de bail (inactifs, en attente du texte de l\'avocat)');

  // --- Biens -----------------------------------------------------------------
  const districtsBySlug = new Map(
    (await prisma.district.findMany()).map((district) => [district.slug, district.id]),
  );

  // Publication échelonnée : le tri par défaut est « les plus récentes », donc
  // les trois premières de la liste sont celles mises en avant sur l'accueil,
  // exactement comme dans la maquette.
  const publishedBase = new Date('2026-08-28T09:00:00.000Z');

  for (const [index, seed] of PROPERTIES.entries()) {
    const districtId = districtsBySlug.get(seed.districtSlug);
    if (!districtId) throw new Error(`Quartier inconnu : ${seed.districtSlug}`);

    const leaseType = seed.furnished ? LeaseType.MEUBLE : LeaseType.NU;
    const rentCents = seed.rent * 100;
    const publishedAt = new Date(publishedBase.getTime() - index * 36 * 3600 * 1000);

    const property = await prisma.property.upsert({
      where: { reference: seed.reference },
      update: {},
      create: {
        reference: seed.reference,
        ownerId: owner.id,
        title: seed.title,
        description: seed.description,
        addressLine: seed.addressLine,
        districtId,
        city: 'Metz',
        postalCode: '57000',
        surfaceM2: seed.surfaceM2,
        rooms: seed.rooms,
        bedrooms: seed.bedrooms,
        floor: seed.floor,
        furnished: seed.furnished,
        leaseType,
        energyRating: seed.energyRating,
        gesRating: seed.gesRating,
        constructionYear: seed.constructionYear,
        rentCents,
        chargesCents: seed.charges * 100,
        // Dépôt de garantie : 1 mois de loyer hors charges en location nue,
        // 2 mois en meublé (loi du 6 juillet 1989).
        depositCents: seed.furnished ? rentCents * 2 : rentCents,
        availableFrom: seed.availableFrom ? new Date(seed.availableFrom) : null,
        availableImmediately: seed.availableFrom === null,
        // Critères repris de la maquette : 3× le loyer hors charges,
        // garant facultatif, CDI ou fonction publique.
        minMonthlyIncomeCents: rentCents * 3,
        guarantorRequirement: GuarantorRequirement.OPTIONAL,
        acceptedContractTypes: ['CDI', 'PUBLIC_SECTOR'],
        status: PropertyStatus.ONLINE,
        publishedAt,
      },
    });

    const existingPhotos = await prisma.propertyPhoto.count({ where: { propertyId: property.id } });
    if (existingPhotos === 0) {
      await prisma.propertyPhoto.createMany({
        data: seed.photos.map((caption, position) => ({
          propertyId: property.id,
          storageKey: `demo/${seed.reference.toLowerCase()}/${position + 1}.jpg`,
          caption,
          position,
        })),
      });
    }
  }
  console.log(`  ${PROPERTIES.length} biens en ligne`);

  console.log('Seed — terminé');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
