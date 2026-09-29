import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestSheetsAccess } from './google-auth';

describe('requestSheetsAccess', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'google');
  });

  it('opens Google’s account chooser before asking for Sheets consent', async () => {
    let callback: ((response: { access_token?: string; error?: string }) => void) | undefined;
    const requestAccessToken = vi.fn();
    const initTokenClient = vi.fn((config: { callback: typeof callback }) => {
      callback = config.callback;
      return { requestAccessToken };
    });
    window.google = {
      accounts: {
        oauth2: { initTokenClient },
        id: {
          initialize: vi.fn(),
          renderButton: vi.fn(),
        },
      },
    };

    const access = requestSheetsAccess('extract-client-id');

    await Promise.resolve();
    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: 'select_account consent' });
    callback?.({ access_token: 'sheets-token' });
    await expect(access).resolves.toBe('sheets-token');
  });
});
