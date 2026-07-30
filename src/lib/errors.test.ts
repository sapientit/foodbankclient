import { describe, expect, it } from 'vitest';
import {
  ApiError,
  describeApiError,
  issuesToFieldErrors,
  pendingPickNumbers,
  sessionCapacity,
} from './errors';

function response(status: number, headers: Record<string, string> = {}) {
  return new Response(null, { status, headers });
}

describe('ApiError.from', () => {
  it('reads the request id from the header when the body has none', () => {
    const error = ApiError.from(response(500, { 'x-request-id': '9f2c' }), {
      error: { code: 'INTERNAL_ERROR', message: 'A bug.' },
    });

    // Some failures carry no body at all, and the edge's own errors never carry
    // the envelope. The header is what makes a volunteer's report actionable.
    expect(error.requestId).toBe('9f2c');
  });

  it('prefers the request id in the body when both are present', () => {
    const error = ApiError.from(response(500, { 'x-request-id': 'from-header' }), {
      error: { code: 'INTERNAL_ERROR', message: 'A bug.', requestId: 'from-body' },
    });

    expect(error.requestId).toBe('from-body');
  });

  it('does not crash on an HTML error page', () => {
    // Cloudflare's edge and the asset server both answer with HTML, and
    // openapi-fetch hands the raw string over as the error body.
    const error = ApiError.from(response(502), '<!doctype html><title>502 Bad Gateway</title>');

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.issues).toEqual([]);
    expect(describeApiError(error)).toContain('Something went wrong');
  });

  it('does not crash when there is no body at all', () => {
    const error = ApiError.from(response(401), undefined);

    expect(error.status).toBe(401);
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.requestId).toBeNull();
  });

  it('ignores a code the client has never heard of', () => {
    const error = ApiError.from(response(418), {
      error: { code: 'TEAPOT', message: 'No.', requestId: 'r1' },
    });

    expect(error.code).toBe('INTERNAL_ERROR');
  });

  it('turns 400 issues into per-field errors', () => {
    const error = ApiError.from(response(400), {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Check the form.',
        requestId: 'r1',
        details: {
          issues: [
            { path: 'refereeName', message: 'Required' },
            { path: 'answers.householdSize', message: 'Must be at least 1' },
            { path: 'refereeName', message: 'Also too short' },
          ],
        },
      },
    });

    // Dot-joined paths are used verbatim: every form field is named as its API
    // body key, so setError needs no translation table.
    expect(issuesToFieldErrors(error)).toEqual({
      refereeName: 'Required',
      'answers.householdSize': 'Must be at least 1',
    });
  });

  it('never echoes a submitted value, because it is never given one', () => {
    const error = ApiError.from(response(400), {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Check the form.',
        requestId: 'r1',
        details: { issues: [{ path: 'postcode', message: 'Not a valid postcode' }] },
      },
    });

    // The signature is (response, body) and deliberately not (response, body,
    // request). There is nothing here to build "you entered X" from.
    expect(issuesToFieldErrors(error).postcode).toBe('Not a valid postcode');
  });
});

describe('conflict details', () => {
  it('reads the pending pick numbers a session confirm refuses on', () => {
    const error = ApiError.from(response(409), {
      error: {
        code: 'CONFLICT',
        message: 'Some parcels are still pending.',
        requestId: 'r1',
        details: { pendingPickNumbers: [3, 7, 12] },
      },
    });

    expect(pendingPickNumbers(error)).toEqual([3, 7, 12]);
    expect(sessionCapacity(error)).toBeNull();
  });

  it('reads capacity and booked from a full session', () => {
    const error = ApiError.from(response(409), {
      error: {
        code: 'CONFLICT',
        message: 'That session is full',
        requestId: 'r1',
        details: { capacity: 25, booked: 25 },
      },
    });

    expect(sessionCapacity(error)).toEqual({ capacity: 25, booked: 25 });
    expect(pendingPickNumbers(error)).toBeNull();
  });
});

describe('describeApiError', () => {
  it('shows the server message for a 403 rather than treating it as a crash', () => {
    // Roles pick menus and never gate routes, so a team lead who types an admin
    // URL genuinely reaches the server and genuinely gets this back.
    const error = ApiError.from(response(403), {
      error: { code: 'FORBIDDEN', message: 'Admins only.', requestId: 'r1' },
    });

    expect(describeApiError(error)).toBe('Admins only.');
  });

  it('quotes the request id on a 500', () => {
    const error = ApiError.from(response(500, { 'x-request-id': '9f2c' }), null);

    expect(describeApiError(error)).toContain('9f2c');
  });
});
