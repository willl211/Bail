import {
  DocumentStatus,
  EnergyRating,
  DocumentType,
  EmploymentContractType,
  GuarantorRequirement,
  LeaseType,
  PropertyStatus,
  TenantFileStatus,
  UserRole,
  type PrismaClient,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';

/**
 * Jeux de données minimaux pour les tests d'intégration.
 *
 * Écrits en direct par Prisma, et non par appels d'API : une suite qui monterait
 * son décor en traversant tout le produit testerait le décor autant que le sujet,
 * et son échec ne dirait plus lequel des deux a cassé.
 *
 * Chaque fabrique ne pose que ce dont ses tests ont besoin. Un jeu de données
 * complet masquerait ce que chaque cas suppose réellement.
 */
export const TEST_PASSWORD = 'MotDePasseDeTest2026';

let counter = 0;
const unique = () => {
  counter += 1;
  return counter;
};

export async function createUser(
  prisma: PrismaClient,
  role: UserRole,
  overrides: { emailVerified?: boolean; email?: string } = {},
) {
  const n = unique();
  return prisma.user.create({
    data: {
      email: overrides.email ?? `${role.toLowerCase()}.${n}@bail.test`,
      passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
      role,
      firstName: `Prénom${n}`,
      lastName: `Nom${n}`,
      emailVerifiedAt: overrides.emailVerified === false ? null : new Date(),
    },
  });
}

export async function createDistrict(prisma: PrismaClient) {
  return prisma.district.upsert({
    where: { slug: 'sablon' },
    update: {},
    create: { slug: 'sablon', name: 'Sablon', city: 'Metz' },
  });
}

export async function createProperty(
  prisma: PrismaClient,
  ownerId: string,
  overrides: { status?: PropertyStatus; reference?: string } = {},
) {
  const district = await createDistrict(prisma);
  const n = unique();

  return prisma.property.create({
    data: {
      reference: overrides.reference ?? `MZ-${String(9000 + n).padStart(4, '0')}`,
      ownerId,
      districtId: district.id,
      title: `3 pièces, Sablon ${n}`,
      description:
        'Appartement de trois pièces au deuxième étage, proche des commerces et du Mettis.',
      addressLine: '14 rue de Verdun, 57000 Metz',
      city: 'Metz',
      postalCode: '57000',
      surfaceM2: 68,
      rooms: 3,
      furnished: false,
      leaseType: LeaseType.NU,
      energyRating: EnergyRating.C,
      rentCents: 88_000,
      chargesCents: 8_500,
      depositCents: 88_000,
      availableImmediately: true,
      guarantorRequirement: GuarantorRequirement.OPTIONAL,
      acceptedContractTypes: ['CDI', 'PUBLIC_SECTOR', 'STUDENT'],
      status: overrides.status ?? PropertyStatus.ONLINE,
      publishedAt: new Date(),
    },
  });
}

/**
 * Dossier locataire transmis et vérifié, avec les pièces du socle commun.
 *
 * C'est l'état minimal permettant de candidater : sans lui, tout test de
 * candidature échouerait sur un blocage de dossier plutôt que sur ce qu'il
 * cherche à vérifier.
 */
export async function createVerifiedFile(prisma: PrismaClient, tenantId: string) {
  const n = unique();
  const file = await prisma.tenantFile.create({
    data: {
      tenantId,
      reference: `LOC-2026-${String(1000 + n).padStart(4, '0')}`,
      status: TenantFileStatus.VERIFIED,
      netMonthlyIncomeCents: 300_000,
      contractType: EmploymentContractType.CDI,
      employerName: 'CHR Metz-Thionville',
      submittedAt: new Date(),
      verifiedAt: new Date(),
    },
  });

  await prisma.tenantDocument.createMany({
    data: [DocumentType.ID_CARD, DocumentType.PROOF_OF_ADDRESS].map((type) => ({
      tenantFileId: file.id,
      type,
      status: DocumentStatus.VERIFIED,
      storageKey: `tests/${file.id}/${type}.pdf`,
      verifiedAt: new Date(),
    })),
  });

  return file;
}

/**
 * Squelette de modèle de bail.
 *
 * Le seed en pose deux, mais `resetDatabase` vide tout : sans ce modèle,
 * accepter un candidat échoue en 400 avant d'atteindre ce que le test vise.
 *
 * Volontairement réduit — quelques champs, aucune clause. Le texte de l'avocat
 * n'existe pas encore (CLAUDE.md règle 2), et recopier ici le schéma complet du
 * seed ferait dépendre ces suites d'un détail qu'elles ne vérifient pas. Il
 * reste `isActive: false`, comme en base : un bail ne s'envoie pas en signature.
 */
export async function createLeaseTemplate(
  prisma: PrismaClient,
  type: LeaseType = LeaseType.NU,
) {
  const body = [
    'CONTRAT DE LOCATION',
    'Bailleur : {{bailleurNomComplet}}, {{bailleurAdresse}}',
    'Locataire : {{locataireNomComplet}}',
    'Logement : {{logementAdresse}}',
    'Loyer mensuel : {{loyerMensuel}}',
  ].join('\n\n');

  return prisma.leaseTemplate.upsert({
    where: { code_version: { code: `TEST_${type}`, version: 1 } },
    update: {},
    create: {
      code: `TEST_${type}`,
      version: 1,
      label: 'Squelette de test',
      type,
      body,
      fieldSchema: {
        bailleurNomComplet: { type: 'string', required: true },
        bailleurAdresse: { type: 'string', required: true },
        locataireNomComplet: { type: 'string', required: true },
        logementAdresse: { type: 'string', required: true },
        loyerMensuel: { type: 'money', required: true },
      },
      checksum: createHash('sha256').update(body, 'utf8').digest('hex'),
      legalReference: 'Loi n° 89-462 du 6 juillet 1989',
      isActive: false,
    },
  });
}
