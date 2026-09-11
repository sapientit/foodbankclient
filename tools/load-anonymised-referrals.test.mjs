import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAnonymisedReferrals, preparedReferrals } from './load-anonymised-referrals.mjs';

const source = { referrals: [{ referrerEmail: 'referrer1@example.test', answers: {} }] };
const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });

test('refuses a source that contains target ids or a real-looking email', () => {
  assert.throws(() => preparedReferrals({ referrals: [{ referrerEmail: 'person@example.com' }] }));
  assert.throws(() =>
    preparedReferrals({ referrals: [{ referrerEmail: 'a@example.test', sessionId: 'id' }] }),
  );
});

test('uses an authenticated, idempotent dev-test import and the target reason', async () => {
  const requests = [];
  const fetchFn = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith('/dev-login')) return json({ accessToken: 'token', user: { role: 'admin' } });
    if (url.endsWith('/sessions'))
      return json({
        sessions: [{ id: 'session-id', sessionDate: '2026-09-18', startTime: '15:00' }],
      });
    if (url.endsWith('/referral-reasons')) return json({ referralReasons: [{ id: 'reason-id' }] });
    return json({ referrals: [{ sourceIndex: 1, referralId: 'referral-id' }] }, 201);
  };
  const { importKey } = await loadAnonymisedReferrals({
    environment: 'dev',
    sessionDate: '2026-09-18',
    startTime: '15:00',
    email: 'admin@example.test',
    source,
    fetchFn,
  });
  assert.match(importKey, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(requests[3].url, 'http://127.0.0.1:8787/api/v1/dev-test/referral-imports');
  const body = JSON.parse(requests[3].init.body);
  assert.equal(body.reasonId, 'reason-id');
  assert.equal(body.sessionId, 'session-id');
  assert.equal(body.importKey, importKey);
});

test('does not permit a live environment', async () => {
  await assert.rejects(() =>
    loadAnonymisedReferrals({
      environment: 'live',
      sessionDate: '2026-09-18',
      startTime: '15:00',
      email: 'a',
      source,
    }),
  );
});
