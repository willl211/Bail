import { accountBlockers } from './account.checks';

/**
 * Blocage lié à l'état du compte.
 *
 * Règle partagée par les deux profils : elle décide si quelqu'un peut
 * candidater ou publier une annonce. Une seule fonction, pour que le locataire
 * et le propriétaire ne se voient pas opposer deux règles qui divergeraient
 * avec le temps.
 */
describe('accountBlockers', () => {
  it('ne bloque rien quand l’adresse est confirmée', () => {
    expect(accountBlockers({ emailVerifiedAt: new Date('2026-09-01T10:00:00Z') })).toEqual(
      [],
    );
  });

  it('bloque tant que l’adresse n’est pas confirmée', () => {
    const blockers = accountBlockers({ emailVerifiedAt: null });

    expect(blockers).toHaveLength(1);
    // Le message dit quoi faire, pas seulement ce qui ne va pas : sans le
    // rappel du renvoi, l'utilisateur reste devant un mur si l'e-mail est perdu.
    expect(blockers[0]).toMatch(/redemander/);
  });
});
