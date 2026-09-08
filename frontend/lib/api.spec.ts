import { cookies } from 'next/headers';
import { ApiError, apiFetch, apiFetchAuthed } from './api';

jest.mock('next/headers', () => ({ cookies: jest.fn() }));

describe('accès à l’API depuis le serveur', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('charge les données sans attendre quand le backend répond', async () => {
    const districts = [{ slug: 'centre', name: 'Centre-ville' }];
    fetchMock.mockResolvedValueOnce(Response.json(districts));

    await expect(apiFetch('/districts')).resolves.toEqual(districts);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/districts'),
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    );
  });

  it('récupère une lecture authentifiée après une brève coupure réseau', async () => {
    jest
      .mocked(cookies)
      .mockResolvedValue({ toString: () => 'session=demo' } as Awaited<ReturnType<typeof cookies>>);
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(Response.json({ status: 'VERIFIED' }));

    await expect(apiFetchAuthed('/tenant/file')).resolves.toEqual({ status: 'VERIFIED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toEqual(
        expect.objectContaining({
          cache: 'no-store',
          headers: { Accept: 'application/json', Cookie: 'session=demo' },
          signal: expect.any(AbortSignal),
        }),
      );
    }
  });

  it('signale une panne persistante après un nombre limité de tentatives', async () => {
    const networkError = new TypeError('fetch failed');
    fetchMock.mockRejectedValue(networkError);

    await expect(apiFetch('/districts')).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      url: expect.stringContaining('/districts'),
      cause: networkError,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    'ne rejoue jamais une écriture %s dont la réponse a été perdue',
    async (method) => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      await expect(apiFetch('/tenant/file', { method })).rejects.toBeInstanceOf(ApiError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 404, 500, 503])('conserve une erreur HTTP %s sans réessayer', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));

    await expect(apiFetch('/districts')).rejects.toMatchObject({ name: 'ApiError', status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('respecte une annulation avant le premier appel', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(apiFetch('/districts', { signal: controller.signal })).rejects.toBe(
      controller.signal.reason,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('interrompt aussi l’attente entre deux tentatives quand la lecture est annulée', async () => {
    const controller = new AbortController();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const request = apiFetch('/districts', { signal: controller.signal });
    const assertion = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    // Laisser la première erreur réseau déclencher l'attente avant d'annuler.
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepte une réponse vide après une écriture réussie', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(apiFetch('/tenant/file', { method: 'DELETE' })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
