import { ShowableError } from '../../lib/errors';

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }): { requestAccessToken(config: { prompt: string }): void };
        };
      };
    };
  }
}
const GIS = 'https://accounts.google.com/gsi/client';
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
  return new Promise((resolve, reject) => {
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
}
