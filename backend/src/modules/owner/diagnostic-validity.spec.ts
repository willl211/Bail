import { diagnosticStatus, isCurrentDiagnostic } from './property.checks';

describe('Validité commune aux diagnostics de publication et de bail', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  it('refuse un DPE vérifié dont la fin de validité est inconnue', () => {
    expect(isCurrentDiagnostic({ type: 'DPE', status: 'VERIFIED', expiresAt: null }, now)).toBe(
      false,
    );
  });
  it('cesse de compter une pièce à son expiration exacte', () => {
    const document = { type: 'DPE' as const, status: 'VERIFIED' as const, expiresAt: now };
    expect(isCurrentDiagnostic(document, now)).toBe(false);
    expect(diagnosticStatus(document, now)).toBe('EXPIRED');
    expect(isCurrentDiagnostic(document, new Date(now.getTime() - 1))).toBe(true);
  });
  it('conserve le refus même si la date a également expiré', () => {
    expect(diagnosticStatus({ type: 'ERP', status: 'REJECTED', expiresAt: now }, now)).toBe(
      'REJECTED',
    );
  });
  it('ne déduit pas une durée de validité pour les autres diagnostics', () => {
    expect(
      isCurrentDiagnostic({ type: 'ASBESTOS', status: 'VERIFIED', expiresAt: null }, now),
    ).toBe(true);
    expect(
      isCurrentDiagnostic(
        { type: 'ERP', status: 'PENDING', expiresAt: new Date('2030-01-01') },
        now,
      ),
    ).toBe(false);
  });
});
