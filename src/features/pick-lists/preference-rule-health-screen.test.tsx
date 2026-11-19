import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type {
  ConfigurationRelease,
  ConfigurationReleaseSummary,
} from '../configuration-releases/queries';
import rawFormConfig from '../referrals/referral-form.config.json';

const FORM_ID = 'f1111111-1111-1111-1111-111111111111';

function publishedReleaseSummary(): ConfigurationReleaseSummary {
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
  };
}

function publishedRelease(): ConfigurationRelease {
  return {
    ...publishedReleaseSummary(),
    questionnaire: JSON.stringify(rawFormConfig),
    rules: JSON.stringify({ rules: [] }),
  };
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
    http.get('/api/v1/stock/items', () => HttpResponse.json({ items: [] })),
    http.get('/api/v1/configuration-releases', () =>
      HttpResponse.json([publishedReleaseSummary()]),
    ),
    http.get('/api/v1/configuration-releases/bulk', () =>
      HttpResponse.json({ releases: [publishedRelease()] }),
    ),
  );
});

describe('preference rule check', () => {
  it('groups the rule count and check outcome in a labelled results card', async () => {
    renderApp('/preference-rules');

    const results = await screen.findByRole('region', { name: 'Preference rule check results' });
    expect(
      within(results).getByText(/checked against the current questionnaire and active stock items/),
    ).toBeVisible();
  });

  it('checks the currently published release, never the bundled local fixture', async () => {
    renderApp('/preference-rules');

    const results = await screen.findByRole('region', { name: 'Preference rule check results' });
    expect(within(results).getByText(/^0 rules checked/)).toBeVisible();
    expect(within(results).getByRole('status')).toHaveTextContent(
      'All preference rules are valid.',
    );
  });
});
