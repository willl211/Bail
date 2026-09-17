import { operationsRequest } from './operations-client';

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

it('traite la réponse vide de Nest comme une absence de demande', async () => {
  global.fetch = jest.fn().mockResolvedValue(new Response('', { status: 200 }));
  expect(await operationsRequest('/privacy/erasure')).toBeNull();
});

it('retourne le suivi existant et accompagne la demande du cookie de session', async () => {
  global.fetch = jest.fn().mockResolvedValue(Response.json({ status: 'HOLD', reviewNote: 'À examiner' }));
  expect(await operationsRequest('/privacy/erasure')).toEqual({ status: 'HOLD', reviewNote: 'À examiner' });
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/privacy/erasure'), expect.objectContaining({ credentials: 'include', cache: 'no-store' }));
});

it('rend une panne réseau compréhensible et conserve les motifs de refus de l’API', async () => {
  global.fetch = jest.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(Response.json({ message: 'Conservation à examiner.' }, { status: 409 }));
  await expect(operationsRequest('/privacy/erasure')).rejects.toThrow('Impossible de joindre');
  await expect(operationsRequest('/admin/operations/erasure/test', { action: 'ERASE' })).rejects.toThrow('Conservation à examiner.');
});
