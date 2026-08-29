import { describe, expect, it, vi } from 'vitest';
import { reloadForNewerClient } from './client-version';

describe('reloadForNewerClient', () => {
  it('replaces the page after sign-in when the deployed client differs', async () => {
    const fetchVersion = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ version: 'new-deployment' })));
    const replace = vi.fn();

    await expect(reloadForNewerClient('/sessions', fetchVersion, replace)).resolves.toBe(true);

    expect(fetchVersion).toHaveBeenCalledWith('/client-version.json', { cache: 'no-store' });
    expect(replace).toHaveBeenCalledWith('/sessions');
  });

  it('continues with sign-in when the version endpoint is unavailable', async () => {
    const replace = vi.fn();

    await expect(
      reloadForNewerClient(
        '/sessions',
        vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
        replace,
      ),
    ).resolves.toBe(false);

    expect(replace).not.toHaveBeenCalled();
  });

  it('does not reload for malformed version data', async () => {
    const replace = vi.fn();

    await expect(
      reloadForNewerClient(
        '/sessions',
        vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ release: 'new' }))),
        replace,
      ),
    ).resolves.toBe(false);

    expect(replace).not.toHaveBeenCalled();
  });

  it('does not reload when the deployed client is this test build', async () => {
    const replace = vi.fn();

    await expect(
      reloadForNewerClient(
        '/sessions',
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(JSON.stringify({ version: 'test-build' }))),
        replace,
      ),
    ).resolves.toBe(false);

    expect(replace).not.toHaveBeenCalled();
  });
});
