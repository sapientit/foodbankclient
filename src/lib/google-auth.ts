import { ShowableError } from '../../lib/errors';

/**
 * Both halves of Google Identity Services this app uses come from the one
 * script (`GIS` below), so `window.google`'s shape is declared once here —
 * `oauth2` for this file's Sheets access, `id` for `../auth/google-signin.ts`'s
 * sign-in button. Declaring the same global property twice with two different
 * shapes, in two files, is a TypeScript error; extend this one instead of
 * adding a second `declare global` for `google`.
 */
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
            error_callback?: (error: { type?: string }) => void;
          }): { requestAccessToken(config: { prompt: string }): void };
        };
        id: {
          initialize(config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }): void;
          renderButton(container: HTMLElement, options: { type: 'standard'; width?: number }): void;
        };
      };
    };
  }
}
const GIS = 'https://accounts.google.com/gsi/client';
let gisLoad: Promise<void> | null = null;

/** Load GIS before the administrator reaches the confirm button; no consent is requested here. */
export function preloadSheetsAccess(): Promise<void> {
  return loadGis();
}

export function requestSheetsAccess(clientId: string): Promise<string> {
  return loadGis().then(
    () =>
      new Promise((resolve, reject) => {
        const client = window.google?.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/spreadsheets',
          callback: (response) => {
            if (typeof response.access_token === 'string') resolve(response.access_token);
            else
              reject(
                new ShowableError(response.error ?? 'Google did not grant Sheets permission.'),
              );
          },
          error_callback: (error) => {
            const message =
              error.type === 'popup_failed_to_open'
                ? 'Google Sheets permission could not open its window. Allow pop-ups and try again.'
                : error.type === 'popup_closed'
                  ? 'Google Sheets permission was closed before it finished.'
                  : 'Google Sheets permission could not start.';
            reject(new ShowableError(message));
          },
        });
        if (client === undefined) {
          reject(new ShowableError('Google sign-in could not start.'));
          return;
        }
        client.requestAccessToken({ prompt: 'consent' });
      }),
  );
}
function loadGis(): Promise<void> {
  if (window.google !== undefined) return Promise.resolve();
  if (gisLoad !== null) return gisLoad;
  gisLoad = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS;
    script.async = true;
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      reject(new ShowableError('Google sign-in could not load.'));
    };
    document.head.append(script);
  });
  return gisLoad;
}
