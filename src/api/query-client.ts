import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../lib/errors';

/**
 * The single query client.
 *
 * **Its cache is never persisted, and no persister may be added.** It holds
 * referrals — names, addresses, phone numbers and reasons for needing food — and
 * this app runs on shared church-hall laptops and volunteers' own phones.
 * In memory it dies with the tab; on disk it waits for the next person. Sign-out
 * calls `clear()` for the same reason.
 */

const MAX_RETRIES = 2;

/** A 429 is the one 4xx worth retrying, and only slowly: the public endpoints allow ~60 calls a minute. */
const RATE_LIMIT_BACKOFF_MS = 5_000;
const BACKOFF_MS = 500;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (failureCount >= MAX_RETRIES) return false;

        // Not an ApiError: the request never reached the server. Worth retrying.
        if (!(error instanceof ApiError)) return true;

        if (error.status === 429) return true;

        // Retrying a 4xx cannot help — the session really is full, the list
        // really is confirmed — and a retry loop is the only realistic way to
        // hit the rate limits.
        return error.status >= 500;
      },
      retryDelay: (attemptIndex, error) => {
        const base =
          error instanceof ApiError && error.status === 429 ? RATE_LIMIT_BACKOFF_MS : BACKOFF_MS;
        return base * 2 ** attemptIndex;
      },

      // Session lists and stock levels do not change second to second, and the
      // public endpoints are rate limited per IP.
      staleTime: 60_000,

      // Never poll. A tab left open on the pick list screen for a whole session
      // would otherwise spend the food bank's rate limit budget on nothing.
      refetchInterval: false,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // A retried POST is a duplicate write. Attendance moves stock.
      retry: false,
    },
  },
});
