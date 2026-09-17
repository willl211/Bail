import { allowedEnergyRatings, requiredDiagnostics, diagnosticFactBlockers, diagnosticDateError, addMonths } from './diagnostic-policy';
import { publicationChecks } from './property.checks';

describe('Règles de location en métropole', () => {
  const now = new Date('2026-09-14T12:00:00Z');
  it.each([
    ['2026-09-14', 'ABCDEF'], ['2027-12-31T22:59:59.999Z', 'ABCDEF'],
    ['2027-12-31T23:00:00Z', 'ABCDE'], ['2033-12-31T23:00:00Z', 'ABCD'],
  ])('applique les échéances à Paris : %s', (date, classes) => {
    expect(allowedEnergyRatings(new Date(date)).join('')).toBe(classes);
  });
  it('exige des réponses explicites et applique les diagnostics conditionnels', () => {
    expect(diagnosticFactBlockers({})).toHaveLength(5);
    expect(requiredDiagnostics({ constructionYear: 1948, electricalDiagnostic: 'REQUIRED', gasDiagnostic: 'NOT_REQUIRED', riskDiagnostic: 'REQUIRED', noiseDiagnostic: 'REQUIRED' }))
      .toEqual(['DPE', 'LEAD', 'ELECTRICAL', 'ERP', 'NOISE']);
    expect(requiredDiagnostics({ constructionYear: 1949 })).toEqual(['DPE']);
  });
  it('refuse le DPE ancien ou à durée artificiellement prolongée', () => {
    expect(diagnosticDateError('DPE', new Date('2021-06-30'), new Date('2031-06-29'), false, now)).toContain('juillet 2021');
    expect(diagnosticDateError('DPE', new Date('2026-01-01'), new Date('2036-01-01'), false, now)).toContain('10 ans');
    expect(diagnosticDateError('DPE', new Date('2026-01-01'), new Date('2035-12-31T23:59:59.999Z'), false, now)).toBeNull();
  });
  it('borne les durées du gaz, de l’électricité et des risques', () => {
    for (const type of ['GAS', 'ELECTRICAL', 'ERP'] as const) {
      expect(diagnosticDateError(type, new Date('2026-01-01'), null, false, now)).toBeTruthy();
      expect(diagnosticDateError(type, new Date('2026-01-01'), new Date('2035-01-01'), false, now)).toBeTruthy();
    }
    expect(addMonths(new Date('2026-08-31'), 6).toISOString()).toBe('2027-02-28T00:00:00.000Z');
  });
  it('autorise un CREP illimité seulement si le résultat le permet', () => {
    expect(diagnosticDateError('LEAD', new Date('2010-01-01'), null, true, now)).toBeNull();
    expect(diagnosticDateError('LEAD', new Date('2010-01-01'), null, false, now)).toBeTruthy();
    expect(diagnosticDateError('GAS', new Date('2026-01-01'), null, true, now)).toBeTruthy();
  });
  it('bloque une publication sur le diagnostic conditionnel non vérifié', () => {
    const result = publicationChecks({ title: 'Maison', addressLine: 'Metz', description: 'Maison', surfaceM2: 80, rentCents: 90000,
      energyRating: 'G', constructionYear: 2005, photos: [], electricalDiagnostic: 'NOT_REQUIRED', gasDiagnostic: 'REQUIRED', riskDiagnostic: 'NOT_REQUIRED', noiseDiagnostic: 'NOT_REQUIRED',
      documents: [{ type: 'DPE', status: 'VERIFIED', issuedAt: new Date('2026-01-01'), expiresAt: new Date('2030-01-01') },
        { type: 'GAS', status: 'PENDING', expiresAt: null }],
    }, now);
    expect(result.blockers.some((message) => message.includes('Classe DPE G'))).toBe(true);
    expect(result.blockers.some((message) => message.includes('Gaz à valider'))).toBe(true);
  });
});
