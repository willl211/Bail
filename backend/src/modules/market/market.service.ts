import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { visiblePropertyWhere } from '../properties/property-visibility';

/**
 * Registre « BIENS VÉRIFIÉS · MOSELLE » de la page d'accueil.
 *
 * Les quatre indicateurs correspondent à ceux de la maquette de référence
 * (`maquette_interface/bail/bail.html`) : délai moyen de réponse, loyer médian
 * du centre-ville, candidats par bien, dossiers vérifiés ce mois.
 *
 * Deux natures d'indicateurs cohabitent :
 *  - `computed` : calculé sur les annonces réellement en base ;
 *  - `setting`  : lu dans `platform_settings`, donc modifiable sans
 *    redéploiement. Trois des quatre n'ont aucune donnée d'usage pour être
 *    calculés avant le lancement pilote (ni candidature, ni dossier, ni
 *    historique de réponse) — ils sont paramétrés, et l'API le dit
 *    explicitement plutôt que de faire passer une valeur saisie pour une
 *    mesure.
 */
export interface MarketMetric {
  key: string;
  label: string;
  value: string;
  source: 'computed' | 'setting';
}

export interface MarketSnapshot {
  verifiedPropertyCount: number;
  metrics: MarketMetric[];
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

@Injectable()
export class MarketService {
  constructor(private readonly prisma: PrismaService) {}

  private async readSetting(key: string, fallback: string): Promise<string> {
    const setting = await this.prisma.platformSetting.findUnique({ where: { key } });
    if (!setting) return fallback;
    return typeof setting.value === 'string' ? setting.value : JSON.stringify(setting.value);
  }

  async getSnapshot(): Promise<MarketSnapshot> {
    const [verifiedPropertyCount, centreVille] = await Promise.all([
      this.prisma.property.count({ where: visiblePropertyWhere() }),
      this.prisma.property.findMany({
        where: { ...visiblePropertyWhere(), district: { slug: 'centre-ville' } },
        select: { rentCents: true, chargesCents: true, surfaceM2: true },
      }),
    ]);

    // Loyer médian au m², charges comprises : la médiane porte sur les ratios
    // par bien, pas sur un ratio de médianes — un studio à fort loyer au m² ne
    // doit pas être écrasé par la médiane des surfaces.
    const medianRentPerSqm = median(
      centreVille
        .filter((p) => p.surfaceM2 > 0)
        .map((p) => (p.rentCents + p.chargesCents) / p.surfaceM2),
    );

    const [responseDelay, applicantsPerProperty, filesVerified] = await Promise.all([
      this.readSetting('market.metz.averageResponseDelay', '—'),
      this.readSetting('market.metz.applicantsPerProperty', '—'),
      this.readSetting('market.metz.filesVerifiedThisMonth', '—'),
    ]);

    return {
      verifiedPropertyCount,
      metrics: [
        {
          key: 'averageResponseDelay',
          label: 'Délai moyen de réponse',
          value: responseDelay,
          source: 'setting',
        },
        {
          key: 'medianRentPerSqmCentreVille',
          label: 'Loyer médian centre-ville',
          value:
            medianRentPerSqm === null
              ? '—'
              : `${(medianRentPerSqm / 100).toLocaleString('fr-FR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })} €/m²`,
          source: 'computed',
        },
        {
          key: 'applicantsPerProperty',
          label: 'Candidats par bien',
          value: applicantsPerProperty,
          source: 'setting',
        },
        {
          key: 'filesVerifiedThisMonth',
          label: 'Dossiers vérifiés ce mois',
          value: filesVerified,
          source: 'setting',
        },
      ],
    };
  }

  /**
   * Abonnement propriétaire affiché sur la page d'accueil. Lu dans le barème
   * actif : le montant n'est jamais codé en dur (docs/legal-context.md).
   */
  async getOwnerSubscriptionPricing() {
    const schedule = await this.prisma.feeSchedule.findFirst({
      where: { isActive: true },
      orderBy: { effectiveFrom: 'desc' },
    });

    return {
      monthlyAmountCents: schedule?.ownerSubscriptionMonthlyCents ?? null,
      feeScheduleCode: schedule?.code ?? null,
      isLegallyApproved: schedule?.isLegallyApproved ?? false,
    };
  }
}
