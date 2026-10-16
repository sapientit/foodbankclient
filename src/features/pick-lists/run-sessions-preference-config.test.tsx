import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { ConfigurationRelease } from '../configuration-releases/queries';
import rawFormConfig from '../referrals/referral-form.config.json';
import type { Referral } from '../referrals/queries';

vi.mock('./preference-rules.config.json', () => ({
  default: {
    rules: [
      {
        when: { key: 'Tea/Coffee' },
        cases: [],
        otherwise: { set: [{ stock: '$selectedAnswer', quantity: 1 }] },
      },
    ],
  },
}));

beforeEach(() => {
  server.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u3', email: 'lead@x.com', displayName: 'Ada Lead', role: 'team_lead' },
      }),
    ),
    http.get('/api/v1/sessions/:id', () =>
      HttpResponse.json({
        id: 'session-1',
        sessionDate: '2099-08-06',
        startTime: '10:00',
        startsAtUtc: '2099-08-06T09:00:00.000Z',
        durationMinutes: 90,
        location: 'St Mary’s Hall',
        deliveryTime: null,
        deliveryCapacity: 0,
        deliveryBooked: 0,
        capacity: 25,
        booked: 0,
        status: 'planned',
        cancelledReason: null,
        isCustomised: false,
        recurringSessionId: null,
        occurrenceDate: null,
      }),
    ),
    http.get('/api/v1/stock/items', () =>
      HttpResponse.json({
        items: [
          {
            id: 'stock-1',
            name: 'Baked beans',
            category: 'Tinned goods',
            description: 'In tomato sauce',
            shelfNumber: 'A2',
            lowStockThreshold: null,
            groupingId: null,
            unitsPerPack: null,
            packUnitLabel: null,
            isActive: true,
          },
        ],
      }),
    ),
  );
});

const FORM_ID = 'form-1';

const REFERRAL: Referral = {
  id: 'referral-1',
  sessionId: 'session-1',
  formId: FORM_ID,
  status: 'active',
  referredAt: '2099-08-01T10:00:00.000Z',
  adults: 1,
  children: 0,
  householdSize: 1,
  isDelivery: false,
  collectionMethod: 'collection',
  needsFuelHelp: false,
  referrerOrganisation: 'Riverside Church',
  referrerName: 'Sam Referrer',
  refereeFirstName: 'Jamie',
  refereeSurname: 'Rowe',
  refereeDateOfBirth: '1985-03-12',
  refereeAddress: '1 Elm Street',
  refereePostcode: 'AB1 2CD',
  refereePhone: null,
  answers: {},
  reasonId: 'q1',
  referrerEmail: 'referrer@riverside.org',
  referrerPhone: null,
  reviewComment: null,
  repeatReferrals: { count: 0, mostRecentSessionDate: null },
};

function publishedRelease(rules: unknown): ConfigurationRelease {
  return {
    formId: FORM_ID,
    status: 'published',
    questionnaireHash: 'questionnaire-hash',
    rulesHash: 'rules-hash',
    generationId: 'generation-1',
    generatedAt: '2099-08-01T10:00:00.000Z',
    sourceWorkbookId: 'workbook-1',
    createdAt: '2099-08-01T10:00:00.000Z',
    createdByUserId: null,
    publishedAt: '2099-08-01T10:00:00.000Z',
    publishedByUserId: null,
    questionnaire: JSON.stringify(rawFormConfig),
    rules: JSON.stringify(rules),
  };
}

function usePublishedRelease(rules: unknown) {
  server.use(
    http.get('/api/v1/referrals', () => HttpResponse.json({ referrals: [REFERRAL] })),
    http.get('/api/v1/configuration-releases/bulk', () =>
      HttpResponse.json({ releases: [publishedRelease(rules)] }),
    ),
  );
}

describe('a team lead opening a session with preference rules', () => {
  it('explains an invalid fetched published release without attempting pick-list generation', async () => {
    let generationRequests = 0;
    usePublishedRelease({
      rules: [
        {
          when: { key: 'Tea/Coffee' },
          cases: [],
          otherwise: { set: [{ stock: '$selectedAnswer', quantity: 1 }] },
        },
      ],
    });
    server.use(
      http.post('/api/v1/sessions/:sessionId/pick-list', () => {
        generationRequests += 1;
        return HttpResponse.json({});
      }),
    );

    renderApp('/run-sessions/session-1');

    expect(
      await screen.findByRole('heading', { name: 'Pick-list rules need attention' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Rule Tea/Coffee: $selectedAnswer cannot resolve active stock items for Tea, Decaf Tea, Coffee, Decaf Coffee, Hot Chocolate.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('We could not reach the server')).toBeNull();
    expect(generationRequests).toBe(0);
  });

  it('prepares pick lists from a valid fetched published release despite an invalid bundled fallback', async () => {
    let generationRequests = 0;
    usePublishedRelease({ rules: [] });
    server.use(
      http.post('/api/v1/sessions/:sessionId/pick-list', () => {
        generationRequests += 1;
        return HttpResponse.json({
          id: 'pick-list-1',
          sessionId: 'session-1',
          status: 'draft',
          generatedAt: '2099-08-06T09:00:00.000Z',
          firstPrintedAt: null,
        });
      }),
      http.get('/api/v1/sessions/:sessionId/pick-list', () =>
        HttpResponse.json({
          pickList: {
            id: 'pick-list-1',
            sessionId: 'session-1',
            status: 'draft',
            generatedAt: '2099-08-06T09:00:00.000Z',
            firstPrintedAt: null,
          },
          parcels: [],
        }),
      ),
    );

    renderApp('/run-sessions/session-1');

    expect(await screen.findByRole('heading', { name: 'Client List' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pick-list rules need attention' })).toBeNull();
    await waitFor(() => {
      expect(generationRequests).toBe(1);
    });
  });
});
