/**
 * Every date and time this app puts on a screen is Europe/London wall clock.
 *
 * Volunteers use their own phones and laptops, and at least one of them has the
 * wrong timezone set. `toLocaleDateString` and friends would format in whatever
 * that device believes, silently — a session at 10:00 shown as 05:00 with no
 * error anywhere. The eslint rule banning them outside this file is what makes
 * that impossible to write; pinning `timeZone` here is what makes this file safe
 * to be the exception.
 *
 * Pure, and directly tested. **This is deliberately not yet the whole module.**
 * The sessions slice adds the wall-clock helpers it needs — `formatTimeRange`
 * over `startTime` plus `durationMinutes`, which has to be right past midnight —
 * and they belong here beside these three rather than anywhere else.
 *
 * Note the split between the two kinds of value the API sends. `createdAt` and
 * `startsAtUtc` are **instants**, formatted in London. `sessionDate` is a
 * **calendar date** with no instant attached, and `startTime` is a wall clock
 * string that is never parsed at all.
 */

const LONDON = 'Europe/London';

/** `6 Jul 2026`. Short month, because these live in table cells. */
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** `6 Jul 2026, 14:05`. 24-hour: a food bank runs on a 24-hour clock and it is shorter. */
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * `Tue, 4 Aug 2026`. The weekday earns its place: a referrer picking a session
 * chooses by "Tuesday", not by the fourth.
 *
 * **Pinned to UTC, and that is not a slip.** See `formatSessionDate`.
 */
const sessionDateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** An instant from the API — `createdAt`, `lastLoginAt` — as a London date. */
export function formatLondonDate(instant: string): string {
  return format(dateFormat, instant);
}

/** The same, with the time, for when "which day" is not enough. */
export function formatLondonDateTime(instant: string): string {
  return format(dateTimeFormat, instant);
}

/**
 * A session's `sessionDate` — `"2026-08-04"` — as `Tue, 4 Aug 2026`.
 *
 * **A calendar date is not an instant, and this is the only correct way to show
 * one.** `new Date('2026-08-04')` is midnight *UTC*, so formatting it in any
 * zone west of Greenwich moves the session to the day before. Formatting it in
 * London happens to be safe today, but only by the accident that London is never
 * behind UTC — the rule stops holding the moment somebody reuses the helper.
 * Parsing the three numbers and pinning the formatter to UTC keeps the day the
 * charity typed, on every device, whatever it believes the time is.
 *
 * The wall-clock time beside it is `startTime`, printed exactly as it arrived.
 * There is nothing to format there and nothing may reconstruct it.
 */
export function formatSessionDate(date: string): string {
  const parts = CALENDAR_DATE.exec(date);
  if (parts === null) return date;

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);

  const parsed = new Date(Date.UTC(year, month - 1, day));

  /*
   * `Date.UTC` rolls over rather than refusing — the 31st of February is the 3rd
   * of March, and month 99 is eight years later — so the only way to tell a real
   * date from a malformed one is to ask the result what it thinks it is. A
   * mismatch shows the raw value, the same as anything else unparseable: what
   * arrived is diagnosable, a silently shifted date is not.
   */
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return date;
  }

  return sessionDateFormat.format(parsed);
}

/**
 * Returns the raw value when it will not parse, rather than the string
 * `Invalid Date`. A timestamp the client cannot read is a server or clock
 * problem, and showing what actually arrived is what makes it diagnosable —
 * these are never personal data.
 */
function format(formatter: Intl.DateTimeFormat, instant: string): string {
  const parsed = new Date(instant);
  return Number.isNaN(parsed.getTime()) ? instant : formatter.format(parsed);
}
