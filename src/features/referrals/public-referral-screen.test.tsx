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
  // `PublicSession` carries the *resolved* window, never null. Deliberately
  // NOT this session's own hours (10:00, 120 minutes): the van does not go out
  // when the hall opens, and quoting `startTime` instead of the window is the
  // mistake these tests exist to catch.
  deliveryWindowStart: '13:00',
  deliveryWindowEnd: '15:00',
  deliveryAvailability: 'available',
};

const THURSDAY: PublicSession = {
  id: 's-thu',
  sessionDate: '2026-08-06',
  startTime: '14:30',
  startsAtUtc: '2026-08-06T13:30:00.000Z',
  durationMinutes: 90,
  location: 'The Community Centre',
  deliveryWindowStart: '14:30',
  deliveryWindowEnd: '16:00',
  deliveryAvailability: 'not_offered',
};

/**
 * Delivers, but every delivery place has gone. The third of the three
 * positions, and the one that only exists because the food bank now refuses a
 * delivery to it.
 */
const FRIDAY: PublicSession = {
  id: 's-fri',
  sessionDate: '2026-08-07',
  startTime: '09:00',
  startsAtUtc: '2026-08-07T08:00:00.000Z',
  durationMinutes: 120,
  location: 'St Mary’s Hall',
  deliveryWindowStart: '13:00',
  deliveryWindowEnd: '15:00',
  deliveryAvailability: 'full',
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
    infants: 0,
    children4To11: 0,
    teenagers12To17: 0,
    adults18Plus: 2,
    isDelivery: false,
    needsFuelHelp: false,
    refereeFirstName: 'Ada',
    refereeSurname: 'Rowe',
    refereeAddress: '1 Elm Street',
    refereePostcode: 'GU23 4XX',
    referredAt: '2026-08-01T10:00:00.000Z',
  };
}

async function fillHouseholdComposition(user: ReturnType<typeof userEvent.setup>) {
  const adultFemale = screen.getByLabelText('18 to State Pension age, Female');
  await user.clear(adultFemale);
  await user.type(adultFemale, '2');
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
  await user.selectOptions(screen.getByRole('combobox', { name: /Client's gender/ }), 'Female');
  await user.selectOptions(screen.getByRole('combobox', { name: /^Ethnicity/ }), 'White -British');
  await user.type(screen.getByLabelText(/Spoken Languages/), 'English');
  await user.type(screen.getByLabelText(/Client's address/), '1 Elm Street');
  await user.type(screen.getByLabelText(/Client's postcode/), 'gu234xx');
  await fillHouseholdComposition(user);
  await user.selectOptions(
    screen.getByRole('combobox', { name: /main source of income/i }),
    'Benefits',
  );
  await user.selectOptions(screen.getByRole('combobox', { name: /Main cause of crisis/ }), 'q1');
  await user.selectOptions(screen.getByRole('combobox', { name: /Session date/ }), 's-tue');
  await user.selectOptions(
    screen.getByRole('combobox', { name: /How will the parcel be collected/ }),
    'Car',
  );
}

const next = () => screen.getByRole('button', { name: 'Next' });

describe('the public referral form', () => {
  it('shows the Foodbank banner above the public form', async () => {
    renderRefer();

    expect(await screen.findByRole('img', { name: 'Foodbank logo' })).toBeInTheDocument();
  });

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

  it('requires a household composition with someone aged 12 or over before moving on', async () => {
    renderRefer();
    const user = userEvent.setup();

    await fillPageOne(user);
    // Found by cell rather than by the question's own heading. The heading is
    // editorial text from the charity's questionnaire spreadsheet and has been
    // reworded twice; the cell labels are built by the grid itself, so matching
    // on them is what stops a reworded question failing a test about adults.
    await user.clear(screen.getByLabelText('18 to State Pension age, Female'));
    await user.type(screen.getByLabelText('0–4, Male'), '1');
    await user.click(next());

    expect(
      await screen.findByText('A household must include at least one person aged 12 or over.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 7')).toBeInTheDocument();
  });

  it('accepts a household of teenagers, who are adults for the purpose of the grid', async () => {
    renderRefer();
    const user = userEvent.setup();

    await fillPageOne(user);
    await user.clear(screen.getByLabelText('18 to State Pension age, Female'));
    await user.type(screen.getByLabelText('12–17, Male'), '1');
    await user.click(next());

    expect(await screen.findByText('Page 2 of 7')).toBeInTheDocument();
  });

  it('does not complain about a later page before the referrer has got there', async () => {
    renderRefer();
    const user = userEvent.setup();

    await fillPageOne(user);
    await user.click(next());

    // Page two has no mandatory questions, after page one's required household details.
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
  it('shows a conditional No Answer row as text, never as a response field', async () => {
    renderRefer();
    const user = userEvent.setup();

    await fillPageOne(user);
    expect(screen.queryByText('Delivery is restricted to people who…')).toBeNull();

    await user.selectOptions(
      screen.getByRole('combobox', { name: /How will the parcel be collected/ }),
      'Delivery Requested',
    );
    expect(screen.getByText('Delivery is restricted to people who…')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Delivery is restricted/ })).toBeNull();
  });

  it('states the chosen session’s delivery window, not the time the hall opens', async () => {
    renderRefer();
    const user = userEvent.setup();

    await fillPageOne(user);
    await user.selectOptions(
      screen.getByRole('combobox', { name: /How will the parcel be collected/ }),
      'Delivery Requested',
    );

    // Tuesday opens at 10:00 and delivers 13:00–15:00. Quoting the session's
    // own start time here would be wrong for exactly the sessions a delivery
    // window exists for, so the assertion is on the window and against 10:00.
    // The label is bold and the window is not, because the plain sentence this
    // replaced was read straight past.
    const label = screen.getByText('Delivery Time:');
    expect(label.tagName).toBe('STRONG');
    expect(label.parentElement).toHaveTextContent(
      'Delivery Time: between 13:00 and 15:00 on Tue, 4 Aug 2026',
    );
    expect(screen.queryByText(/between 10:00/)).toBeNull();
  });

  it('says a session takes no deliveries rather than quoting a window it cannot keep', async () => {
    renderRefer();
    const user = userEvent.setup();

    await fillPageOne(user);
    await user.selectOptions(screen.getByRole('combobox', { name: /Session date/ }), 's-thu');
    await user.selectOptions(
      screen.getByRole('combobox', { name: /How will the parcel be collected/ }),
      'Delivery Requested',
    );

    expect(screen.getByText('Delivery Time:').parentElement).toHaveTextContent(
      'Delivery Time: No deliveries available for this session',
    );

    // **The form states the position and does not police it** — Pete,
    // 2026-08-19. The food bank itself now refuses this delivery, with a `409`
    // on submission, but the form does not pre-empt that: a referrer who has
    // read the line above has already been told, and the only case a check
    // could catch is the race no client-side check can win.
    for (const box of screen.getAllByRole('checkbox', { name: /^The client/ })) {
      await user.click(box);
    }
    await user.click(next());
    expect(await screen.findByRole('heading', { name: 'Food Preference' })).toBeInTheDocument();
  });

  it('says a session has no delivery places left, which is not the same as having no driver', async () => {
    // The third position. `not_offered` is a session with nobody driving;
    // this one drives, and its places have gone — so a referrer reading it may
    // find room on the next session rather than none at all.
    server.use(http.get(SESSIONS, () => HttpResponse.json({ sessions: [TUESDAY, FRIDAY] })));
    renderRefer();
    const user = userEvent.setup();

    await fillPageOne(user);
    await user.selectOptions(screen.getByRole('combobox', { name: /Session date/ }), 's-fri');
    await user.selectOptions(
      screen.getByRole('combobox', { name: /How will the parcel be collected/ }),
      'Delivery Requested',
    );

    expect(screen.getByText('Delivery Time:').parentElement).toHaveTextContent(
      'Delivery Time: No delivery slots available for this session',
    );
  });

  it('still lets a delivery be asked for on a session whose delivery places have gone', async () => {
    /*
     * The regression test for Pete's decision of 2026-08-19, and it protects an
     * *absence*: the form deliberately does not check what it has just told the
     * referrer. Anybody adding a pre-emptive block here — which reads like an
     * improvement — breaks this, which is the point of writing it down.
     */
    server.use(http.get(SESSIONS, () => HttpResponse.json({ sessions: [TUESDAY, FRIDAY] })));
    renderRefer();
    const user = userEvent.setup();

    await fillPageOne(user);
    await user.selectOptions(screen.getByRole('combobox', { name: /Session date/ }), 's-fri');
    await user.selectOptions(
      screen.getByRole('combobox', { name: /How will the parcel be collected/ }),
      'Delivery Requested',
    );
    for (const box of screen.getAllByRole('checkbox', { name: /^The client/ })) {
      await user.click(box);
    }

    await user.click(next());
    expect(await screen.findByRole('heading', { name: 'Food Preference' })).toBeInTheDocument();
  });

  it('never prints the raw $deliveryTime token before a session is chosen', async () => {
    renderRefer();
    const user = userEvent.setup();

    // Every question up to and including the collection method, but no session
    // — the one state in which the variable has nothing to resolve against.
    await user.type(await screen.findByLabelText(/Referrer's name/), 'Sam Referrer');
    await user.selectOptions(
      screen.getByRole('combobox', { name: /How will the parcel be collected/ }),
      'Delivery Requested',
    );

    // The row hides rather than showing the token or an empty sentence.
    expect(screen.queryByText(/\$deliveryTime/)).toBeNull();
    expect(screen.getByText('Delivery is restricted to people who…')).toBeInTheDocument();
  });

  it('requires both delivery confirmations, not just one', async () => {
    renderRefer();
    const user = userEvent.setup();

    await fillPageOne(user);
    await user.selectOptions(
      screen.getByRole('combobox', { name: /How will the parcel be collected/ }),
      'Delivery Requested',
    );

    const criteria = screen.getByRole('checkbox', {
      name: 'The client meets the criteria for delivery',
    });
    const atHome = screen.getByRole('checkbox', {
      name: 'The client will be at home for the delivery time above',
    });

    // One of the two is not a confirmation of the pair.
    await user.click(criteria);
    await user.click(next());
    expect(
      screen.getByRole('heading', { name: 'Referrer and client details' }),
    ).toBeInTheDocument();

    await user.click(atHome);
    await user.click(next());
    expect(await screen.findByRole('heading', { name: 'Food Preference' })).toBeInTheDocument();
  });

  it('greys out the fuel follow-ups until the fuel question is answered', async () => {
    renderRefer();
    const user = userEvent.setup();

    await fillPageOne(user);
    for (let page = 2; page <= 6; page += 1) {
      await user.click(next());
      await screen.findByText(`Page ${String(page)} of 7`);
      if (page === 2) await user.click(screen.getByLabelText('Oven'));
    }

    const fuelPension = screen.getByRole('group', {
      name: /people in the household over state pension age/,
    });
    expect(fuelPension).toHaveTextContent(
      'Are there people in the household over state pension age',
    );
    // Visible but not answerable — somebody has to be able to see what they
    // would be agreeing to if they said yes above.
    expect(within(fuelPension).getByRole('combobox')).toBeDisabled();

    await user.click(screen.getByLabelText(/help with Energy costs/));
    expect(within(fuelPension).getByRole('combobox')).toBeEnabled();
  });

  it('starts a one-choice preference dropdown on its declared default and can clear it', async () => {
    renderRefer();
    const user = userEvent.setup();

    await fillPageOne(user);
    await user.click(next());
    await screen.findByText('Page 2 of 7');

    const pastaOrRice = within(screen.getByRole('group', { name: /pasta or rice/ }));
    expect(pastaOrRice.getByRole('combobox')).toHaveValue('Both');
    expect(pastaOrRice.queryByText(/Choose up to one/)).not.toBeInTheDocument();

    await user.selectOptions(pastaOrRice.getByRole('combobox'), '');
    expect(pastaOrRice.getByRole('combobox')).toHaveValue('');
  });
});

describe('submitting', () => {
  /** Every page filled and sent. Long, because the thing being proved is the whole journey. */
  async function submitTheForm(user: ReturnType<typeof userEvent.setup>) {
    await fillPageOne(user);
    await sendFromPageOne(user);
  }

  /**
   * Pages two to seven, and Send. Split from `submitTheForm` so a test can fill
   * page one its own way — asking for a delivery, say — and still make the
   * same journey through the rest.
   */
  async function sendFromPageOne(user: ReturnType<typeof userEvent.setup>) {
    await user.click(next());

    await screen.findByText('Page 2 of 7');
    // Only if it needs it — this walk is made twice by tests that are refused
    // and send again, and a second click would untick what the first set.
    const oven = screen.getByLabelText<HTMLInputElement>('Oven');
    if (!oven.checked) await user.click(oven);
    await user.click(next());

    await screen.findByText('Page 3 of 7');
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

    // One-choice defaults are a bare value; multi-choice defaults are lists.
    expect(body.answers).toMatchObject({
      'Pasta/Rice': 'Both',
      Spread: ['Jam'],
      'Tea/Coffee': ['Tea', 'Coffee'],
    });
    // A question left on None records nothing at all.
    expect(body.answers).not.toHaveProperty('Porridge');
    expect(body.answers).not.toHaveProperty('Tampons');
    // A choice that takes several stays a list.
    expect(body.answers).toMatchObject({
      Toiletries: ['Shower gel', 'Deodorant', 'Conditioner'],
    });
    // A key field never leaks into the answers bag.
    // The composition is one sparse reporting answer: untouched zero cells do
    // not create a misleading second set of zero totals in stored JSON.
    expect(body.answers).toHaveProperty('Household Components', {
      'working-age': { female: 2 },
    });
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

  /**
   * The confirmation used to print the two ids the form submits. A referrer
   * cannot check a UUID, and checking is the only thing the screen is for — so
   * "did I pick the right session?" was unanswerable on the one page that had
   * to answer it.
   */
  it('shows the chosen session and reason as words, not as the ids that were sent', async () => {
    server.use(http.post(SUBMIT, () => HttpResponse.json(receipt('active'), { status: 201 })));
    renderRefer();

    await submitTheForm(userEvent.setup());
    await screen.findByRole('heading', { name: 'Referral sent' });

    const summary = screen.getByRole('heading', { name: 'What you sent' }).parentElement;
    if (summary === null) throw new Error('The confirmation summary is not on the page');

    // The same words the dropdown offered: date, wall-clock time, and where.
    expect(within(summary).getByText('Tue, 4 Aug 2026 at 10:00')).toBeInTheDocument();
    expect(within(summary).getByText('Financial hardship')).toBeInTheDocument();

    // Neither id reaches the page, under any label.
    expect(summary.textContent).not.toContain('s-tue');
    expect(summary.textContent).not.toContain('q1');
  });

  it('tells the referrer not to rely on a place the food bank may still reject', async () => {
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
    //
    // This is deliberately more cautious than what the session does — the
    // referral is already holding its place and is picked for, and a household
    // who turns up anyway is served. Both are intended; see the comment at this
    // notice. So the assertion is on the referrer's advice staying put, and it
    // must not be "fixed" to match the operational side.
    expect(screen.getByText(/Nobody should turn up to a session until/)).toBeInTheDocument();
  });

  /**
   * A refusal from the food bank, as one of the five it makes: the session
   * full, cancelled or already signed off, the 16:00 cutoff passed, or the
   * session's delivery places gone. All five arrive as a `409` carrying
   * `code: "CONFLICT"`, two of them with `details` and the rest separated by
   * free text alone — so these tests assert the *recovery*, which is identical
   * for every one of them, and never that the form named a cause it must not
   * try to identify.
   *
   * **The sentences are the food bank's own**, copied from `openapi.yaml`'s
   * examples for this endpoint rather than invented here. A fixture that
   * paraphrased them would prove the screen renders *something*, not that it
   * renders what a referrer actually reads.
   */
  function refuses(message: string) {
    return http.post(SUBMIT, () =>
      HttpResponse.json({ error: { code: 'CONFLICT', message, requestId: 'r1' } }, { status: 409 }),
    );
  }

  /** A delivery refusal, which is the only one that carries `deliveryCapacity`. */
  function refusesDelivery() {
    return http.post(SUBMIT, () =>
      HttpResponse.json(
        {
          error: {
            code: 'CONFLICT',
            message: 'Delivery places for that session are full',
            details: { deliveryCapacity: 8, booked: 8 },
            requestId: 'r1',
          },
        },
        { status: 409 },
      ),
    );
  }

  /** Page one, filled in and asking for a delivery, with both confirmations ticked. */
  async function askForDelivery(user: ReturnType<typeof userEvent.setup>) {
    await fillPageOne(user);
    await user.selectOptions(
      screen.getByRole('combobox', { name: /How will the parcel be collected/ }),
      'Delivery Requested',
    );
    for (const box of screen.getAllByRole('checkbox', { name: /^The client/ })) {
      await user.click(box);
    }
  }

  it('takes back the confirmation about the delivery window when the delivery is refused', async () => {
    /*
     * `screenDetails.md`: the session they pick next may quote a different
     * window, and a referrer must not be left having visibly confirmed a line
     * they were never shown.
     */
    server.use(refusesDelivery());
    renderRefer();
    const user = userEvent.setup();

    await askForDelivery(user);
    await sendFromPageOne(user);
    await screen.findByText('Page 1 of 7');

    expect(
      screen.getByRole('checkbox', { name: /at home for the delivery time/ }),
    ).not.toBeChecked();
  });

  it('leaves the confirmation about the household alone, which no session can make wrong', async () => {
    // The first tick is a fact about the household — that they meet the
    // criteria for delivery — true whichever session they are on. Making a
    // referrer re-answer it is how a form teaches people to tick without
    // reading.
    server.use(refusesDelivery());
    renderRefer();
    const user = userEvent.setup();

    await askForDelivery(user);
    await sendFromPageOne(user);
    await screen.findByText('Page 1 of 7');

    expect(screen.getByRole('checkbox', { name: /meets the criteria/ })).toBeChecked();
  });

  it('holds the referrer on page one until they confirm the new window', async () => {
    // Half a confirmation is not a confirmation: the question takes both or
    // the form does not move on, so the reset is what makes them look at the
    // delivery line again rather than a courtesy they can click past.
    server.use(refusesDelivery());
    renderRefer();
    const user = userEvent.setup();

    await askForDelivery(user);
    await sendFromPageOne(user);
    await screen.findByText('Page 1 of 7');

    await user.click(next());
    expect(screen.getByText('Page 1 of 7')).toBeInTheDocument();
  });

  it('leaves both confirmations alone when the refusal was not about the delivery', async () => {
    // A full, cancelled or confirmed session, or one past its cutoff, delivers
    // on exactly the hours it always did. Clearing the tick there would make
    // somebody re-answer something that never changed.
    server.use(refuses('That session is full'));
    renderRefer();
    const user = userEvent.setup();

    await askForDelivery(user);
    await sendFromPageOne(user);
    await screen.findByText('Page 1 of 7');

    for (const box of screen.getAllByRole('checkbox', { name: /^The client/ })) {
      expect(box).toBeChecked();
    }
  });

  it('puts a refused referrer back on page one, where the answers to change are', async () => {
    server.use(refuses('Delivery places for that session are full'));
    renderRefer();

    await submitTheForm(userEvent.setup());

    // Page one, not page seven, and not a dead end.
    expect(await screen.findByText('Page 1 of 7')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Referrer and client details' }),
    ).toBeInTheDocument();

    // The food bank's own sentence, and nothing this form invented about a
    // cause it cannot tell apart from the other two.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Delivery places for that session are full',
    );
  });

  it('keeps every answer a refused referrer typed, on page one and beyond', async () => {
    // The failure this prevents: somebody who has filled in seven pages
    // believing they have lost the lot. The refusal is a race, not a mistake.
    server.use(refuses('That session is full'));
    renderRefer();
    const user = userEvent.setup();

    await submitTheForm(user);
    await screen.findByText('Page 1 of 7');

    expect(screen.getByLabelText(/Client's surname/)).toHaveValue('Rowe');
    expect(screen.getByLabelText(/Referrer's name/)).toHaveValue('Sam Referrer');

    // And the later pages too, not merely the one they were returned to.
    await user.click(next());
    await screen.findByText('Page 2 of 7');
    expect(screen.getByLabelText('Oven')).toBeChecked();
  });

  it('does not carry the refusal onto the pages after the one it sent them to', async () => {
    // "That session is full" on the page about pet food reads as a form that
    // has broken. The notice belongs to page one, where the answer it is about
    // is given, and to nothing after it.
    server.use(refuses('That session is full'));
    renderRefer();
    const user = userEvent.setup();

    await submitTheForm(user);
    await screen.findByText('Page 1 of 7');
    expect(screen.getByRole('alert')).toHaveTextContent('That session is full');

    await user.click(next());

    await screen.findByText('Page 2 of 7');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('fetches the sessions again, so the same refused choice cannot be sent twice', async () => {
    const lists = vi.fn();
    server.use(
      http.get(SESSIONS, () => {
        lists();
        return HttpResponse.json({ sessions: [TUESDAY, THURSDAY] });
      }),
      refuses('That session is full'),
    );
    renderRefer();

    await submitTheForm(userEvent.setup());
    await screen.findByText('Page 1 of 7');

    // Once on load, once on the refusal. A session that has just filled is
    // gone from the list by the time the referrer looks at it.
    await waitFor(() => {
      expect(lists).toHaveBeenCalledTimes(2);
    });
  });

  it('clears the chosen session when the refusal has taken it off the list', async () => {
    /*
     * The trap this exists for: the session question is a controlled `<select>`
     * with an explicit empty option, so an id no longer among the options
     * renders as an *empty box the form still holds as answered*. The referrer
     * would see nothing wrong, press send, and be refused a second time for a
     * session they can no longer see.
     */
    let listed = [TUESDAY, THURSDAY];
    server.use(
      http.get(SESSIONS, () => HttpResponse.json({ sessions: listed })),
      http.post(SUBMIT, () => {
        listed = [THURSDAY];
        return HttpResponse.json(
          { error: { code: 'CONFLICT', message: 'That session is full', requestId: 'r1' } },
          { status: 409 },
        );
      }),
    );
    renderRefer();

    await submitTheForm(userEvent.setup());
    await screen.findByText('Page 1 of 7');

    const chosen = screen.getByRole('combobox', { name: /Session date/ });
    await waitFor(() => {
      expect(chosen).toHaveValue('');
    });
    // Gone as an option too, so it cannot simply be picked again.
    expect(within(chosen).queryByRole('option', { name: /4 Aug 2026/ })).toBeNull();
  });

  it('never clears an answer under a page the referrer has already moved past', async () => {
    /*
     * The refetch is a round trip, and somebody on a hall's wifi can press Next
     * through the pages they have already filled in before it lands. Clearing
     * the session then would punch a hole in a page the form validated a page
     * at a time and will not validate again — the submission would fail as a
     * *missing field*, which the screen reports as "a fault at our end" and
     * never clears. A second refusal is recoverable; that dead end is not.
     *
     * The **second** GET is the one held open: the first has to arrive for the
     * form to render at all, and holding both would prove nothing.
     */
    const recoveryFetch = deferred();
    let listed = [TUESDAY, THURSDAY];
    let lists = 0;
    server.use(
      http.get(SESSIONS, async () => {
        lists += 1;
        if (lists > 1) await recoveryFetch.promise;
        return HttpResponse.json({ sessions: listed });
      }),
      http.post(SUBMIT, () => {
        listed = [THURSDAY];
        return HttpResponse.json(
          { error: { code: 'CONFLICT', message: 'That session is full', requestId: 'r1' } },
          { status: 409 },
        );
      }),
    );
    renderRefer();
    const user = userEvent.setup();

    await submitTheForm(user);
    await screen.findByText('Page 1 of 7');

    // Forward again while the recovery's refetch is still in flight.
    await user.click(next());
    await screen.findByText('Page 2 of 7');

    // Only now does the list come back, saying their session has gone.
    recoveryFetch.resolve();
    await settle();

    /*
     * The answer is left alone, so no hole opens in the page behind them.
     * Asserted by walking page one again rather than by reading the box: the
     * box renders empty either way, the chosen session having left the options,
     * and that is precisely the trap. What separates the two is whether page
     * one still validates — a cleared answer would hold them there.
     */
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByText('Page 1 of 7');
    await user.click(next());
    expect(await screen.findByText('Page 2 of 7')).toBeInTheDocument();
    expect(screen.queryByText(/fault at our end/)).toBeNull();
  });

  it('leaves the chosen session alone when the refusal was not about it', async () => {
    // A cutoff refusal takes nothing off the list. Clearing the answer anyway
    // would make a referrer re-pick the session they had already chosen
    // correctly, for no reason they could see.
    server.use(refuses('Referrals for that session have closed'));
    renderRefer();

    await submitTheForm(userEvent.setup());
    await screen.findByText('Page 1 of 7');

    await settle();
    expect(screen.getByRole('combobox', { name: /Session date/ })).toHaveValue('s-tue');
  });

  it('refuses a second submission while the first is still in flight', async () => {
    /*
     * The one unauthenticated write in the system, and the one whose duplicate
     * books a household onto a session twice and takes two places off it. The
     * Send button is `aria-disabled` rather than `disabled` on purpose —
     * `.claude/rules/data-fetching.md` — so a real double tap still reaches the
     * handler, and it is the handler that has to refuse it.
     */
    const posts = vi.fn();
    const held = deferred();
    server.use(
      http.post(SUBMIT, async () => {
        posts();
        await held.promise;
        return HttpResponse.json(receipt('active'), { status: 201 });
      }),
    );
    renderRefer();
    const user = userEvent.setup();

    await submitTheForm(user);
    await user.click(screen.getByRole('button', { name: 'Send this referral' }));

    held.resolve();
    await screen.findByRole('heading', { name: 'Referral sent' });
    expect(posts).toHaveBeenCalledTimes(1);
  });

  it('refuses a second submission after the referrer has wandered off and back during the first', async () => {
    // Page seven carries a Back button beside Send, so "let me just check
    // something" is an ordinary thing to do while the request is in flight —
    // and it must not re-arm the send.
    const posts = vi.fn();
    const held = deferred();
    server.use(
      http.post(SUBMIT, async () => {
        posts();
        await held.promise;
        return HttpResponse.json(receipt('active'), { status: 201 });
      }),
    );
    renderRefer();
    const user = userEvent.setup();

    await submitTheForm(user);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByText('Page 6 of 7');
    await user.click(next());
    await screen.findByText('Page 7 of 7');
    await user.click(screen.getByRole('button', { name: 'Send this referral' }));

    held.resolve();
    await screen.findByRole('heading', { name: 'Referral sent' });
    expect(posts).toHaveBeenCalledTimes(1);
  });

  it('says a referral may have landed when the food bank never answered, and refuses to send it again', async () => {
    /*
     * Only a `4xx` proves nothing was written. A `500` or a dropped connection
     * may well have booked the household, so the lock stays on — and a button
     * that looks live and silently swallows the click is indistinguishable
     * from a broken form, which is why this says so instead.
     */
    const posts = vi.fn();
    server.use(
      http.post(SUBMIT, () => {
        posts();
        return HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.', requestId: 'r1' } },
          { status: 500 },
        );
      }),
    );
    renderRefer();
    const user = userEvent.setup();

    await submitTheForm(user);

    expect(
      await screen.findByText(/may or may not have reached the food bank/),
    ).toBeInTheDocument();
    expect(screen.getByText(/phone the food bank to check/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'FAILED!!' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send this referral' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Send this referral' })).toHaveAccessibleDescription(
      /do not send it again/i,
    );

    await user.click(screen.getByRole('button', { name: 'Send this referral' }));
    await settle();
    expect(posts).toHaveBeenCalledTimes(1);
  });

  it('lets a refused referral be sent again once its answers are corrected', async () => {
    // The other side of the lock: a `4xx` says the food bank wrote nothing, so
    // the referrer must be able to fix the session and send. A lock that never
    // released would turn every refusal into a dead end.
    const posts = vi.fn();
    let refuse = true;
    server.use(
      http.post(SUBMIT, () => {
        posts();
        if (!refuse) return HttpResponse.json(receipt('active'), { status: 201 });
        refuse = false;
        return HttpResponse.json(
          { error: { code: 'CONFLICT', message: 'That session is full', requestId: 'r1' } },
          { status: 409 },
        );
      }),
    );
    renderRefer();
    const user = userEvent.setup();

    await submitTheForm(user);
    await screen.findByText('Page 1 of 7');

    await user.selectOptions(screen.getByRole('combobox', { name: /Session date/ }), 's-thu');
    await sendFromPageOne(user);

    expect(await screen.findByRole('heading', { name: 'Referral sent' })).toBeInTheDocument();
    expect(posts).toHaveBeenCalledTimes(2);
  });

  it('never retries a failed submission, because a referral is not idempotent', async () => {
    const posts = vi.fn();
    server.use(
      http.post(SUBMIT, () => {
        posts();
        return HttpResponse.json(
          { error: { code: 'CONFLICT', message: 'That session is full', requestId: 'r1' } },
          { status: 409 },
        );
      }),
    );
    renderRefer();

    await submitTheForm(userEvent.setup());

    // The `409` message is written to be shown — "the session is full" is the
    // one useful sentence, and a generic apology throws it away.
    expect(await screen.findByRole('heading', { name: 'FAILED!!' })).toBeInTheDocument();
    expect(
      screen.getByText('This client could not be referred for the selected session'),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Reason: That session is full');
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
