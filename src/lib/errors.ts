/**
 * The one place a failed response becomes something the UI can switch on.
 *
 * Two rules shape everything here.
 *
 * **Parsing never throws.** The body is `unknown` and it is not always the
 * server's envelope: the proxy Worker, Cloudflare's edge and the asset server
 * can all answer with an HTML error page and a 502, and `openapi-fetch` hands
 * that over as a plain string. An error path that throws while describing an
 * error is how a screen goes blank instead of showing a sentence.
 *
 * **No message is ever built from the request body.** These functions are given
 * a `Response` and a body, and deliberately nothing else — the server's
 * validation errors name a field and a rule and never echo the value, so there
 * is nothing here to render "you entered X" from. Keep the user's own copy of
 * what they typed (React Hook Form does that for free) rather than adding a
 * parameter here.
 */

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE'
  | 'NEW_CLIENTS_ASSIGNED'
  | 'INTERNAL_ERROR';

/**
 * A single field failure from a `400`. `path` is dot-joined by the server, and
 * **is the form field's name** — see `issuesToFieldErrors`.
 */
export interface FieldIssue {
  readonly path: string;
  readonly message: string;
}

/** Exhaustive by construction: adding a code to the union breaks this object. */
const API_ERROR_CODES: Record<ApiErrorCode, true> = {
  BAD_REQUEST: true,
  VALIDATION_FAILED: true,
  UNAUTHORIZED: true,
  FORBIDDEN: true,
  NOT_FOUND: true,
  CONFLICT: true,
  UNPROCESSABLE: true,
  NEW_CLIENTS_ASSIGNED: true,
  INTERNAL_ERROR: true,
};

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

interface ApiErrorInit {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly requestId: string | null;
  readonly details: Readonly<Record<string, unknown>> | null;
}

/**
 * A failure whose `message` was written to be read by the person who caused it.
 *
 * **`ErrorNotice` shows this verbatim; everything else that is not an `ApiError`
 * it reports as the request never having left.** That default is right for a
 * hall's wifi and wrong for anything we raised deliberately: the extract's
 * "The hidden archive key row does not match the extract format" became "We
 * could not reach the server", which sent an administrator to check their
 * connection over a spreadsheet whose columns were in the wrong order. A
 * wrong diagnosis is worse than a vague one.
 *
 * Not for anything a server said — that arrives as `ApiError` and carries a
 * status the notice switches on. This is for failures raised in this client,
 * against a third party or a misconfiguration, where the sentence is all there
 * is.
 */
export class ShowableError extends Error {
  override readonly name: string = 'ShowableError';
}

export class ApiError extends Error {
  override readonly name = 'ApiError';

  /** HTTP status. This is what the UI switches on; `code` is the server's own vocabulary. */
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly requestId: string | null;
  readonly details: Readonly<Record<string, unknown>> | null;
  readonly issues: readonly FieldIssue[];

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.details = init.details;
    this.issues = readIssues(init.details);
  }

  /**
   * `body` is whatever came back: the envelope, an HTML string, or nothing at
   * all (the server sends no body on some failures, and `openapi-fetch` reports
   * `undefined` for those). Anything unrecognised becomes a generic
   * `INTERNAL_ERROR` carrying the real status, so callers that switch on
   * `status` still behave.
   */
  static from(response: Response, body: unknown): ApiError {
    const envelope = readEnvelope(body);

    return new ApiError({
      status: response.status,
      code: envelope?.code ?? 'INTERNAL_ERROR',
      message: envelope?.message ?? GENERIC_MESSAGE,
      // The envelope's requestId is the same value; the header is the fallback
      // for the responses that carry no body, and for the edge's own errors.
      requestId: envelope?.requestId ?? response.headers.get('x-request-id'),
      details: envelope?.details ?? null,
    });
  }
}

/**
 * Maps a `400`'s issues onto React Hook Form's `setError`.
 *
 * **The convention, set here once: every form field is named exactly as its API
 * body key.** The server's `path` is already dot-joined (`answers.householdSize`),
 * which is also how React Hook Form names nested fields, so `setError(path)`
 * needs no translation table anywhere in the app. A form that renames a field
 * for cosmetic reasons silently loses its server-side errors.
 *
 * First issue per field wins: showing one rule at a time is what a person can
 * act on.
 */
export function issuesToFieldErrors(error: ApiError): Readonly<Record<string, string>> {
  const fieldErrors: Record<string, string> = {};

  for (const issue of error.issues) {
    if (!Object.hasOwn(fieldErrors, issue.path)) {
      fieldErrors[issue.path] = issue.message;
    }
  }

  return fieldErrors;
}

/**
 * `POST /sessions/{id}/confirm` refuses while any parcel is still pending and
 * names the pick numbers. The team lead needs those numbers, not "something
 * went wrong" — so they get read here once rather than cast at each call site.
 */
export function pendingPickNumbers(error: ApiError): readonly number[] | null {
  const raw = error.details?.pendingPickNumbers;
  if (!Array.isArray(raw)) return null;

  const numbers = raw.filter((value): value is number => typeof value === 'number');
  return numbers.length === raw.length ? numbers : null;
}

/**
 * Whether a failure is the resource simply not being there.
 *
 * Read through `ApiError` rather than compared at the call site, because a
 * network failure reaches a screen as a plain `Error` with no status at all and
 * `error.status === 404` on one of those is a type error waiting to be silenced
 * with a cast. "There is nothing here" and "the request did not happen" are
 * different sentences for a volunteer.
 */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * The listener sheet is an all-or-nothing pick-list snapshot. This explicit
 * conflict is what sends the team lead back to reconcile it before trying the
 * sheet again; matching a human-readable message would break on a copy edit.
 */
export function isNewClientsAssigned(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 409 && error.code === 'NEW_CLIENTS_ASSIGNED';
}

/** `409` on a full session carries both halves of "25 of 25". */
export function sessionCapacity(error: ApiError): { capacity: number; booked: number } | null {
  const capacity = error.details?.capacity;
  const booked = error.details?.booked;

  return typeof capacity === 'number' && typeof booked === 'number' ? { capacity, booked } : null;
}

/**
 * The default sentence for a failure a screen has no specific handling for.
 *
 * `403` is included deliberately: roles choose menus and never gate routes, so a
 * team lead who types an admin URL makes the request and gets a real `403`. That
 * has to read as a plain explanation rather than a crash.
 */
export function describeApiError(error: ApiError): string {
  if (error.status === 429) {
    return 'Too many requests just now. Wait a moment and try again.';
  }

  if (error.status >= 500) {
    return error.requestId === null
      ? `${GENERIC_MESSAGE} If it keeps happening, tell an administrator.`
      : `${GENERIC_MESSAGE} Quote reference ${error.requestId} if you report it.`;
  }

  // 403, 404, 409 and 422 all carry a message written to be read by a user.
  return error.message === '' ? GENERIC_MESSAGE : error.message;
}

interface Envelope {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly requestId: string | null;
  readonly details: Readonly<Record<string, unknown>> | null;
}

function readEnvelope(body: unknown): Envelope | null {
  const error = asRecord(asRecord(body)?.error);
  if (error === null) return null;

  const code = error.code;
  const message = error.message;
  if (!isApiErrorCode(code) || typeof message !== 'string') return null;

  const requestId = error.requestId;

  return {
    code,
    message,
    requestId: typeof requestId === 'string' ? requestId : null,
    details: asRecord(error.details),
  };
}

function readIssues(details: Readonly<Record<string, unknown>> | null): readonly FieldIssue[] {
  const raw = details?.issues;
  if (!Array.isArray(raw)) return [];

  const issues: FieldIssue[] = [];
  for (const entry of raw) {
    const issue = asRecord(entry);
    const path = issue?.path;
    const message = issue?.message;
    if (typeof path === 'string' && typeof message === 'string') {
      issues.push({ path, message });
    }
  }

  return issues;
}

/**
 * The one assertion in this file, and it is guarded by the check on the line
 * above it: `typeof value === 'object'` cannot narrow an index signature into
 * existence, so there is nothing else to write.
 */
function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && Object.hasOwn(API_ERROR_CODES, value);
}
