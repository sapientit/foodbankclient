import { describe, expect, it } from 'vitest';
import worker from './index';

/**
 * Guards the two properties of the proxy that everything else rests on.
 *
 * The forwarding test is the valuable one. If this Worker ever starts rebuilding
 * the request, per-IP rate limiting on the public referral endpoint quietly
 * becomes per-datacentre and Turnstile loses the request it was verifying —
 * and nothing in the app looks any different.
 *
 * The stubs are structural, so this runs as a plain unit test with no workerd.
 */

interface Recorder {
  env: Env;
  forwarded: Request[];
  served: Request[];
}

/**
 * The cast is unavoidable: `Fetcher` carries the whole RPC surface (`connect`,
 * `queue`, `scheduled`, …), and the Worker uses exactly one method of it.
 */
function stubBinding(handle: (request: Request) => Response): Fetcher {
  return { fetch: (request: Request) => Promise.resolve(handle(request)) } as unknown as Fetcher;
}

function recordingEnv(): Recorder {
  const forwarded: Request[] = [];
  const served: Request[] = [];
  return {
    env: {
      API: stubBinding((request) => {
        forwarded.push(request);
        return new Response('from the api');
      }),
      ASSETS: stubBinding((request) => {
        served.push(request);
        return new Response('index.html');
      }),
    },
    forwarded,
    served,
  };
}

const ORIGIN = 'https://foodbank-client-production.workers.dev';

describe('the proxy Worker', () => {
  it('forwards an /api request to the API binding unmodified', async () => {
    const { env, forwarded } = recordingEnv();
    const request = new Request(`${ORIGIN}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'cf-connecting-ip': '203.0.113.7', 'cf-turnstile-response': 'a-token' },
    });

    const response = await worker.fetch(request, env);

    expect(forwarded).toHaveLength(1);
    // Identity, not equivalence — a reconstructed request is precisely the bug.
    expect(forwarded[0]).toBe(request);
    // Asserted individually as well, so a failure names what was lost.
    expect(forwarded[0]?.url).toBe(`${ORIGIN}/api/v1/auth/refresh`);
    expect(forwarded[0]?.method).toBe('POST');
    expect(forwarded[0]?.headers.get('cf-connecting-ip')).toBe('203.0.113.7');
    expect(forwarded[0]?.headers.get('cf-turnstile-response')).toBe('a-token');
    expect(await response.text()).toBe('from the api');
  });

  it('serves assets for a non-api path', async () => {
    const { env, forwarded, served } = recordingEnv();
    const request = new Request(`${ORIGIN}/sessions/42`);

    const response = await worker.fetch(request, env);

    expect(served).toHaveLength(1);
    expect(forwarded).toHaveLength(0);
    expect(await response.text()).toBe('index.html');
  });
});
