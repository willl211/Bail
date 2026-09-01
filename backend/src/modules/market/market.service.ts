import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { visiblePropertyWhere } from '../properties/property-visibility';

/**
 * Indicateurs du bandeau « BIENS VÉRIFIÉS · MOSELLE » de la page d'accueil.
 *
 * Deux natures d'indicateurs cohabitent :
 *  - `computed` : calculé sur les annonces réellement en base ;
 *  - `setting`  : lu dans `platform_settings`, donc modifiable sans
 *    redéploiement. Le délai moyen de réponse et le taux de dossiers vérifiés
 *    sans échange n'ont aucune donnée d'usage pour être calculés avant le
 *    lancement pilote — ils sont paramétrés, et l'API le dit explicitement
 *    plutôt que de faire passer une valeur saisie pour une mesure.
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
    const [verifiedPropertyCount, twoRooms, allVisible] = await Promise.all([
      this.prisma.property.count({ where: visiblePropertyWhere() }),
      this.prisma.property.findMany({
        where: { ...visiblePropertyWhere(), rooms: 2 },
        select: { rentCents: true, chargesCents: true },
      }),
      this.prisma.property.findMany({
        where: visiblePropertyWhere(),
        select: { surfaceM2: true },
      }),
    ]);

    const medianTwoRoomRent = median(twoRooms.map((p) => p.rentCents + p.chargesCents));
    const medianSurface = median(allVisible.map((p) => p.surfaceM2));

    const euro = (cents: number | null) =>
      cents === null ? '—' : `${Math.round(cents / 100).toLocaleString('fr-FR')} €`;

    const [responseDelay, verifiedWithoutExchange] = await Promise.all([
      this.readSetting('market.metz.averageResponseDelay', '—'),
      this.readSetting('market.metz.filesVerifiedWithoutExchange', '—'),
    ]);

    return {
      verifiedPropertyCount,
      metrics: [
        {
          key: 'medianRentTwoRooms',
          label: 'Loyer médian · 2 pièces',
          value: euro(medianTwoRoomRent),
          source: 'computed',
        },
        {
          key: 'medianSurface',
          label: 'Surface médiane',
          value: medianSurface === null ? '—' : `${Math.round(medianSurface)} m²`,
          source: 'computed',
        },
        {
          key: 'averageResponseDelay',
          label: 'Délai moyen de réponse',
          value: responseDelay,
          source: 'setting',
        },
        {
          key: 'filesVerifiedWithoutExchange',
          label: 'Dossiers vérifiés sans échange',
          value: verifiedWithoutExchange,
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
