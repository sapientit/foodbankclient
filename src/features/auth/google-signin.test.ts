import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  googleSignInClientId,
  isGoogleSignInMode,
  loadGoogleIdentityServices,
  resetGoogleIdentityServicesLoaderForTests,
} from './google-signin';

/**
 * The boundary with Google's third-party global, tested the same way
 * `referrals/turnstile.test.ts` tests Turnstile's: directly, with jsdom's
 * default DOM and no rendered screen.
 *
 * `test/setup.ts` pins `VITE_GOOGLE_CLIENT_ID` and `VITE_AUTH_MODE` to `''`
 * before every test, so these cases stub their own value rather than relying
 * on the ambient default.
 */

describe('googleSignInClientId', () => {
  it('is null when the variable is not set at all', () => {
    Reflect.deleteProperty(import.meta.env, 'VITE_GOOGLE_CLIENT_ID');

    expect(googleSignInClientId()).toBeNull();
  });

  it('is null when the variable is the empty string', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');

    expect(googleSignInClientId()).toBeNull();
  });

  it('is the configured client id when one is set', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'a-client-id.apps.googleusercontent.com');

    expect(googleSignInClientId()).toBe('a-client-id.apps.googleusercontent.com');
  });
});

describe('isGoogleSignInMode', () => {
  it('is false when the variable is not set at all', () => {
    Reflect.deleteProperty(import.meta.env, 'VITE_AUTH_MODE');

    expect(isGoogleSignInMode()).toBe(false);
  });

  it('is false for any value other than exactly "google"', () => {
    vi.stubEnv('VITE_AUTH_MODE', 'dummy');
    expect(isGoogleSignInMode()).toBe(false);

    vi.stubEnv('VITE_AUTH_MODE', 'Google');
    expect(isGoogleSignInMode()).toBe(false);
  });

  it('is true when the variable is exactly "google"', () => {
    vi.stubEnv('VITE_AUTH_MODE', 'google');

    expect(isGoogleSignInMode()).toBe(true);
  });
});

describe('loadGoogleIdentityServices', () => {
  beforeEach(() => {
    resetGoogleIdentityServicesLoaderForTests();
    // jsdom never actually loads the third-party script, so unless a test
    // sets this itself the function has nothing to short-circuit on and
    // always goes to the DOM.
    Reflect.deleteProperty(window, 'google');
  });

  afterEach(() => {
    for (const script of document.head.querySelectorAll('script[src*="gsi"]')) {
      script.remove();
    }
  });

  it('appends exactly one script for two concurrent callers', () => {
    void loadGoogleIdentityServices();
    void loadGoogleIdentityServices();

    expect(document.head.querySelectorAll('script[src*="gsi"]')).toHaveLength(1);
  });

  it('resolves immediately when the script is already loaded', async () => {
    // @ts-expect-error -- test double; the real shape is declared in extracts/google-auth.ts.
    window.google = {};

    await expect(loadGoogleIdentityServices()).resolves.toBeUndefined();
    expect(document.head.querySelectorAll('script[src*="gsi"]')).toHaveLength(0);
  });

  it('rejects on a failed load and clears its cache so a later call retries', async () => {
    const first = loadGoogleIdentityServices();

    const script = document.head.querySelector('script[src*="gsi"]');
    if (script === null) throw new Error('No script was appended.');
    script.dispatchEvent(new Event('error'));

    await expect(first).rejects.toThrow('Google sign-in could not load.');
    expect(document.head.querySelectorAll('script[src*="gsi"]')).toHaveLength(0);

    const second = loadGoogleIdentityServices();
    expect(document.head.querySelectorAll('script[src*="gsi"]')).toHaveLength(1);

    const retryScript = document.head.querySelector('script[src*="gsi"]');
    retryScript?.dispatchEvent(new Event('load'));
    await expect(second).resolves.toBeUndefined();
  });
});
