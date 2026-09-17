import { base32, fromBase32, matchingStep, seal, totp, unseal } from './mfa.crypto';
const secret = base32(Buffer.from('12345678901234567890'));
describe('TOTP et chiffrement du second facteur', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('vecteur RFC 6238 SHA-1 à %s', (seconds, code) => {
    expect(totp(secret, Math.floor(Number(seconds) / 30), 8)).toBe(code);
  });
  it('encode et décode la clé standard', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(fromBase32(secret).toString()).toBe('12345678901234567890');
  });
  it('refuse les rejeux, codes malformés et décalages hors fenêtre', () => {
    const now = 1234567890 * 1000,
      step = Math.floor(now / 30000),
      code = totp(secret, step);
    expect(matchingStep(secret, code, BigInt(-1), now)).toBe(step);
    expect(matchingStep(secret, code, BigInt(step), now)).toBeNull();
    expect(matchingStep(secret, code, BigInt(-1), now + 90000)).toBeNull();
    expect(matchingStep(secret, '12345', BigInt(-1), now)).toBeNull();
  });
  it('lie le secret chiffré au compte et détecte une altération', () => {
    const key = 'a1'.repeat(32),
      ciphertext = seal(secret, key, 'agent-1');
    expect(ciphertext).not.toContain(secret);
    expect(unseal(ciphertext, key, 'agent-1')).toBe(secret);
    expect(() => unseal(ciphertext, key, 'agent-2')).toThrow();
    expect(() => unseal(ciphertext, 'b2'.repeat(32), 'agent-1')).toThrow();
    expect(() => seal(secret, 'invalid', 'agent-1')).toThrow();
  });
});
