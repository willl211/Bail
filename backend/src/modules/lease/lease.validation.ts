import { LeaseType } from '@prisma/client';

/**
 * Contrôle de cohérence des champs d'un bail.
 *
 * CLAUDE.md règle 2 et docs/legal-context.md : « la génération assistée par IA
 * vérifie la cohérence des champs (noms, adresse, loyer, durée), elle n'invente
 * pas de clauses ni ne rédige librement ».
 *
 * Ce contrôle est **déterministe**, pas confié à un modèle de langage. C'est un
 * écart assumé à la lettre du brief, au service de son intention : vérifier que
 * 880 € égale 880 €, qu'un dépôt ne dépasse pas un plafond légal ou qu'un nom
 * correspond à une pièce vérifiée sont des comparaisons. Une comparaison ne se
 * trompe pas ; un modèle interrogé sur la même question peut se tromper, et
 * personne ne saurait dire quand. Sur un acte qui engage deux parties pour
 * trois ans, l'incertitude n'apporte rien.
 *
 * Aucune de ces règles ne produit de texte. Elles comparent des valeurs à leur
 * source et rendent un rapport.
 */

/** Une vérification et son verdict, tels qu'affichés sur l'écran du bail. */
export interface LeaseCheck {
  key: string;
  label: string;
  /** Ce qui a été comparé, en clair. */
  detail: string;
  /** D'où vient la valeur de référence. */
  source: string;
  status: 'CONFORME' | 'ANOMALIE' | 'NON_VERIFIABLE';
  /** Renseigné quand le contrôle échoue ou ne peut pas être mené. */
  message: string | null;
}

export interface LeaseValidationReport {
  checks: LeaseCheck[];
  /** Anomalies bloquantes : le bail ne peut pas partir en signature. */
  anomalies: string[];
  /** Contrôles impossibles à mener faute de donnée. Bloquants aussi. */
  unverifiable: string[];
  fieldCount: number;
  missingFields: string[];
  validatedAt: string;
}

/** Éléments comparés par le contrôle, tous issus de la base. */
export interface LeaseValidationInput {
  leaseType: LeaseType;
  /** Champs injectés dans le modèle. */
  fieldValues: Record<string, unknown>;
  /** Schéma du modèle : seuls ces champs peuvent exister. */
  fieldSchema: Record<string, { type: string; required?: boolean; min?: number }>;
  property: {
    reference: string;
    leaseType: LeaseType;
    surfaceM2: number;
    rooms: number;
    rentCents: number;
    chargesCents: number;
    depositCents: number;
    /** `null` si aucun DPE n'a été déposé — le bail ne peut pas s'y adosser. */
    energyRating: string | null;
    hasEnergyDocument: boolean;
  };
  landlord: { fullName: string };
  tenant: { fullName: string; identityVerified: boolean };
  lease: {
    rentCents: number;
    chargesCents: number;
    depositCents: number;
    durationMonths: number;
  };
  /** Empreinte du modèle au moment de la génération, comparée à celle stockée. */
  templateChecksum: string;
  storedChecksum: string;
}

/**
 * Plafond légal du dépôt de garantie, en mois de loyer **hors charges**.
 *
 * Un mois en location nue, deux en meublé — loi n° 89-462 du 6 juillet 1989,
 * articles 22 et 25-6. Ce sont des plafonds légaux, pas des réglages : les
 * mettre en base laisserait croire qu'on peut les relever.
 */
const DEPOSIT_CAP_MONTHS: Record<LeaseType, number> = {
  [LeaseType.NU]: 1,
  [LeaseType.MEUBLE]: 2,
};

const conforme = (
  key: string,
  label: string,
  detail: string,
  source: string,
): LeaseCheck => ({ key, label, detail, source, status: 'CONFORME', message: null });

const anomalie = (
  key: string,
  label: string,
  detail: string,
  source: string,
  message: string,
): LeaseCheck => ({ key, label, detail, source, status: 'ANOMALIE', message });

const nonVerifiable = (
  key: string,
  label: string,
  detail: string,
  source: string,
  message: string,
): LeaseCheck => ({ key, label, detail, source, status: 'NON_VERIFIABLE', message });

const euros = (cents: number) =>
  `${(cents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €`;

/** Compare deux noms sans se laisser piéger par la casse ni les accents. */
function sameName(a: string, b: string): boolean {
  const normalise = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  return normalise(a) === normalise(b);
}

export function validateLease(input: LeaseValidationInput): LeaseValidationReport {
  const checks: LeaseCheck[] = [];

  // --- Intégrité du modèle -------------------------------------------------
  // En tête, parce qu'aucun autre contrôle n'a de sens sur un texte altéré.
  checks.push(
    input.templateChecksum === input.storedChecksum
      ? conforme(
          'template',
          'Modèle légal intact',
          `Empreinte ${input.storedChecksum.slice(0, 12)}…`,
          'LeaseTemplate.checksum',
        )
      : anomalie(
          'template',
          'Modèle légal intact',
          'Empreinte différente de celle publiée',
          'LeaseTemplate.checksum',
          'Le texte du modèle a changé depuis sa publication. Génération refusée.',
        ),
  );

  // --- Type de bail --------------------------------------------------------
  checks.push(
    input.leaseType === input.property.leaseType
      ? conforme(
          'leaseType',
          'Type de bail = type du bien',
          input.leaseType === LeaseType.MEUBLE
            ? 'Logement meublé → modèle « bail meublé »'
            : 'Logement nu → modèle « bail nu »',
          `Property.leaseType (${input.property.reference})`,
        )
      : anomalie(
          'leaseType',
          'Type de bail = type du bien',
          `Modèle ${input.leaseType}, bien ${input.property.leaseType}`,
          `Property.leaseType (${input.property.reference})`,
          'Le modèle de bail ne correspond pas au type du logement.',
        ),
  );

  // --- Loyer ---------------------------------------------------------------
  const rentMatches =
    input.lease.rentCents === input.property.rentCents &&
    input.lease.chargesCents === input.property.chargesCents;
  checks.push(
    rentMatches
      ? conforme(
          'rent',
          'Loyer du bail = loyer de l’annonce',
          `${euros(input.lease.rentCents)} HC · ${euros(input.lease.chargesCents)} de charges`,
          `Annonce ${input.property.reference}`,
        )
      : anomalie(
          'rent',
          'Loyer du bail = loyer de l’annonce',
          `Bail ${euros(input.lease.rentCents)} HC, annonce ${euros(input.property.rentCents)} HC`,
          `Annonce ${input.property.reference}`,
          'Le loyer du bail diffère de celui publié. Un locataire s’est engagé sur le montant de l’annonce.',
        ),
  );

  // --- Surface -------------------------------------------------------------
  const declaredSurface = Number(input.fieldValues.logementSurfaceM2);
  if (!input.property.hasEnergyDocument || input.property.energyRating === null) {
    checks.push(
      nonVerifiable(
        'surface',
        'Surface du bail = surface du diagnostic',
        `${input.property.surfaceM2} m² déclarés`,
        'Diagnostic de performance énergétique',
        'Aucun DPE déposé : la surface annoncée ne peut être recoupée avec rien.',
      ),
    );
  } else {
    checks.push(
      declaredSurface === input.property.surfaceM2
        ? conforme(
            'surface',
            'Surface du bail = surface du diagnostic',
            `${input.property.surfaceM2} m² habitables · DPE classe ${input.property.energyRating}`,
            'Diagnostic de performance énergétique',
          )
        : anomalie(
            'surface',
            'Surface du bail = surface du diagnostic',
            `Bail ${declaredSurface} m², bien ${input.property.surfaceM2} m²`,
            'Diagnostic de performance énergétique',
            'La surface portée au bail ne correspond pas à celle du bien.',
          ),
    );
  }

  // --- Identités -----------------------------------------------------------
  const landlordField = String(input.fieldValues.bailleurNomComplet ?? '');
  const tenantField = String(input.fieldValues.locataireNomComplet ?? '');
  const namesMatch =
    sameName(landlordField, input.landlord.fullName) &&
    sameName(tenantField, input.tenant.fullName);

  if (!input.tenant.identityVerified) {
    checks.push(
      nonVerifiable(
        'identities',
        'Identités = pièces vérifiées',
        'Bailleur et locataire',
        'Dossier locataire',
        'La pièce d’identité du locataire n’est pas vérifiée : les noms ne sont recoupés avec rien.',
      ),
    );
  } else {
    checks.push(
      namesMatch
        ? conforme(
            'identities',
            'Identités = pièces vérifiées',
            `${input.landlord.fullName} · ${input.tenant.fullName}`,
            'Dossier locataire et compte propriétaire',
          )
        : anomalie(
            'identities',
            'Identités = pièces vérifiées',
            `Bail : ${landlordField} / ${tenantField}`,
            'Dossier locataire et compte propriétaire',
            'Les noms portés au bail ne correspondent pas aux comptes vérifiés.',
          ),
    );
  }

  // --- Dépôt de garantie ---------------------------------------------------
  const capMonths = DEPOSIT_CAP_MONTHS[input.leaseType];
  const cap = input.property.rentCents * capMonths;
  checks.push(
    input.lease.depositCents <= cap
      ? conforme(
          'deposit',
          `Dépôt de garantie ≤ ${capMonths} mois de loyer nu`,
          `${euros(input.lease.depositCents)} pour ${euros(input.property.rentCents)} HC`,
          'Loi n° 89-462 du 6 juillet 1989',
        )
      : anomalie(
          'deposit',
          `Dépôt de garantie ≤ ${capMonths} mois de loyer nu`,
          `${euros(input.lease.depositCents)} demandés, plafond ${euros(cap)}`,
          'Loi n° 89-462 du 6 juillet 1989',
          'Le dépôt de garantie dépasse le plafond légal.',
        ),
  );

  // --- Durée ---------------------------------------------------------------
  const legalDuration = input.leaseType === LeaseType.MEUBLE ? 12 : 36;
  checks.push(
    input.lease.durationMonths === legalDuration
      ? conforme(
          'duration',
          'Durée = durée légale du type de bail',
          `${input.lease.durationMonths} mois`,
          'Loi n° 89-462 du 6 juillet 1989',
        )
      : anomalie(
          'duration',
          'Durée = durée légale du type de bail',
          `${input.lease.durationMonths} mois portés au bail, ${legalDuration} attendus`,
          'Loi n° 89-462 du 6 juillet 1989',
          'La durée du bail ne correspond pas à celle prévue pour ce type de location.',
        ),
  );

  // --- Complétude des champs ----------------------------------------------
  // Aucun champ hors schéma ne peut être injecté, et aucun champ requis ne peut
  // rester vide : un marqueur non remplacé se retrouverait tel quel dans l'acte.
  const missingFields = Object.entries(input.fieldSchema)
    .filter(([name, rule]) => {
      if (!rule.required) return false;
      const value = input.fieldValues[name];
      return value === undefined || value === null || String(value).trim() === '';
    })
    .map(([name]) => name);

  const unknownFields = Object.keys(input.fieldValues).filter(
    (name) => !(name in input.fieldSchema),
  );

  checks.push(
    missingFields.length === 0 && unknownFields.length === 0
      ? conforme(
          'fields',
          'Champs injectés complets',
          `${Object.keys(input.fieldSchema).length} champs, aucun marqueur laissé vide`,
          'LeaseTemplate.fieldSchema',
        )
      : anomalie(
          'fields',
          'Champs injectés complets',
          missingFields.length > 0
            ? `${missingFields.length} champ(s) manquant(s)`
            : `${unknownFields.length} champ(s) hors schéma`,
          'LeaseTemplate.fieldSchema',
          missingFields.length > 0
            ? `Champs non renseignés : ${missingFields.join(', ')}.`
            : `Champs refusés parce qu'absents du schéma : ${unknownFields.join(', ')}.`,
        ),
  );

  return {
    checks,
    anomalies: checks
      .filter((check) => check.status === 'ANOMALIE')
      .map((check) => check.message ?? check.label),
    unverifiable: checks
      .filter((check) => check.status === 'NON_VERIFIABLE')
      .map((check) => check.message ?? check.label),
    fieldCount: Object.keys(input.fieldSchema).length,
    missingFields,
    validatedAt: new Date().toISOString(),
  };
}
