/**
 * Jeu de données de démonstration.
 *
 * Les 8 biens repris ici sont exactement ceux de la maquette de référence
 * (`maquette_interface/bail/bail.html`, tableau `LISTINGS`), pour que l'écran
 * construit soit comparable au pixel près avec la maquette (CLAUDE.md règle 4).
 *
 * Ce que ce seed NE fait PAS, volontairement :
 *  - il ne fige aucun montant d'honoraires ni d'abonnement dans le code : tout
 *    passe par `fee_schedules`, avec `isLegallyApproved = false` tant que
 *    l'avocat n'a pas validé (docs/legal-context.md) ;
 *  - il ne rédige aucune clause de bail : le modèle légal seedé est un squelette
 *    de champs, inactif, à remplacer par le texte fourni par l'avocat
 *    (CLAUDE.md règle 2).
 */
import { hash } from 'bcrypt';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ApplicationStatus,
  DocumentStatus,
  DocumentType,
  EmploymentContractType,
  EnergyRating,
  GuarantorKind,
  PreauthorizationStatus,
  GuarantorRequirement,
  LeaseType,
  PrismaClient,
  PropertyDocumentType,
  PropertyStatus,
  RentalZone,
  TenantFileStatus,
  UserRole,
  VisitStatus,
  VisitType,
} from '@prisma/client';

const prisma = new PrismaClient();

const STORAGE_ROOT = process.env.STORAGE_LOCAL_PATH ?? './storage';

/**
 * PDF minimal mais valide, ouvrable dans n'importe quel lecteur.
 *
 * Le seed dépose un vrai fichier plutôt qu'une clé pointant dans le vide : un
 * diagnostic listé dans le registre mais introuvable au téléchargement
 * donnerait une image fausse de l'état des données. Texte volontairement en
 * ASCII — la police de base d'un PDF n'encode pas les accents sans table
 * supplémentaire, et un « é » y deviendrait un caractère parasite.
 */
function placeholderPdf(lines: string[]): Buffer {
  const nl = String.fromCharCode(10);
  const escaped = lines.map((line) =>
    line.replace(/[\\()]/g, (char) => `\\${char}`).replace(/[^\x20-\x7e]/g, '?'),
  );
  const content = [
    'BT /F1 11 Tf 15 TL 56 780 Td',
    ...escaped.map((line) => `(${line}) Tj T*`),
    'ET',
  ].join(nl);

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    [`<< /Length ${Buffer.byteLength(content, 'latin1')} >>`, 'stream', content, 'endstream'].join(
      nl,
    ),
  ];

  // Les décalages de la table `xref` se comptent en octets depuis le début du
  // fichier : ils doivent être relevés au fur et à mesure de l'écriture.
  let pdf = `%PDF-1.4${nl}`;
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj${nl}${body}${nl}endobj${nl}`;
  });

  const startxref = Buffer.byteLength(pdf, 'latin1');
  const entries = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n ${nl}`);
  pdf += `xref${nl}0 ${objects.length + 1}${nl}0000000000 65535 f ${nl}${entries.join('')}`;
  pdf += `trailer${nl}<< /Size ${objects.length + 1} /Root 1 0 R >>${nl}`;
  pdf += `startxref${nl}${startxref}${nl}%%EOF${nl}`;

  return Buffer.from(pdf, 'latin1');
}

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
  /**
   * Ordre de publication tel qu'affiché dans le tri « plus récents » de la
   * maquette (1 = le plus récent). Sert à calculer `publishedAt` : la
   * maquette n'a pas de notion de bien « mis en avant » distincte de la
   * récence, donc `findFeatured` (les plus récents) en découle directement,
   * sans champ « featured » séparé dans le schéma.
   */
  pub: number;
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
  /**
   * Critères du propriétaire, quand ils s'écartent du cas courant — garant
   * exigé, CDI / fonction publique / étudiant acceptés.
   *
   * Ils varient d'une annonce à l'autre dans la vraie vie, et c'est ce qui
   * donne au classement par compatibilité quelque chose à départager : avec
   * huit biens aux exigences identiques, il produirait exactement l'ordre du
   * tri « loyer croissant » et ne prouverait rien.
   */
  guarantorRequirement?: GuarantorRequirement;
  acceptedContractTypes?: string[];
  description: string;
  photos: string[];
}

const PROPERTIES: SeedProperty[] = [
  {
    reference: 'MZ-0142',
    pub: 3, // ordre de publication de la maquette (1 = le plus récent)
    title: 'Studio meublé, Centre-ville',
    districtSlug: 'centre-ville',
    addressLine: '2 place Saint-Louis',
    rent: 520,
    charges: 45,
    surfaceM2: 26,
    rooms: 1,
    bedrooms: null,
    floor: '4/5',
    furnished: true,
    energyRating: EnergyRating.C,
    gesRating: EnergyRating.B,
    constructionYear: 1900,
    availableFrom: null,
    description:
      "Studio entièrement meublé au quatrième étage avec ascenseur, deux fenêtres sur la place Saint-Louis. Coin cuisine équipé, salle d'eau refaite en 2025, rangements intégrés sous les combles.\n\nSous les arcades, à trois minutes à pied de la place Saint-Jacques et de l'arrêt Mettis République. Les facultés du centre sont accessibles à pied.",
    photos: ['pièce principale', 'coin cuisine', "salle d'eau", 'façade', 'immeuble'],
  },
  {
    reference: 'MZ-0155',
    pub: 6, // ordre de publication de la maquette (1 = le plus récent)
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
    energyRating: EnergyRating.C,
    gesRating: EnergyRating.B,
    constructionYear: 1930,
    availableFrom: '2026-09-15',
    description:
      "Appartement traversant dans un immeuble de 1930, parquet d'origine et hauteur sous plafond de 2,90 m. Cuisine séparée équipée, salle de bain refaite en 2024, chauffage collectif au gaz. Cave privative en sous-sol.\n\nÀ cinq minutes à pied de la gare de Metz et des lignes Mettis A et B. Commerces de proximité au pied de l'immeuble, marché du Sablon le samedi matin.",
    photos: ['séjour', 'cuisine', 'chambre', 'façade', 'salle de bain'],
  },
  {
    reference: 'MZ-0161',
    pub: 9, // ordre de publication de la maquette (1 = le plus récent)
    title: '2 pièces, Nouvelle Ville',
    districtSlug: 'nouvelle-ville',
    addressLine: '22 avenue Foch',
    rent: 690,
    charges: 60,
    surfaceM2: 47,
    rooms: 2,
    bedrooms: 1,
    floor: '3/4',
    furnished: false,
    energyRating: EnergyRating.D,
    gesRating: EnergyRating.C,
    constructionYear: 1905,
    availableFrom: '2026-10-01',
    description:
      "Deux pièces dans un immeuble haussmannien de l'avenue Foch, moulures et cheminée décorative conservées. Cuisine séparée, salle de bain avec baignoire, double exposition est-ouest.\n\nFace au plan d'eau et aux jardins de l'Esplanade. Gare à sept minutes à pied, arrêt Mettis à cent mètres.",
    photos: ['séjour', 'cheminée', 'chambre', 'immeuble', 'cuisine'],
  },
  {
    reference: 'MZ-0168',
    pub: 12, // ordre de publication de la maquette (1 = le plus récent)
    // Le studio le moins cher du portefeuille, et le bailleur le plus strict :
    // CDI exclusivement. C'est fréquent sur les petites surfaces, très
    // demandées. Conséquence à l'écran : un étudiant ou un CDD ne le voit pas
    // remonter en tête malgré son loyer, alors que le tri « loyer croissant »
    // le placerait toujours premier.
    acceptedContractTypes: ['CDI'],
    title: 'Studio, Outre-Seille',
    districtSlug: 'outre-seille',
    addressLine: '11 rue Mazelle',
    rent: 465,
    charges: 38,
    surfaceM2: 21,
    rooms: 1,
    bedrooms: null,
    floor: '2/3',
    furnished: false,
    energyRating: EnergyRating.E,
    gesRating: EnergyRating.D,
    constructionYear: 1900,
    availableFrom: null,
    description:
      "Studio non meublé au deuxième étage sans ascenseur, dans une maison de ville rénovée en 2019. Coin cuisine, salle d'eau indépendante, poutres apparentes.\n\nQuartier Outre-Seille, entre la place Saint-Louis et le marché couvert. Le loyer le plus bas du portefeuille ; DPE E, prévoir un chauffage d'appoint l'hiver.",
    photos: ['pièce', 'coin cuisine', 'poutres', 'rue', "salle d'eau"],
  },
  {
    reference: 'MZ-0173',
    pub: 4, // ordre de publication de la maquette (1 = le plus récent)
    title: '2 pièces meublé, Centre-ville',
    districtSlug: 'centre-ville',
    addressLine: '8 rue Dupont des Loges',
    rent: 760,
    charges: 70,
    surfaceM2: 44,
    rooms: 2,
    bedrooms: 1,
    floor: '2/4',
    furnished: true,
    energyRating: EnergyRating.C,
    gesRating: EnergyRating.B,
    constructionYear: 1910,
    availableFrom: '2026-10-01',
    description:
      "Deux pièces meublé avec soin, chambre séparée et séjour sur rue calme. Cuisine équipée avec lave-vaisselle, machine à laver, literie et vaisselle fournies.\n\nRue Dupont des Loges, au cœur du secteur piéton. Adapté à une mutation ou une première installation : le logement est habitable dès la remise des clés.",
    photos: ['séjour', 'chambre', 'cuisine', 'entrée', "salle d'eau"],
  },
  {
    reference: 'MZ-0180',
    pub: 8, // ordre de publication de la maquette (1 = le plus récent)
    // Bailleur qui ne demande pas de garant : il compte sur le niveau de
    // revenus exigé. Le bien remonte donc pour un dossier sans garant, que les
    // autres annonces pénalisent.
    guarantorRequirement: GuarantorRequirement.NONE,
    title: '3 pièces, Queuleu',
    districtSlug: 'queuleu',
    addressLine: '3 rue des Alliés',
    rent: 845,
    charges: 75,
    surfaceM2: 71,
    rooms: 3,
    bedrooms: 2,
    floor: 'RDC',
    furnished: false,
    energyRating: EnergyRating.B,
    gesRating: EnergyRating.A,
    constructionYear: 2016,
    availableFrom: '2026-09-20',
    description:
      "Trois pièces en rez-de-jardin dans une résidence de 2016, terrasse de 14 m² exposée sud et place de parking privative. Chauffage par pompe à chaleur, isolation récente.\n\nQuartier Queuleu, résidentiel et calme, à dix minutes en bus du centre. Écoles et commerces à moins de cinq cents mètres.",
    photos: ['séjour', 'terrasse', 'cuisine', 'résidence', 'chambre'],
  },
  {
    reference: 'MZ-0186',
    // Quartier étudiant, bailleur qui n'exclut aucun type de contrat : la liste
    // vide vaut « rien d'exclu », pas « rien d'accepté ».
    acceptedContractTypes: [],
    pub: 10, // ordre de publication de la maquette (1 = le plus récent)
    title: 'T1 bis meublé, Nouvelle Ville',
    districtSlug: 'nouvelle-ville',
    addressLine: '5 rue Charlemagne',
    rent: 590,
    charges: 50,
    surfaceM2: 32,
    rooms: 1,
    bedrooms: null,
    floor: '5/5',
    furnished: true,
    energyRating: EnergyRating.C,
    gesRating: EnergyRating.B,
    constructionYear: 1970,
    availableFrom: '2026-11-01',
    description:
      "T1 bis meublé au dernier étage avec ascenseur, alcôve nuit séparée du séjour. Cuisine équipée, salle d'eau récente, vue dégagée sur les toits.\n\nRue Charlemagne, à cinq minutes du campus du Saulcy et de la gare. Le bien le plus demandé du portefeuille : onze candidatures en dix jours.",
    photos: ['séjour', 'alcôve nuit', 'cuisine', 'vue toits', "salle d'eau"],
  },
  {
    reference: 'MZ-0191',
    pub: 1, // ordre de publication de la maquette (1 = le plus récent)
    title: '2 pièces, Devant-les-Ponts',
    districtSlug: 'devant-les-ponts',
    addressLine: '27 rue de Paris',
    rent: 640,
    charges: 55,
    surfaceM2: 52,
    rooms: 2,
    bedrooms: 1,
    floor: '1/4',
    furnished: false,
    energyRating: EnergyRating.D,
    gesRating: EnergyRating.C,
    constructionYear: 1955,
    availableFrom: null,
    description:
      "Deux pièces au premier étage d'un petit immeuble de six lots, séjour sur cour et chambre calme. Cuisine séparée, salle de bain avec baignoire, cave.\n\nDevant-les-Ponts, à quinze minutes du centre en bus, à proximité immédiate du parc de la Seille et des berges de la Moselle.",
    photos: ['séjour', 'chambre', 'cuisine', 'cour', 'salle de bain'],
  },
];

/**
 * Pièces attendues d'un dossier salarié, dans l'ordre où l'espace locataire les
 * demandera. Le compteur « 4 / 5 » de l'écran propriétaire se lit sur ces
 * lignes, pas sur une constante d'affichage.
 */
const EXPECTED_TENANT_DOCUMENTS: DocumentType[] = [
  DocumentType.ID_CARD,
  DocumentType.PAYSLIP,
  DocumentType.EMPLOYMENT_CONTRACT,
  DocumentType.TAX_NOTICE,
  DocumentType.PROOF_OF_ADDRESS,
];

interface SeedTenant {
  firstName: string;
  lastName: string;
  email: string;
  fileReference: string;
  score: number;
  netMonthlyIncome: number; // euros nets par mois
  contractType: EmploymentContractType;
  employer: string;
  /** Combien des 5 pièces attendues sont déjà vérifiées. */
  verifiedDocuments: number;
  /**
   * Pièces du garant déjà déposées et vérifiées. Un organisme de cautionnement
   * n'a pas de pièce d'identité : seule son attestation compte.
   */
  guarantorDocuments: DocumentType[];
  /**
   * État du dossier, posé explicitement plutôt que déduit du nombre de pièces :
   * un dossier n'est « vérifié » que si **tout** l'est, garant compris, et
   * cette condition croise trop de champs pour être recalculée ici sans
   * risquer de diverger du service.
   */
  fileStatus: TenantFileStatus;
  guarantor: {
    kind: GuarantorKind;
    firstName?: string;
    lastName?: string;
    organisationName?: string;
    relationship?: string;
    /** `null` pour un organisme de cautionnement : il n'a pas de revenus. */
    netMonthlyIncome: number | null;
  } | null;
  propertyReference: string;
  status: ApplicationStatus;
  /** Ancienneté de la candidature, en heures. */
  submittedHoursAgo: number;
  /** Délai avant première lecture par le propriétaire ; `null` = pas encore lue. */
  readHoursAfter: number | null;
  message: string;
}

/**
 * Candidats de démonstration, repris de la maquette.
 *
 * Les taux d'effort couvrent volontairement toute la plage : un dossier
 * confortable, un dossier juste, un dossier étudiant qui ne tient que par son
 * garant. Un jeu d'essai où tout passe ne prouverait rien.
 */
const TENANTS: SeedTenant[] = [
  {
    firstName: 'Camille',
    lastName: 'Ferry',
    email: 'camille.ferry@bail.local',
    fileReference: 'LOC-2026-0871',
    score: 92,
    netMonthlyIncome: 2980,
    contractType: EmploymentContractType.CDI,
    employer: 'CHR Metz-Thionville',
    verifiedDocuments: 5,
    guarantorDocuments: [DocumentType.GUARANTOR_ID, DocumentType.GUARANTOR_INCOME],
    fileStatus: TenantFileStatus.VERIFIED,
    guarantor: {
      kind: GuarantorKind.INDIVIDUAL,
      firstName: 'Martine',
      lastName: 'Ferry',
      relationship: 'Mère',
      netMonthlyIncome: 4100,
    },
    propertyReference: 'MZ-0155',
    status: ApplicationStatus.SHORTLISTED,
    submittedHoursAgo: 26,
    readHoursAfter: 3,
    message:
      "Je cherche un logement proche de l'hôpital Legouest, où je travaille. Disponible pour une visite en soirée ou le samedi.",
  },
  {
    firstName: 'Noah',
    lastName: 'Bertrand',
    email: 'noah.bertrand@bail.local',
    fileReference: 'LOC-2026-0884',
    score: 78,
    netMonthlyIncome: 2240,
    contractType: EmploymentContractType.CDI,
    employer: 'Groupe Bouygues Énergies',
    verifiedDocuments: 4,
    guarantorDocuments: [],
    fileStatus: TenantFileStatus.SUBMITTED,
    guarantor: null,
    propertyReference: 'MZ-0155',
    status: ApplicationStatus.SUBMITTED,
    submittedHoursAgo: 15,
    readHoursAfter: null,
    message: 'Mutation professionnelle à Metz au 1er octobre. Dossier complet.',
  },
  {
    firstName: 'Inès',
    lastName: 'Lemoine',
    email: 'ines.lemoine@bail.local',
    fileReference: 'LOC-2026-0890',
    score: 85,
    netMonthlyIncome: 2610,
    contractType: EmploymentContractType.PUBLIC_SECTOR,
    employer: 'Rectorat de l’académie de Nancy-Metz',
    verifiedDocuments: 5,
    // Le garant d'Inès n'a fourni que sa pièce d'identité : le dossier reste
    // incomplet, et l'écran doit le montrer.
    guarantorDocuments: [DocumentType.GUARANTOR_ID],
    fileStatus: TenantFileStatus.SUBMITTED,
    guarantor: {
      kind: GuarantorKind.INDIVIDUAL,
      firstName: 'Paul',
      lastName: 'Lemoine',
      relationship: 'Père',
      netMonthlyIncome: 3200,
    },
    propertyReference: 'MZ-0173',
    status: ApplicationStatus.VISIT_SCHEDULED,
    submittedHoursAgo: 52,
    readHoursAfter: 2,
    message: 'Affectation à la rentrée, je souhaite emménager avant le 25 septembre.',
  },
  {
    firstName: 'Théo',
    lastName: 'Marchand',
    email: 'theo.marchand@bail.local',
    fileReference: 'LOC-2026-0902',
    score: 64,
    netMonthlyIncome: 780,
    contractType: EmploymentContractType.STUDENT,
    employer: 'Université de Lorraine — apprentissage',
    verifiedDocuments: 3,
    guarantorDocuments: [DocumentType.GUARANTOR_INCOME],
    fileStatus: TenantFileStatus.SUBMITTED,
    guarantor: {
      kind: GuarantorKind.ORGANISATION,
      organisationName: 'Visale — Action Logement',
      netMonthlyIncome: null,
    },
    propertyReference: 'MZ-0186',
    status: ApplicationStatus.READ,
    submittedHoursAgo: 9,
    readHoursAfter: 1,
    message: 'Étudiant en apprentissage, garantie Visale déjà obtenue.',
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
  // Noms repris de la maquette (Sylvie Kremer, Yanis C.) pour que les données
  // de démonstration soient reconnaissables d'un écran à l'autre.
  //
  // Ces comptes ont un mot de passe : sans lui, personne ne peut ouvrir
  // l'espace propriétaire de démonstration, et les 8 biens seedés seraient
  // inatteignables. Il est identique pour les deux et volontairement affiché
  // en clair par le seed — c'est une fixture de développement, ce script n'a
  // rien à faire ailleurs (le README l'indique).
  const demoPassword = 'Demo1234!';
  const passwordHash = await hash(demoPassword, 12);

  const ownerValues = {
    role: UserRole.OWNER,
    firstName: 'Sylvie',
    lastName: 'Kremer',
    phone: '+33 6 12 44 08 71',
    emailVerifiedAt: new Date(),
    // Adresse du bailleur, obligatoire au bail (loi n° 89-462, article 3).
    // Renseignée ici pour que le contrôle de cohérence d'un bail de
    // démonstration ne bute pas sur un champ que rien ne pourrait remplir.
    addressLine: '9 rue Serpenoise',
    postalCode: '57000',
    city: 'Metz',
    passwordHash,
  };
  const owner = await prisma.user.upsert({
    where: { email: 'proprietaire.demo@bail.local' },
    // `update` reprend les mêmes valeurs que `create` : avec un `{}` vide,
    // modifier le seed puis le rejouer n'aurait aucun effet sur une base
    // existante, et le fichier divergerait silencieusement de la base.
    update: ownerValues,
    create: { email: 'proprietaire.demo@bail.local', ...ownerValues },
  });

  const agentValues = {
    role: UserRole.AGENT,
    firstName: 'Yanis',
    lastName: 'Chevalier',
    emailVerifiedAt: new Date(),
    passwordHash,
  };
  const agent = await prisma.user.upsert({
    where: { email: 'agent.demo@bail.local' },
    update: agentValues,
    create: { email: 'agent.demo@bail.local', ...agentValues },
  });
  console.log(
    `  2 utilisateurs de démonstration (propriétaire, agent interne) — mot de passe ${demoPassword}`,
  );

  // --- Barème d'honoraires ---------------------------------------------------
  // Valeurs du pilote affichées dans la maquette de référence (bail.html) :
  // 8 €/m² au total côté locataire, 39 €/mois/bien d'abonnement.
  // `ownerFeeCentsPerSqm` est à 0 : la promesse du produit est « un abonnement,
  // pas une commission » (accueil, écran abonnement) — le propriétaire ne paie
  // aucun frais à la transaction. Provisoire malgré tout : à FIGER avec
  // l'avocat, tant que `isLegallyApproved` est faux, aucun montant ne doit être
  // facturé pour de vrai (docs/legal-context.md).
  //
  // Les tarifs sont dans `update` autant que dans `create` : rejouer le seed
  // après avoir changé une valeur ici doit la répercuter, sinon la base et le
  // fichier divergent en silence.
  const feeScheduleValues = {
    label: 'Barème provisoire — pilote Metz',
    zone: RentalZone.ZONE_NON_TENDUE,
    // La maquette annonce 8 €/m² TTC au total pour un 68 m² : 544 €, ventilés
    // en 340 € (visite + dossier), 136 € (rédaction du bail) et 68 € (état
    // des lieux) — soit 7 €/m² + 1 €/m². Les deux postes sont séparés parce
    // que la loi les plafonne séparément.
    tenantVisitFeeCentsPerSqm: 700, // 7,00 € / m² — visite, dossier, rédaction du bail
    tenantInventoryFeeCentsPerSqm: 100, // 1,00 € / m² — état des lieux
    ownerFeeCentsPerSqm: 0, // aucune commission propriétaire, seulement l'abonnement
    ownerSubscriptionMonthlyCents: 3900, // 39 € / mois / bien
    effectiveFrom: new Date('2026-01-01'),
    isActive: true,
    isLegallyApproved: false,
    notes:
      "Valeurs du pilote reprises de la maquette de référence. Le barème définitif et la zone de tension applicable à Metz doivent être confirmés par l'avocat en droit immobilier avant toute facturation réelle (docs/legal-context.md).",
  };

  const feeSchedule = await prisma.feeSchedule.upsert({
    where: { code: 'METZ-2026-PROVISOIRE' },
    update: feeScheduleValues,
    create: { code: 'METZ-2026-PROVISOIRE', ...feeScheduleValues },
  });
  console.log(`  barème ${feeSchedule.code} (non validé juridiquement)`);

  // --- Réglages modifiables sans redéploiement -------------------------------
  // Les trois indicateurs « saisis » ci-dessous sont ceux du registre d'accueil
  // de la maquette. Aucun n'est calculable avant le lancement pilote : il n'y a
  // ni candidature, ni dossier, ni historique de réponse en base. Ils sont
  // donc paramétrés et l'API l'annonce (`source: 'setting'`) plutôt que de
  // faire passer une valeur saisie pour une mesure.
  const settings = [
    {
      key: 'market.metz.averageResponseDelay',
      value: '31 h',
      description:
        "Délai moyen de réponse d'un propriétaire, affiché sur l'accueil. Valeur saisie, à remplacer par une mesure dès que les candidatures existent.",
    },
    {
      key: 'market.metz.applicantsPerProperty',
      value: '6,8',
      description:
        "Nombre moyen de candidats par bien à Metz. Valeur saisie : aucune candidature en base avant le lancement pilote.",
    },
    {
      key: 'market.metz.filesVerifiedThisMonth',
      value: '412',
      description:
        "Dossiers locataires vérifiés sur le mois en cours. Valeur saisie tant qu'aucun dossier réel n'est traité.",
    },
    {
      key: 'visits.recordingRetentionDays',
      value: 15,
      description:
        'Durée de conservation des enregistrements de visite, en jours (docs/integrations.md).',
    },
    {
      key: 'visits.preauthorizationAmountCents',
      value: 100,
      description:
        "Empreinte bancaire prise avant une visite, en centimes (1 € dans la maquette). C'est une vérification de moyen de paiement, pas une caution : elle est libérée après le rendez-vous. Paramétrable parce qu'elle est susceptible de bouger.",
    },
    {
      key: 'visits.cancellationDeadlineHours',
      value: 4,
      description:
        "Délai minimal d'annulation d'une visite, en heures. Au-delà, le locataire doit passer par Bail — un agent s'est déplacé ou va le faire.",
    },
    {
      key: 'visits.cameraRequired',
      value: true,
      description:
        'Caméra obligatoire pendant la visite. Décision confirmée : ce réglage est exposé pour audit, pas pour être désactivé.',
    },
    {
      key: 'owner.benchmark.agencyLettingFeeMonths',
      value: 1,
      description:
        "Honoraires de mise en location d'une agence classique, exprimés en mois de loyer charges comprises. Sert au comparatif de l'écran Abonnement — ordre de grandeur du marché messin, à corriger dès qu'on a des relevés.",
    },
    {
      key: 'owner.benchmark.mandateRate',
      value: 0.07,
      description:
        "Taux d'un mandat de gestion locative, en part du loyer annuel encaissé. Sert au comparatif de l'écran Abonnement. Ni un tarif Bail, ni un engagement.",
    },
    {
      key: 'tenant.benchmark.agencyFeeCentsPerSqm',
      value: 1100,
      description:
        "Honoraires locataire d'une agence classique, en centimes par m². Calé sur le plafond légal en zone non tendue — 11 €/m² (8 € visite/dossier/rédaction + 3 € état des lieux, décret n° 2014-890) — parce que c'est ce que les agences facturent le plus souvent. Seul repère du comparatif : il est vérifiable, contrairement à une estimation de marché.",
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

  // Publication échelonnée à partir de `seed.pub` (1 = le plus récent dans la
  // maquette), pas de l'ordre du tableau : « biens en avant » sur l'accueil et
  // tri « plus récents » dans les résultats reposent sur la même récence.
  const publishedBase = new Date('2026-08-28T09:00:00.000Z');

  for (const seed of PROPERTIES) {
    const districtId = districtsBySlug.get(seed.districtSlug);
    if (!districtId) throw new Error(`Quartier inconnu : ${seed.districtSlug}`);

    const leaseType = seed.furnished ? LeaseType.MEUBLE : LeaseType.NU;
    const rentCents = seed.rent * 100;
    const publishedAt = new Date(publishedBase.getTime() - (seed.pub - 1) * 36 * 3600 * 1000);

    const chargesCents = seed.charges * 100;

    // Mêmes valeurs en création et en mise à jour : rejouer le seed après avoir
    // corrigé une donnée ici doit la répercuter en base.
    const values = {
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
      chargesCents,
      // Dépôt de garantie : 1 mois de loyer hors charges en location nue,
      // 2 mois en meublé (loi du 6 juillet 1989).
      depositCents: seed.furnished ? rentCents * 2 : rentCents,
      availableFrom: seed.availableFrom ? new Date(seed.availableFrom) : null,
      availableImmediately: seed.availableFrom === null,
      // Critères repris de la maquette : 3 × le loyer CHARGES COMPRISES (c'est
      // sur cette base que la fiche annonce « 3 × le loyer »), garant exigé,
      // CDI, fonction publique ou étudiant avec garant.
      minMonthlyIncomeCents: (rentCents + chargesCents) * 3,
      guarantorRequirement: seed.guarantorRequirement ?? GuarantorRequirement.REQUIRED,
      acceptedContractTypes: seed.acceptedContractTypes ?? [
        'CDI',
        'PUBLIC_SECTOR',
        'STUDENT',
      ],
      status: PropertyStatus.ONLINE,
      publishedAt,
    };

    const property = await prisma.property.upsert({
      where: { reference: seed.reference },
      update: values,
      create: { reference: seed.reference, ...values },
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

    // Diagnostic de performance énergétique.
    //
    // Sans lui, ces huit annonces seraient diffusées alors que la règle de
    // publication de la plateforme les refuserait : le back-office afficherait
    // « DPE manquant » sur chacune, et le contrôle de cohérence du bail
    // n'aurait aucune surface à recouper. Le fichier déposé est un substitut
    // assumé, pas un diagnostic — il le dit lui-même en première ligne.
    const dpeKey = `properties/${seed.reference.toLowerCase()}/diagnostics/dpe-demonstration.pdf`;
    const dpePath = join(STORAGE_ROOT, 'private', dpeKey);
    const dpeFile = placeholderPdf([
      'DOCUMENT DE DEMONSTRATION - CECI N EST PAS UN DIAGNOSTIC',
      '',
      `Bien : ${seed.reference} - ${seed.title}`,
      `Classe energetique annoncee : ${seed.energyRating}`,
      `Surface habitable : ${seed.surfaceM2} m2`,
      '',
      'Fichier genere par le jeu de donnees de demonstration de Bail.',
      'Aucune valeur legale. A remplacer par le DPE etabli par un',
      'diagnostiqueur certifie avant toute diffusion reelle.',
    ]);
    await mkdir(dirname(dpePath), { recursive: true });
    await writeFile(dpePath, dpeFile);

    const dpeValues = {
      type: PropertyDocumentType.DPE,
      status: DocumentStatus.VERIFIED,
      fileName: 'dpe-demonstration.pdf',
      mimeType: 'application/pdf',
      fileSize: dpeFile.byteLength,
      storageKey: dpeKey,
      issuedAt: new Date('2024-06-12T00:00:00.000Z'),
      // Dix ans de validité, comme le veut la réglementation.
      expiresAt: new Date('2034-06-12T00:00:00.000Z'),
      verificationNote: 'Pièce de démonstration, contrôlée automatiquement par le seed.',
    };
    const existingDpe = await prisma.propertyDocument.findFirst({
      where: { propertyId: property.id, type: PropertyDocumentType.DPE },
      select: { id: true },
    });
    if (existingDpe) {
      await prisma.propertyDocument.update({ where: { id: existingDpe.id }, data: dpeValues });
    } else {
      await prisma.propertyDocument.create({ data: { propertyId: property.id, ...dpeValues } });
    }
  }
  console.log(`  ${PROPERTIES.length} biens en ligne`);

  // --- Locataires de démonstration et candidatures ---------------------------
  //
  // Sans eux, l'écran « Candidatures reçues » n'a que son état vide à montrer et
  // rien n'est vérifiable. Les noms sont ceux de la maquette, pour qu'on
  // reconnaisse les mêmes personnes d'un écran à l'autre.
  //
  // Ces dossiers portent des montants et des statuts, mais **aucun fichier** :
  // les pièces réelles (identité, bulletins de salaire) n'ont rien à faire dans
  // un jeu de démonstration versionné.
  const now = new Date('2026-09-02T09:00:00.000Z');
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3600 * 1000);

  for (const seed of TENANTS) {
    const tenantValues = {
      role: UserRole.TENANT,
      firstName: seed.firstName,
      lastName: seed.lastName,
      emailVerifiedAt: hoursAgo(seed.submittedHoursAgo + 48),
      passwordHash,
    };
    const tenant = await prisma.user.upsert({
      where: { email: seed.email },
      update: tenantValues,
      create: { email: seed.email, ...tenantValues },
    });

    const fileValues = {
      tenantId: tenant.id,
      status: seed.fileStatus,
      score: seed.score,
      netMonthlyIncomeCents: seed.netMonthlyIncome * 100,
      contractType: seed.contractType,
      employerName: seed.employer,
      inProbationPeriod: false,
      submittedAt: hoursAgo(seed.submittedHoursAgo + 24),
      verifiedAt:
        seed.fileStatus === TenantFileStatus.VERIFIED
          ? hoursAgo(seed.submittedHoursAgo + 12)
          : null,
    };
    const file = await prisma.tenantFile.upsert({
      where: { reference: seed.fileReference },
      update: fileValues,
      create: { reference: seed.fileReference, ...fileValues },
    });

    // Cinq pièces attendues d'un dossier salarié, toutes vérifiées sauf
    // indication contraire : l'écran affiche « 4 / 5 » et il faut que ce
    // dénominateur vienne de vraies lignes, pas d'une constante.
    //
    // Pièces et garants sont remis à plat à chaque exécution plutôt que créés
    // « si absents » : sans ça, corriger une valeur ici puis rejouer le seed
    // n'aurait aucun effet sur une base déjà peuplée, et le fichier
    // divergerait silencieusement de la base.
    await prisma.tenantDocument.deleteMany({ where: { tenantFileId: file.id } });
    await prisma.tenantDocument.createMany({
      data: EXPECTED_TENANT_DOCUMENTS.map((type, index) => ({
        tenantFileId: file.id,
        type,
        status:
          index < seed.verifiedDocuments ? DocumentStatus.VERIFIED : DocumentStatus.PENDING,
        // Déposée avant d'être vérifiée : sans cette date explicite, `createdAt`
        // vaudrait `now()` et le délai de contrôle mesuré par le back-office
        // sortirait négatif.
        createdAt: hoursAgo(seed.submittedHoursAgo + 24),
        verifiedAt: index < seed.verifiedDocuments ? hoursAgo(seed.submittedHoursAgo + 12) : null,
      })),
    });

    if (seed.guarantorDocuments.length > 0) {
      await prisma.tenantDocument.createMany({
        data: seed.guarantorDocuments.map((type) => ({
          tenantFileId: file.id,
          type,
          status: DocumentStatus.VERIFIED,
          createdAt: hoursAgo(seed.submittedHoursAgo + 24),
          verifiedAt: hoursAgo(seed.submittedHoursAgo + 12),
        })),
      });
    }

    await prisma.guarantor.deleteMany({ where: { tenantFileId: file.id } });
    if (seed.guarantor) {
      await prisma.guarantor.create({
        data: {
          tenantFileId: file.id,
          kind: seed.guarantor.kind,
          firstName: seed.guarantor.firstName,
          lastName: seed.guarantor.lastName,
          organisationName: seed.guarantor.organisationName,
          relationship: seed.guarantor.relationship,
          netMonthlyIncomeCents:
            seed.guarantor.netMonthlyIncome === null
              ? null
              : seed.guarantor.netMonthlyIncome * 100,
          contractType:
            seed.guarantor.kind === GuarantorKind.INDIVIDUAL
              ? EmploymentContractType.CDI
              : null,
          status: DocumentStatus.VERIFIED,
        },
      });
    }

    const property = await prisma.property.findUniqueOrThrow({
      where: { reference: seed.propertyReference },
      select: { id: true, rentCents: true, chargesCents: true },
    });

    const submittedAt = hoursAgo(seed.submittedHoursAgo);
    const applicationValues = {
      tenantId: tenant.id,
      tenantFileId: file.id,
      status: seed.status,
      // Taux d'effort : loyer charges comprises sur revenus nets vérifiés.
      // C'est le seul chiffre du tableau qui compare deux montants, il doit
      // être calculé, jamais saisi.
      incomeRatio:
        (property.rentCents + property.chargesCents) / (seed.netMonthlyIncome * 100),
      compatibilityScore: seed.score,
      message: seed.message,
      submittedAt,
      // Lue seulement si le propriétaire est passé dessus : c'est ce qui rend
      // le « délai de réponse » mesurable au lieu d'être paramétré.
      readAt: seed.readHoursAfter === null ? null : hoursAgo(seed.submittedHoursAgo - seed.readHoursAfter),
      // Remis à zéro explicitement : sans ça, un motif de refus ou une date de
      // décision laissés par un essai survivraient au rejeu du seed, et l'état
      // de démonstration divergerait du fichier.
      rejectionReason: null,
      decidedAt: null,
      ownerNote: null,
    };

    const application = await prisma.application.upsert({
      where: {
        propertyId_tenantId: { propertyId: property.id, tenantId: tenant.id },
      },
      update: applicationValues,
      create: { propertyId: property.id, ...applicationValues },
    });

    // Une candidature marquée « visite planifiée » sans rendez-vous en base
    // serait un mensonge : l'écran du locataire annoncerait une visite
    // introuvable. Le créneau et la visite sont créés avec elle.
    if (seed.status === ApplicationStatus.VISIT_SCHEDULED) {
      const startsAt = new Date(now.getTime() + 4 * 24 * 3600 * 1000);
      startsAt.setHours(18, 30, 0, 0);

      await prisma.visit.deleteMany({ where: { applicationId: application.id } });
      const visit = await prisma.visit.create({
        data: {
          propertyId: property.id,
          tenantId: tenant.id,
          applicationId: application.id,
          agentId: agent.id,
          type: VisitType.ACCOMPANIED,
          status: VisitStatus.CONFIRMED,
          scheduledAt: startsAt,
          durationMinutes: 30,
          // Aucun prestataire de paiement branché : pas d'empreinte à prendre,
          // et surtout pas d'empreinte « autorisée » qui n'existe pas.
          preauthorizationStatus: PreauthorizationStatus.NOT_REQUIRED,
          preauthorizationAmountCents: 100,
        },
      });

      await prisma.visitSlot.upsert({
        where: { propertyId_startsAt: { propertyId: property.id, startsAt } },
        update: { visitId: visit.id, closedAt: null },
        create: {
          propertyId: property.id,
          openedById: owner.id,
          startsAt,
          durationMinutes: 30,
          allowedTypes: [VisitType.ACCOMPANIED, VisitType.VIDEO],
          visitId: visit.id,
        },
      });
    }
  }

  // Quelques créneaux libres sur les biens qui ont des candidats retenus, pour
  // que l'écran de prise de rendez-vous ait de quoi s'afficher.
  for (const reference of ['MZ-0155', 'MZ-0173', 'MZ-0186']) {
    const property = await prisma.property.findUnique({
      where: { reference },
      select: { id: true },
    });
    if (!property) continue;

    for (let day = 2; day <= 6; day += 1) {
      for (const hour of [17, 18]) {
        const startsAt = new Date(now.getTime() + day * 24 * 3600 * 1000);
        startsAt.setHours(hour, 0, 0, 0);

        await prisma.visitSlot.upsert({
          where: { propertyId_startsAt: { propertyId: property.id, startsAt } },
          update: {},
          create: {
            propertyId: property.id,
            openedById: owner.id,
            startsAt,
            durationMinutes: 30,
            allowedTypes: [VisitType.ACCOMPANIED, VisitType.VIDEO],
          },
        });
      }
    }
  }
  console.log(`  ${TENANTS.length} locataires de démonstration, candidatures et créneaux`);

  // --- Biens mis de côté ------------------------------------------------------
  //
  // Le jeu est choisi pour montrer le signal qui rend ce décompte utile :
  // MZ-0161 est sauvegardé par trois locataires et ne reçoit **aucune**
  // candidature. Le bien plaît, mais quelque chose retient — le loyer, les
  // critères, le garant exigé. C'est ce que le propriétaire doit pouvoir lire,
  // et qu'aucun compteur de vues ne lui dirait.
  const SAVED: Record<string, string[]> = {
    'MZ-0161': ['camille.ferry', 'noah.bertrand', 'ines.lemoine'],
    'MZ-0142': ['theo.marchand'],
    'MZ-0155': ['ines.lemoine'],
  };

  let savedCount = 0;
  for (const [reference, handles] of Object.entries(SAVED)) {
    const property = await prisma.property.findUnique({
      where: { reference },
      select: { id: true },
    });
    if (!property) continue;

    for (const handle of handles) {
      const tenant = await prisma.user.findUnique({
        where: { email: `${handle}@bail.local` },
        select: { id: true },
      });
      if (!tenant) continue;

      await prisma.savedProperty.upsert({
        where: {
          tenantId_propertyId: { tenantId: tenant.id, propertyId: property.id },
        },
        update: {},
        create: { tenantId: tenant.id, propertyId: property.id },
      });
      savedCount += 1;
    }
  }
  console.log(`  ${savedCount} biens mis de côté par les locataires`);

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
