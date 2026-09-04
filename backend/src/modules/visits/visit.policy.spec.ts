import { VisitType } from '@prisma/client';
import { VISIT_DURATION_MINUTES, overlaps } from './visit.policy';

const at = (time: string) => new Date(`2026-09-10T${time}:00.000Z`);

/**
 * Chevauchement de créneaux.
 *
 * Le seul garde-fou qui empêche de promettre à un agent d'être à deux endroits
 * à la fois. Il se compare sur les durées réservées, pas sur les seuls horaires
 * de début — c'est toute la subtilité, et c'est ce que ces cas vérifient.
 */
describe('overlaps', () => {
  const half = (time: string) => ({ startsAt: at(time), durationMinutes: 30 });

  it('détecte deux créneaux identiques', () => {
    expect(overlaps(half('17:00'), half('17:00'))).toBe(true);
  });

  it('détecte un chevauchement partiel', () => {
    // 17:00–17:30 et 17:15–17:45 : un quart d'heure commun suffit.
    expect(overlaps(half('17:00'), half('17:15'))).toBe(true);
  });

  it('accepte deux créneaux qui se touchent sans se recouvrir', () => {
    // 17:00–17:30 puis 17:30–18:00 : bord à bord, l'agent enchaîne.
    expect(overlaps(half('17:00'), half('17:30'))).toBe(false);
  });

  it('accepte deux créneaux nettement séparés', () => {
    expect(overlaps(half('10:00'), half('15:00'))).toBe(false);
  });

  it('est symétrique', () => {
    const a = half('17:00');
    const b = half('17:15');
    expect(overlaps(a, b)).toBe(overlaps(b, a));
  });

  it('tient compte de durées différentes', () => {
    // Une visio de 20 minutes à 17:00 ne gêne pas une visite accompagnée à
    // 17:25 ; une visite accompagnée de 45 minutes, si.
    const visio = { startsAt: at('17:00'), durationMinutes: 20 };
    const longue = { startsAt: at('17:00'), durationMinutes: 45 };
    const suivante = { startsAt: at('17:25'), durationMinutes: 30 };

    expect(overlaps(visio, suivante)).toBe(false);
    expect(overlaps(longue, suivante)).toBe(true);
  });
});

describe('VISIT_DURATION_MINUTES', () => {
  it('couvre chaque type de visite du MVP', () => {
    // Un type sans durée renverrait `NaN` dans les comparaisons de
    // chevauchement, et deux créneaux ne se chevaucheraient plus jamais.
    for (const type of Object.values(VisitType)) {
      expect(VISIT_DURATION_MINUTES[type]).toBeGreaterThan(0);
    }
  });
});
