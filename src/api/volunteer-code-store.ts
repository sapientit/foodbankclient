/**
 * The stock-take volunteer code, held at **module level and in memory only** —
 * the same shape and the same reasons as `token-store.ts`.
 *
 * A code is not a sign-in. It reaches four read-only-ish stock-take operations
 * and nothing with a household's name on it, it names nobody, and it lapses
 * eight hours after a team lead generated it. `auth-fetch` reads it on every
 * request, so — as with the access token — it is a module variable rather than
 * React state: a hook closing over it would send the value from the render it
 * was created in.
 *
 * In memory only because the eslint rule bans `localStorage`/`sessionStorage`
 * outright and nothing here earns an exception: losing the code on reload costs
 * the volunteer one retype of something they are holding on paper, and a code
 * works on several devices at once anyway. If it is genuinely lost, a team lead
 * generates another and the old one just lapses.
 */

let volunteerCode: string | null = null;
const listeners = new Set<() => void>();

export function getVolunteerCode(): string | null {
  return volunteerCode;
}

export function setVolunteerCode(code: string | null): void {
  volunteerCode = code === null ? null : normaliseVolunteerCode(code);
  for (const listener of [...listeners]) listener();
}

/** For `useSyncExternalStore` — the counting screen swaps between the code box and the stock take on this. */
export function subscribeToVolunteerCode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The server normalises case and separators, so what the volunteer types need
 * only be close. Trimming and upper-casing here keeps the box tidy and the sent
 * header predictable; the server is still the one that decides a code is valid.
 */
export function normaliseVolunteerCode(raw: string): string {
  return raw.trim().toUpperCase();
}
