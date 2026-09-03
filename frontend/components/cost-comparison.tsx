'use client';

import { useEffect, useState } from 'react';
import type { SubscriptionBenchmark } from '@/lib/api';
import * as fmt from '@/lib/format';

/**
 * « Ce que vous auriez payé ailleurs ».
 *
 * Les trois montants sont calculés par l'API sur le portefeuille réel, pas
 * illustratifs : les loyers viennent des biens diffusés, les taux de marché de
 * réglages modifiables sans redéploiement. La note de bas de bloc le dit — un
 * comparatif qui se présenterait comme une vérité serait malhonnête.
 *
 * Les barres se remplissent une fois, au montage. Composant client uniquement
 * pour cette animation : le rendu serveur donne déjà les barres à zéro, et le
 * texte est lisible sans qu'elles bougent.
 */
export function CostComparison({ benchmark }: { benchmark: SubscriptionBenchmark }) {
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    // Un cadre d'attente : sans lui, la transition partirait de l'état final et
    // ne se verrait pas.
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const rows = [
    { key: 'agency', label: 'Agence classique', cents: benchmark.agencyYearlyCents },
    { key: 'mandate', label: 'Mandat de gestion', cents: benchmark.mandateYearlyCents },
    { key: 'bail', label: 'Bail', cents: benchmark.platformYearlyCents, us: true },
  ];

  // L'échelle est relative au poste le plus cher : c'est l'écart qui se lit,
  // pas la valeur absolue.
  const ceiling = Math.max(...rows.map((row) => row.cents), 1);

  return (
    <div className="panel pad">
      <span className="label label--ink">Ce que vous auriez payé ailleurs</span>
      <p className="p-sm mt-8">
        {/* Phrase en une seule expression : la couper autour du pluriel
            insérerait une espace avant le « s ». */}
        {`Sur ${benchmark.lettingsPerYear} mise${
          benchmark.lettingsPerYear > 1 ? 's' : ''
        } en location et ${fmt.euros(benchmark.monthlyRentCents)} de loyers cumulés par mois.`}
      </p>

      <div className="mt-16">
        {rows.map((row) => (
          <div key={row.key} className="cmp">
            <span className={`cmp__k${row.us ? ' accent' : ''}`}>{row.label}</span>
            <div className="cmp__t">
              <span
                className={`cmp__f${row.us ? ' cmp__f--us' : ''}`}
                style={{ transform: `scaleX(${drawn ? row.cents / ceiling : 0})` }}
              />
            </div>
            <span className={`cmp__v${row.us ? ' accent' : ''}`}>
              {fmt.euros(row.cents)}
            </span>
          </div>
        ))}
      </div>

      <p className="field__hint mt-12">
        Sur douze mois. Estimations : {benchmark.agencyLettingFeeMonths} mois de loyer par
        mise en location pour une agence, {Math.round(benchmark.mandateRate * 100)} % des
        loyers encaissés pour un mandat de gestion. Ordres de grandeur du marché messin,
        à titre indicatif.
      </p>
    </div>
  );
}
