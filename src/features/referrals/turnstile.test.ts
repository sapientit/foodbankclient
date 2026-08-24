import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTurnstile, resetTurnstileLoaderForTests, turnstileSiteKey } from './turnstile';

/**
 * The boundary with the third-party global, tested directly and without a DOM
 * beyond what jsdom already gives every test — no widget, no rendered screen.
 *
 * `test/setup.ts` pins `VITE_TURNSTILE_SITE_KEY` to `''` before every test, so
 * the "empty string" and "the configured key" cases stub their own value rather
 * than relying on the ambient default, and say so.
 */

describe('turnstileSiteKey', () => {
  it('is null when the variable is not set at all', () => {
    // Distinct from the empty-string case below: nothing has been deployed
    // with a sitekey, as opposed to a deployment that deliberately has none.
    Reflect.deleteProperty(import.meta.env, 'VITE_TURNSTILE_SITE_KEY');

    expect(turnstileSiteKey()).toBeNull();
  });

  it('is null when the variable is the empty string', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');

    expect(turnstileSiteKey()).toBeNull();
  });

  it('is the configured sitekey when one is set', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000AA');

    expect(turnstileSiteKey()).toBe('1x00000000000000000000AA');
  });
});

describe('loadTurnstile', () => {
  beforeEach(() => {
    resetTurnstileLoaderForTests();
    // Not part of the environment tests above touch. jsdom never actually
    // loads the third-party script, so unless a test sets this itself the
    // function has nothing to short-circuit on and always goes to the DOM.
    Reflect.deleteProperty(window, 'turnstile');
  });

  afterEach(() => {
    for (const script of document.head.querySelectorAll('script[src*="turnstile"]')) {
      script.remove();
    }
  });

  it('appends exactly one script for two concurrent callers', () => {
    // Two mounts in the same tick both see no script and both call this. If
    // the promise were not cached until the first append happened, this would
    // leave two widgets fighting over one container.
    void loadTurnstile();
    void loadTurnstile();

    expect(document.head.querySelectorAll('script[src*="turnstile"]')).toHaveLength(1);
  });

  it('rejects on a failed load and clears its cache so a later call retries', async () => {
    const first = loadTurnstile();

    const script = document.head.querySelector('script[src*="turnstile"]');
    if (script === null) throw new Error('No script was appended.');
    script.dispatchEvent(new Event('error'));

    await expect(first).rejects.toThrow('The security check could not load.');
    // The failed script is removed rather than left behind as a false signal
    // that loading is already under way.
    expect(document.head.querySelectorAll('script[src*="turnstile"]')).toHaveLength(0);

    // A referrer who loses their connection for a moment must not be stuck
    // with a permanently rejected promise for the rest of the form.
    const second = loadTurnstile();
    expect(document.head.querySelectorAll('script[src*="turnstile"]')).toHaveLength(1);

    const retryScript = document.head.querySelector('script[src*="turnstile"]');
    retryScript?.dispatchEvent(new Event('load'));
    await expect(second).resolves.toBeUndefined();
  });
});
