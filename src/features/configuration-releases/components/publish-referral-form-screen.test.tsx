import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../../test/msw/server';
import { renderApp } from '../../../../test/render-app';
import type { readGeneratedRelease as ReadGeneratedRelease } from '../configuration-release-sheet';

interface ConfigurationReleaseSheetModule {
  readonly readGeneratedRelease: typeof ReadGeneratedRelease;
}

vi.mock('../../../lib/google-auth', () => ({
  preloadSheetsAccess: vi.fn(() => Promise.resolve()),
  requestSheetsAccess: vi.fn(() => Promise.resolve('sheets-token')),
}));

const VALID_QUESTIONNAIRE = JSON.stringify({
  version: 1,
  pages: [
    {
      pageNum: 1,
      pageTitle: 'Preferences',
      questions: [
        {
          questionNum: 1,
          questionKey: 'Toiletries',
          questionTitle: 'Do you need any toiletries?',
          preference: true,
          required: false,
          validation: { type: 'CheckBox', answerMin: 0, answerMax: 5 },
          answers: ['Soap'],
        },
      ],
    },
  ],
});
const VALID_RULES = JSON.stringify({
  rules: [
    {
      when: { key: 'Toiletries' },
      otherwise: { set: [{ stock: '$selectedAnswer', quantity: 1 }] },
    },
  ],
});

const { readGeneratedRelease } = vi.hoisted(() => ({
  readGeneratedRelease: vi.fn<() => Promise<unknown>>(),
}));
vi.mock('../configuration-release-sheet', async (importOriginal) => {
  const actual = await importOriginal<ConfigurationReleaseSheetModule>();
  return { ...actual, readGeneratedRelease };
});

const STOCK_ITEMS = [
  {
    id: 'soap',
    name: 'Soap',
    category: 'Toiletries',
    description: null,
    shelfNumber: 'A1',
    lowStockThreshold: null,
    groupingId: null,
    unitsPerPack: null,
    packUnitLabel: null,
    isActive: true,
  },
];

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

beforeEach(() => {
  server.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        user: { id: 'u1', email: 'pete@x.com', displayName: 'Pete Bennett', role: 'admin' },
      }),
    ),
    http.get('/api/v1/stock/items', () => HttpResponse.json({ items: STOCK_ITEMS })),
    http.get('/api/v1/configuration-releases/config', () =>
      HttpResponse.json({
        configured: true,
        spreadsheetId: 'workbook-id',
        googleClientId: 'google-client-id',
      }),
    ),
  );
  readGeneratedRelease.mockReset();
});

describe('publish referral form', () => {
  it('shows the description and the one button', async () => {
    renderApp('/configuration-releases');

    expect(
      await screen.findByRole('heading', { name: 'Publish referral form' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Fetch and publish the latest version' }),
    ).toBeInTheDocument();
  });

  it('publishes a version that matches its manifest and passes validation', async () => {
    const [questionnaireSha256, rulesSha256] = await Promise.all([
      sha256Hex(VALID_QUESTIONNAIRE),
      sha256Hex(VALID_RULES),
    ]);
    readGeneratedRelease.mockResolvedValue({
      questionnaire: VALID_QUESTIONNAIRE,
      rules: VALID_RULES,
      manifestRaw: JSON.stringify({
        version: 1,
        generationId: 'gen-1',
        generatedAt: '2026-03-01T09:00:00.000Z',
        questionnaireSha256,
        rulesSha256,
      }),
    });
    let uploaded: unknown = null;
    server.use(
      http.post('/api/v1/configuration-releases', async ({ request }) => {
        uploaded = await request.json();
        return HttpResponse.json({ formId: 'new-form-id' }, { status: 201 });
      }),
      http.post('/api/v1/configuration-releases/:formId/publish', ({ params }) =>
        HttpResponse.json({ formId: params.formId, status: 'published' }),
      ),
    );
    const user = userEvent.setup();
    renderApp('/configuration-releases');

    await user.click(
      await screen.findByRole('button', { name: 'Fetch and publish the latest version' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Publish this version?' }),
    ).toBeInTheDocument();
    // The London-formatted generation time, not the raw ISO string.
    expect(screen.getByText(/generated on/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Publish this version' }));

    expect(await screen.findByText('The new version is now live.')).toBeInTheDocument();
    expect(screen.getByText('Version id: new-form-id')).toBeInTheDocument();
    await waitFor(() => {
      expect(uploaded).toMatchObject({
        questionnaire: VALID_QUESTIONNAIRE,
        rules: VALID_RULES,
        questionnaireHash: questionnaireSha256,
        rulesHash: rulesSha256,
        generationId: 'gen-1',
        sourceWorkbookId: 'workbook-id',
      });
    });
  });

  it('refuses to publish a version whose rules no longer resolve against active stock', async () => {
    const rulesForRetiredItem = JSON.stringify({
      rules: [
        {
          when: { key: 'Toiletries' },
          otherwise: { set: [{ stock: 'Marmite', quantity: 1 }] },
        },
      ],
    });
    const [questionnaireSha256, rulesSha256] = await Promise.all([
      sha256Hex(VALID_QUESTIONNAIRE),
      sha256Hex(rulesForRetiredItem),
    ]);
    readGeneratedRelease.mockResolvedValue({
      questionnaire: VALID_QUESTIONNAIRE,
      rules: rulesForRetiredItem,
      manifestRaw: JSON.stringify({
        version: 1,
        generationId: 'gen-2',
        generatedAt: '2026-03-01T09:00:00.000Z',
        questionnaireSha256,
        rulesSha256,
      }),
    });
    let uploadCalled = false;
    server.use(
      http.post('/api/v1/configuration-releases', () => {
        uploadCalled = true;
        return HttpResponse.json({ formId: 'unused' }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/configuration-releases');

    await user.click(
      await screen.findByRole('button', { name: 'Fetch and publish the latest version' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Publish this version' }));

    expect(await screen.findByText('This version cannot be published:')).toBeInTheDocument();
    expect(screen.getByText(/Marmite/)).toBeInTheDocument();
    expect(uploadCalled).toBe(false);
  });

  it('says publishing is not configured rather than starting a flow that cannot finish', async () => {
    server.use(
      http.get('/api/v1/configuration-releases/config', () =>
        HttpResponse.json({ configured: false }),
      ),
    );
    const user = userEvent.setup();
    renderApp('/configuration-releases');

    await user.click(
      await screen.findByRole('button', { name: 'Fetch and publish the latest version' }),
    );

    expect(await screen.findByText(/not configured for this deployment/)).toBeInTheDocument();
    expect(readGeneratedRelease).not.toHaveBeenCalled();
  });
});
