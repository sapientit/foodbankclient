import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw/server';
import { AuthProvider } from '../../auth/auth-provider';
import { routes } from '../../routes';
import type { PublicSession, ReferralReason, ReferrerCheck } from './queries';

/**
 * The public referral form as a referrer meets it: the real route table, the
 * real auth provider around it, and only the API mocked.
 *
 * **This does not use `test/render-app.tsx`, and the difference is the point.**
 * That harness turns retries off so a failure is fast, which would make two of
 * the assertions below vacuous — "does not retry a 429" cannot be proved by a
 * client that never retries anything. So the query client here mirrors the
 * app's real policy (`src/api/query-client.ts`), and what stops the retry is the
 * `retry: false` on the check query itself.
 *
 * No test here signs anybody in. `AuthProvider` is mounted anyway because that
 * is how `main.tsx` mounts it, and the whole claim being made is that mounting
 * it costs an unauthenticated visitor nothing.
 */

const SESSIONS = '/api/v1/public/sessions';
const CHECK = '/api/v1/public/referrers/check';
const REASONS = '/api/v1/public/referral-reasons';
const ORGANISATIONS = '/api/v1/public/organisations';
const SUBMIT = '/api/v1/public/referrals';
const REFRESH = '/api/v1/auth/refresh';

const TUESDAY: PublicSession = {
  id: 's-tue',
  sessionDate: '2026-08-04',
  startTime: '10:00',
  startsAtUtc: '2026-08-04T09:00:00.000Z',
  durationMinutes: 120,
  location: 'St Mary’s Hall',
  deliveriesAllowed: false,
};

const THURSDAY: PublicSession = {
  id: 's-thu',
  sessionDate: '2026-08-06',
  startTime: '14:30',
  startsAtUtc: '2026-08-06T13:30:00.000Z',
  durationMinutes: 90,
  location: 'The Community Centre',
  deliveriesAllowed: false,
};

const HARDSHIP: ReferralReason = {
  id: 'q1',
  code: 'financial_hardship',
  label: 'Financial hardship',
  displayOrder: 0,
};

function authorised(organisationName: string | null): ReferrerCheck {
  return { authorised: true, organisationName };
}

function unauthorised(): ReferrerCheck {
  return { authorised: false, organisationName: null };
}

function receipt(status: 'active' | 'pending_review') {
  return {
    id: 'r1',
    sessionId: 's-tue',
    status,
    adults: 2,
    children: 0,
    isDelivery: false,
    needsFuelHelp: false,
    refereeFirstName: 'Ada',
    refereeSurname: 'Rowe',
    refereeAddress: '1 Elm Street',
    refereePostcode: 'GU23 4XX',
    referredAt: '2026-08-01T10:00:00.000Z',
  };
}

/** Counts every `POST /auth/refresh` the page causes. It must stay at zero. */
const refreshes = vi.fn();

beforeEach(() => {
  refreshes.mockClear();
  server.use(
    http.post(REFRESH, () => {
      refreshes();
      return HttpResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Sign in again.', requestId: 'r1' } },
        { status: 401 },
      );
    }),
    http.get(SESSIONS, () => HttpResponse.json({ sessions: [TUESDAY, THURSDAY] })),
    http.get(REASONS, () => HttpResponse.json({ referralReasons: [HARDSHIP] })),
    http.get(ORGANISATIONS, () =>
      HttpResponse.json({ organisations: [{ name: 'Riverside Church' }] }),
    ),
    http.post(CHECK, () => HttpResponse.json(authorised('Riverside Church'))),
  );
});

function renderRefer() {
  const queryClient = new QueryClient({
    defaultOptions: {
      // Deliberately the app's policy rather than "off": see the note above.
      queries: { retry: 2, retryDelay: 1, staleTime: 60_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });

  const router = createMemoryRouter(routes, { initialEntries: ['/refer'] });

  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

/** The debounce is real time, so typing has to be followed by a real wait. */
async function typeAddress(value: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/Referrer's email address/), value);
  return user;
}

/**
 * Typing an address and then leaving it. **"We do not recognise that address"
 * is only said about an address somebody has finished with** — see
 * `referrerVerdict` — so any test expecting it has to leave the field, exactly
 * as a referrer does on their way to the next question.
 */
async function typeWholeAddress(value: string) {
  const user = await typeAddress(value);
  await user.tab();
  return user;
}

/** Page one, filled in well enough to move on. Everything mandatory, nothing else. */
async function fillPageOne(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/Referrer's name/), 'Sam Referrer');
  await user.type(screen.getByLabelText(/Referrer's email address/), 'sam@riverside.org');
  await user.selectOptions(
    screen.getByRole('combobox', { name: /Referrer's organisation/ }),
    'Riverside Church',
  );
  await user.type(screen.getByLabelText(/Referrer's contact number/), '01483 123456');
  await user.type(screen.getByLabelText(/Client's first name/), 'Ada');
  await user.type(screen.getByLabelText(/Client's surname/), 'Rowe');
  await user.type(screen.getByLabelText(/Client's date of birth/), '1985-03-12');
  await user.type(screen.getByLabelText(/Client's address/), '1 Elm Street');
  await user.type(screen.getByLabelText(/Client's postcode/), 'gu234xx');
  await user.selectOptions(screen.getByRole('combobox', { name: /Session date/ }), 's-tue');
}

const next = () => screen.getByRole('button', { name: 'Next' });

describe('the public referral form', () => {
  it('issues no auth request for an unauthenticated visitor', async () => {
    renderRefer();

    await screen.findByLabelText(/Referrer's name/);
    await typeAddress('ada@charity.org');
    await screen.findByText(/We have you as Riverside Church/);

    // The structural promise `/refer` makes by being a sibling of the
    // authenticated layout: no guard mounts, so nothing restores a session.
    expect(refreshes).not.toHaveBeenCalled();
  });

  it('sends no Authorization header on a public request', async () => {
    let sessionsAuth: string | null = 'not recorded';
    let checkAuth: string | null = 'not recorded';
    server.use(
      http.get(SESSIONS, ({ request }) => {
        sessionsAuth = request.headers.get('authorization');
        return HttpResponse.json({ sessions: [TUESDAY] });
      }),
      http.post(CHECK, ({ request }) => {
        checkAuth = request.headers.get('authorization');
        return HttpResponse.json(unauthorised());
      }),
    );
    renderRefer();

    await typeWholeAddress('ada@charity.org');
    await screen.findByText(/an administrator will need to approve/);

    // `publicApi`, not `api`. The wrong client would attach a bearer header and,
    // on a 401, fire a refresh for somebody who has no account.
    expect(sessionsAuth).toBeNull();
    expect(checkAuth).toBeNull();
  });

  it('shows which page of how many, so the length is never a surprise', async () => {
    renderRefer();

    expect(await screen.findByText('Page 1 of 7')).toBeInTheDocument();
  });

  it('offers the session start time the server sent, unchanged', async () => {
    renderRefer();

    // A 10:00 session is 09:00 UTC in August. Anything that formats the instant
    // instead of printing the wall clock shows the wrong hour for half the year,
    // silently, on a public page.
    expect(await screen.findByRole('option', { name: /at 10:00/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /at 14:30/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /09:00/ })).toBeNull();
  });

  it('refuses to move on while something mandatory on this page is blank', async () => {
    renderRefer();
    const user = userEvent.setup();

    await screen.findByLabelText(/Referrer's name/);
    await user.click(next());

    expect(await screen.findByText(/Referrer's name is required/)).toBeInTheDocument();
    // Still on page one — a wizard that advances past a blank required field
    // is a wizard that submits it.
    expect(screen.getByText('Page 1 of 7')).toBeInTheDocument();
  });

  it('does not complain about a later page before the referrer has got there', async () => {
    renderRefer();
    const user = userEvent.setup();

    await fillPageOne(user);
    await user.click(next());

    // Page two demands the household counts. Page one must not have mentioned them.
    expect(await screen.findByText('Page 2 of 7')).toBeInTheDocument();
  });

  it('formats the postcode and refuses one that is not a postcode', async () => {
    renderRefer();
    const user = userEvent.setup();

    await screen.findByLabelText(/Client's postcode/);
    await user.type(screen.getByLabelText(/Client's postcode/), 'Guildford');
    await user.click(next());

    expect(await screen.findByText(/enter a valid UK postcode/i)).toBeInTheDocument();
  });

  it('lets the referrer back without validating what they went back to fix', async () => {
    renderRefer();
    const user = userEvent.setup();

    await fillPageOne(user);
    await user.click(next());
    await screen.findByText('Page 2 of 7');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Page 1 of 7')).toBeInTheDocument();
  });
});

describe('the referrer check', () => {
  it('tells an unrecognised referrer their referral needs approval, not that they cannot refer', async () => {
    server.use(http.post(CHECK, () => HttpResponse.json(unauthorised())));
    renderRefer();

    await typeWholeAddress('ada@charity.org');

    // Not a refusal any more. The referral is still taken.
    expect(await screen.findByText(/an administrator will need to approve/)).toBeInTheDocument();
    expect(screen.getByText(/You can carry on and send it/)).toBeInTheDocument();
    // The person has done nothing wrong and an alert would say they had.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('never says it does not recognise an address somebody is still typing', async () => {
    /*
     * The reported bug, and the reason the verdict waits. `pete@guildford.gov`
     * is a complete-looking address on the way to `pete@guildford.gov.uk`, so
     * it is checked and the server rightly answers no — and the screen then
     * told a referrer the charity does know, in a live region, that it did not.
     */
    const checked: string[] = [];
    server.use(
      http.post(CHECK, async ({ request }) => {
        const { email } = (await request.json()) as { email: string };
        checked.push(email);
        return HttpResponse.json(
          email === 'pete@guildford.gov.uk' ? authorised('Guildford Council') : unauthorised(),
        );
      }),
    );
    renderRefer();

    const user = await typeAddress('pete@guildford.gov');

    // Waited for the "no" to actually arrive: asserting silence before the
    // server has answered would pass however the screen behaved.
    await waitFor(() => {
      expect(checked).toContain('pete@guildford.gov');
    });
    await settle();
    expect(screen.queryByText(/We do not recognise/)).toBeNull();

    await user.type(screen.getByLabelText(/Referrer's email address/), '.uk');
    expect(await screen.findByText('We have you as Guildford Council.')).toBeInTheDocument();
  });

  it('takes back an unrecognised verdict as soon as the address is edited again', async () => {
    server.use(http.post(CHECK, () => HttpResponse.json(unauthorised())));
    renderRefer();

    const user = await typeWholeAddress('ada@charity.orgg');
    await screen.findByText(/an administrator will need to approve/);

    // Correcting a typo. The verdict was about the address as it stood, and
    // saying it again over a half-corrected one is the same bug in reverse.
    await user.type(screen.getByLabelText(/Referrer's email address/), '{Backspace}');
    expect(screen.queryByText(/We do not recognise/)).toBeNull();
  });

  it('fills in the organisation a recognised address already belongs to', async () => {
    // `screenDetails.md`: the organisation is already known, so the form fills
    // it in rather than asking a referrer to find themselves in a dropdown.
    renderRefer();

    await typeAddress('ada@riverside.org');
    await screen.findByText('We have you as Riverside Church.');

    expect(screen.getByRole('combobox', { name: /Referrer's organisation/ })).toHaveValue(
      'Riverside Church',
    );
  });

  it('never overwrites an organisation the referrer chose for themselves', async () => {
    server.use(
      http.get(ORGANISATIONS, () =>
        HttpResponse.json({
          organisations: [{ name: 'Riverside Church' }, { name: 'St Mary’s Primary' }],
        }),
      ),
    );
    renderRefer();

    const user = userEvent.setup();
    await user.selectOptions(
      await screen.findByRole('combobox', { name: /Referrer's organisation/ }),
      'St Mary’s Primary',
    );

    await user.type(screen.getByLabelText(/Referrer's email address/), 'ada@riverside.org');
    await screen.findByText('We have you as Riverside Church.');

    // They may well be right and the list wrong: a referrer at two organisations
    // is ordinary, and the answer is theirs.
    expect(screen.getByRole('combobox', { name: /Referrer's organisation/ })).toHaveValue(
      'St Mary’s Primary',
    );
  });

  it('names the organisation when the address is recognised', async () => {
    server.use(http.post(CHECK, () => HttpResponse.json(authorised('St Mary’s Primary'))));
    renderRefer();

    await typeAddress('ada@stmarys.sch.uk');

    expect(await screen.findByText('We have you as St Mary’s Primary.')).toBeInTheDocument();
  });

  it('never renders the word null when a recognised address has no organisation', async () => {
    server.use(http.post(CHECK, () => HttpResponse.json(authorised(null))));
    renderRefer();

    await typeAddress('ada@charity.org');

    expect(
      await screen.findByText('That address can refer to this food bank.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/null/)).toBeNull();
  });

  it('sends the address in the body and never in the URL', async () => {
    const urls: string[] = [];
    let body: unknown = null;
    server.use(
      http.post(CHECK, async ({ request }) => {
        urls.push(request.url);
        body = await request.json();
        return HttpResponse.json(authorised('St Mary’s Primary'));
      }),
    );
    renderRefer();

    await typeAddress('Ada@Charity.ORG');
    await screen.findByText('We have you as St Mary’s Primary.');

    /*
     * A URL reaches browser history, the referrer header of everything the page
     * loads, and every access log on the way to the origin. This is somebody's
     * identity at a charity.
     */
    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toContain('@');
    expect(urls[0]).not.toContain('ada');
    expect(new URL(urls[0] ?? '').search).toBe('');
    // Trimmed and lowercased, the way the server stores an authorised address.
    expect(body).toEqual({ email: 'ada@charity.org' });
  });

  it('does not fire a request per keystroke', async () => {
    const posts = vi.fn();
    server.use(
      http.post(CHECK, () => {
        posts();
        return HttpResponse.json(authorised('Charity'));
      }),
    );
    renderRefer();

    // Fifteen characters. Undebounced, that is fifteen requests against a budget
    // of roughly sixty a minute for the whole food bank.
    await typeAddress('ada@charity.org');
    await screen.findByText('We have you as Charity.');

    expect(posts).toHaveBeenCalledTimes(1);
  });

  it('tells the referrer to wait on a 429 and does not retry', async () => {
    const posts = vi.fn();
    server.use(
      http.post(CHECK, () => {
        posts();
        return HttpResponse.json(
          { error: { code: 'BAD_REQUEST', message: 'Too many requests', requestId: 'r1' } },
          { status: 429 },
        );
      }),
    );
    renderRefer();

    await typeAddress('ada@charity.org');
    await waitFor(() => {
      expect(posts).toHaveBeenCalledTimes(1);
    });

    /*
     * The client's default policy backs a 429 off and retries it twice. That is
     * right for a screen someone opened; it is wrong for a check driven by
     * keystrokes, where the person is already retrying and the automatic attempt
     * only spends more of the limit that produced the 429.
     */
    await settle();
    expect(posts).toHaveBeenCalledTimes(1);
  });

  it('cannot let a slow answer overwrite a newer one', async () => {
    /*
     * The failure this exists to stop: somebody corrects a typo, the check for
     * the wrong address answers last, and the screen tells them the wrong thing
     * about their real address. Two addresses are two cache entries, so it is
     * structurally impossible — this is the guard against somebody replacing
     * that with a single piece of state.
     */
    const slow = deferred();
    const fast = deferred();
    const finished: string[] = [];

    server.use(
      http.post(CHECK, async ({ request }) => {
        const { email } = (await request.json()) as { email: string };

        if (email === 'typo@charity.org') {
          await slow.promise;
          finished.push(email);
          return HttpResponse.json(authorised('Wrong Organisation'));
        }

        await fast.promise;
        finished.push(email);
        return HttpResponse.json(unauthorised());
      }),
    );
    renderRefer();

    const user = await typeAddress('typo@charity.org');
    await screen.findByText('Checking that address…');

    await user.clear(screen.getByLabelText(/Referrer's email address/));
    await user.type(screen.getByLabelText(/Referrer's email address/), 'ada@charity.org');
    await user.tab();

    fast.resolve();
    expect(await screen.findByText(/an administrator will need to approve/)).toBeInTheDocument();

    slow.resolve();
    await waitFor(() => {
      expect(finished).toContain('typo@charity.org');
    });
    await settle();

    expect(screen.queryByText(/Wrong Organisation/)).toBeNull();
  });
});

describe('the questions themselves', () => {
  it('greys out the fuel follow-ups until the fuel question is answered', async () => {
    renderRefer();
    const user = userEvent.setup();

    await fillPageOne(user);
    for (let page = 2; page <= 6; page += 1) {
      await user.click(next());
      await screen.findByText(`Page ${String(page)} of 7`);
      if (page === 2) {
        await user.type(screen.getByLabelText(/Number of adults in client's family/), '2');
        await user.type(screen.getByLabelText(/Number of children in client's family/), '0');
      }
      if (page === 3) {
        await user.selectOptions(
          screen.getByRole('combobox', { name: /Main cause of crisis/ }),
          'q1',
        );
      }
    }

    const prePayment = screen.getByRole('group', { name: /pre-payment meters/ });
    expect(prePayment).toHaveTextContent('Is the client on pre-payment meters');
    // Visible but not answerable — somebody has to be able to see what they
    // would be agreeing to if they said yes above.
    expect(within(prePayment).getByRole('checkbox', { name: 'Yes' })).toBeDisabled();

    await user.click(screen.getByLabelText(/gas and\/or electricity/));
    expect(within(prePayment).getByRole('checkbox', { name: 'Yes' })).toBeEnabled();
  });

  it('starts a preference question on its declared default, with None unticked', async () => {
    renderRefer();
    const user = userEvent.setup();

    await fillPageOne(user);
    await user.click(next());
    await screen.findByText('Page 2 of 7');
    await user.type(screen.getByLabelText(/Number of adults in client's family/), '2');
    await user.type(screen.getByLabelText(/Number of children in client's family/), '0');
    await user.click(next());
    await screen.findByText('Page 3 of 7');
    await user.selectOptions(screen.getByRole('combobox', { name: /Main cause of crisis/ }), 'q1');
    await user.click(next());
    await screen.findByText('Page 4 of 7');

    const pastaOrRice = within(screen.getByRole('group', { name: /pasta or rice/ }));
    expect(pastaOrRice.getByRole('checkbox', { name: 'Both' })).toBeChecked();
    expect(pastaOrRice.getByRole('checkbox', { name: 'None' })).not.toBeChecked();
    expect(pastaOrRice.getByText('Choose up to one, or None.')).toBeInTheDocument();

    // None clears everything else, and is the only thing ticked afterwards.
    await user.click(pastaOrRice.getByRole('checkbox', { name: 'None' }));
    expect(pastaOrRice.getByRole('checkbox', { name: 'Both' })).not.toBeChecked();
    expect(pastaOrRice.getByRole('checkbox', { name: 'None' })).toBeChecked();
  });
});

describe('submitting', () => {
  /** Every page filled and sent. Long, because the thing being proved is the whole journey. */
  async function submitTheForm(user: ReturnType<typeof userEvent.setup>) {
    await fillPageOne(user);
    await user.click(next());

    await screen.findByText('Page 2 of 7');
    await user.type(screen.getByLabelText(/Number of adults in client's family/), '2');
    await user.type(screen.getByLabelText(/Number of children in client's family/), '0');
    await user.click(next());

    await screen.findByText('Page 3 of 7');
    await user.selectOptions(screen.getByRole('combobox', { name: /Main cause of crisis/ }), 'q1');
    await user.click(next());

    for (const page of [4, 5, 6]) {
      await screen.findByText(`Page ${String(page)} of 7`);
      await user.click(next());
    }

    await screen.findByText('Page 7 of 7');
    await user.click(screen.getByRole('button', { name: 'Send this referral' }));
  }

  it('splits the answers into typed columns and the answers bag', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(SUBMIT, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(receipt('active'), { status: 201 });
      }),
    );
    renderRefer();

    await submitTheForm(userEvent.setup());
    await waitFor(() => {
      expect(body.sessionId).toBe('s-tue');
    });

    // The fixed columns, at the top level and typed.
    expect(body).toMatchObject({
      referrerName: 'Sam Referrer',
      referrerEmail: 'sam@riverside.org',
      referrerOrganisation: 'Riverside Church',
      refereeFirstName: 'Ada',
      refereeSurname: 'Rowe',
      refereeDateOfBirth: '1985-03-12',
      refereeAddress: '1 Elm Street',
      // Formatted on the way out, because it is searched on.
      refereePostcode: 'GU23 4XX',
      reasonId: 'q1',
      adults: 2,
      children: 0,
      isDelivery: false,
      needsFuelHelp: false,
    });
    expect(typeof body.adults).toBe('number');

    // The defaults, under the charity's own keys, as single values rather than
    // lists of one — `referral details.txt`: "there will be an eggs: 'Yes' entry".
    expect(body.answers).toMatchObject({ 'Pasta/Rice': 'Both', Oil: 'Yes', Eggs: 'Yes' });
    // A question left on None records nothing at all.
    expect(body.answers).not.toHaveProperty('Porridge');
    expect(body.answers).not.toHaveProperty('Sanitary');
    // A choice that takes several stays a list.
    expect(body.answers).toMatchObject({
      Toiletries: ['Shower Gel', 'Deodorant', 'Conditioner'],
    });
    // A key field never leaks into the answers bag.
    expect(body.answers).not.toHaveProperty('adults');
    expect(body.answers).not.toHaveProperty('refereePostcode');
  });

  it('shows what was sent back, and says it cannot be changed', async () => {
    server.use(http.post(SUBMIT, () => HttpResponse.json(receipt('active'), { status: 201 })));
    renderRefer();

    await submitTheForm(userEvent.setup());

    expect(await screen.findByRole('heading', { name: 'Referral sent' })).toBeInTheDocument();
    expect(screen.getByText(/You cannot change a referral once it is sent/)).toBeInTheDocument();
    expect(screen.getByText(/phone the food bank/i)).toBeInTheDocument();

    // The mandatory answers, back on screen — the referrer's only chance to
    // notice a wrong surname before it becomes a phone call.
    expect(screen.getByText('Rowe')).toBeInTheDocument();
    expect(screen.getByText('GU23 4XX')).toBeInTheDocument();

    // No amend, no withdraw, no countdown. There is no edit window any more.
    expect(screen.queryByRole('button', { name: /amend|withdraw|change/i })).toBeNull();
  });

  it('says plainly that a referral awaiting review is not a booking', async () => {
    server.use(
      http.post(SUBMIT, () => HttpResponse.json(receipt('pending_review'), { status: 201 })),
    );
    renderRefer();

    await submitTheForm(userEvent.setup());

    expect(
      await screen.findByRole('heading', { name: 'This household is not booked in yet' }),
    ).toBeInTheDocument();
    // The failure this prevents: somebody leaves believing a household is
    // booked in when an administrator has not looked at it yet.
    expect(screen.getByText(/Nobody should turn up to a session until/)).toBeInTheDocument();
  });

  it('never retries a failed submission, because a referral is not idempotent', async () => {
    const posts = vi.fn();
    server.use(
      http.post(SUBMIT, () => {
        posts();
        return HttpResponse.json(
          { error: { code: 'CONFLICT', message: 'That session is now full.', requestId: 'r1' } },
          { status: 409 },
        );
      }),
    );
    renderRefer();

    await submitTheForm(userEvent.setup());

    // The `409` message is written to be shown — "the session is full" is the
    // one useful sentence, and a generic apology throws it away.
    expect(await screen.findByRole('alert')).toHaveTextContent('That session is now full.');
    await settle();
    expect(posts).toHaveBeenCalledTimes(1);
  });
});

function deferred() {
  let resolve: () => void = () => {
    throw new Error('The promise executor has not run.');
  };
  const promise = new Promise<void>((settleIt) => {
    resolve = settleIt;
  });

  return {
    promise,
    resolve: () => {
      resolve();
    },
  };
}

/** Lets a resolved response finish reaching React before asserting it did not. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
