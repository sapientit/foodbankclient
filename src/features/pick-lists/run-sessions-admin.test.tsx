import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { Session } from '../sessions/queries';
import type { Parcel, PickList } from './queries';

// The same deliberately small stock fixture as the team-lead module, and for
// the same reason: these are navigation assertions and must not depend on every
// maintained stock name.
vi.mock('./preference-rules.config.json', () => ({ default: { rules: [] } }));

/**
 * An administrator covering a session sees one thing a team lead does not: the
 * client's name opens that household's referral. `screenDetails.md`, "#Session
 * processing". The signed-in actor is fixed per module, so the team lead's half
 * of this rule lives in `run-sessions-team-lead.test.tsx`.
 */

const SESSION: Session = {
  id: 'session-1',
  sessionDate: '2099-08-06',
  startTime: '10:00',
  startsAtUtc: '2099-08-06T09:00:00.000Z',
  durationMinutes: 90,
  location: 'St Mary’s Hall',
  deliveryWindowStart: null,
  deliveryWindowEnd: null,
  deliveryCapacity: 0,
  capacity: 25,
  booked: 1,
  status: 'planned',
  cancelledReason: null,
  isCustomised: false,
  recurringSessionId: null,
  occurrenceDate: null,
};

const PICK_LIST: PickList = {
  id: 'pick-list-1',
  sessionId: SESSION.id,
  status: 'draft',
  generatedAt: '2026-08-05T09:00:00.000Z',
  firstPrintedAt: null,
  confirmedAt: null,
};

const PARCEL: Parcel = {
  id: 'parcel-1',
  referralId: 'referral-1',
  pickNumber: 1,
  refereeFirstName: 'Sam',
  refereeSurname: 'Taylor',
  isDelivery: false,
  adults: 1,
  children: 1,
  householdSize: 2,
  reviewedAt: null,
  attendance: 'pending',
  notes: null,
  answers: {},
  lines: [],
};

beforeEach(() => {
  server.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u1', email: 'admin@x.com', displayName: 'Ada Admin', role: 'admin' },
      }),
    ),
    http.get('/api/v1/sessions/:id', () => HttpResponse.json(SESSION)),
    http.get('/api/v1/referrals', () => HttpResponse.json({ referrals: [] })),
    http.get('/api/v1/stock/items', () => HttpResponse.json({ items: [] })),
    http.post('/api/v1/sessions/:sessionId/pick-list', () => HttpResponse.json(PICK_LIST)),
    http.get('/api/v1/sessions/:sessionId/pick-list', () =>
      HttpResponse.json({ pickList: PICK_LIST, parcels: [PARCEL] }),
    ),
    http.get('/api/v1/sessions/:sessionId/sms-summary', () =>
      HttpResponse.json({ sessionId: SESSION.id, unreadTotal: 0, households: [] }),
    ),
  );
});

describe('an administrator running a session', () => {
  it("opens a household's referral from the client's name", async () => {
    renderApp(`/run-sessions/${SESSION.id}`);

    const name = await screen.findByRole('link', { name: 'Sam Taylor' });
    // The same referral screen the referral list and the search reach, and an
    // id in the path — never a name. See `.claude/rules/pii-security.md`.
    expect(name).toHaveAttribute('href', `/referrals/${PARCEL.referralId}`);
  });

  it('still offers the whole-session referral details sheet alongside it', async () => {
    renderApp(`/run-sessions/${SESSION.id}`);

    // The name link is per household; this is the one page that puts every
    // household's address and phone on paper. One does not replace the other.
    expect(await screen.findByRole('link', { name: 'Referral details' })).toHaveAttribute(
      'href',
      `/run-sessions/${SESSION.id}/referral-details`,
    );
  });
});
