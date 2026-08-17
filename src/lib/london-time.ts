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
 * Pure, and directly tested.
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

/** `4 Aug 1975`. Pinned to UTC for the same reason as `sessionDateFormat`. */
const calendarDateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** `2026-08-05` — London's calendar day, not the device's. See `londonToday`. */
const isoDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: LONDON,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * `2026-08-05` again, but pinned to UTC — for turning a calendar date that was
 * parsed to its UTC midnight back into a string. Formatting one of those in
 * London is safe only by the accident that London is never behind UTC, which is
 * the accident `formatSessionDate` refuses to rely on.
 */
const isoDateInUtc = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
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
  const parsed = parseCalendarDate(date);
  return parsed === null ? date : sessionDateFormat.format(parsed);
}

/** `4 Aug 1975`. A calendar date with no weekday — a date of birth is not a day anybody turns up on. */
export function formatCalendarDate(date: string): string {
  const parsed = parseCalendarDate(date);
  return parsed === null ? date : calendarDateFormat.format(parsed);
}

/**
 * A `YYYY-MM-DD` calendar date as the instant of its midnight **UTC**, or
 * `null` if it is not a real date. Never a local midnight: see
 * `formatSessionDate` for why every calendar date in this file is pinned to
 * UTC and formatted there.
 */
export function parseCalendarDate(date: string): Date | null {
  const parts = CALENDAR_DATE.exec(date);
  if (parts === null) return null;

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);

  const parsed = new Date(Date.UTC(year, month - 1, day));

  /*
   * `Date.UTC` rolls over rather than refusing — the 31st of February is the 3rd
   * of March, and month 99 is eight years later — so the only way to tell a real
   * date from a malformed one is to ask the result what it thinks it is. A
   * mismatch is reported as unparseable, the same as anything else: what
   * arrived is diagnosable, a silently shifted date is not.
   */
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

/** Whether `date` is a real `YYYY-MM-DD` calendar date. */
export function isCalendarDate(date: string): boolean {
  return parseCalendarDate(date) !== null;
}

/**
 * A calendar date shifted by whole days, as `YYYY-MM-DD`. Negative goes back.
 *
 * **Days, not hours, and that is the whole point.** Adding `n * 86_400_000`
 * milliseconds to a local instant lands an hour out either side of a clock
 * change; here both ends are pinned to UTC midnight — where a day is always
 * exactly twenty-four hours — so "a fortnight before the 30th of March" is the
 * 16th of March whatever BST is doing. `parseCalendarDate` is what pins it, and
 * `Date.UTC` rolling over month and year ends is the behaviour wanted rather
 * than something to guard against.
 *
 * Returns the input unchanged when it will not parse — the same "show what
 * arrived" rule as the rest of this file.
 */
export function addCalendarDays(date: string, days: number): string {
  const parsed = parseCalendarDate(date);
  if (parsed === null) return date;

  const shifted = new Date(parsed);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return isoDateInUtc.format(shifted);
}

/**
 * Today in London, as `YYYY-MM-DD`.
 *
 * Needed because "is this date of birth in the future?" is a question about the
 * charity's day, not the device's. A volunteer whose laptop is set to Los
 * Angeles is eight hours behind for part of every evening, and a form that
 * rejects a baby born this morning because of that is a bug nobody would
 * reproduce.
 */
export function londonToday(): string {
  // `en-CA` formats as `YYYY-MM-DD`, which is the one thing `Intl` will produce
  // in that shape without reassembling parts by hand.
  return isoDateFormat.format(new Date());
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

const LOCAL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * `startTime` plus `durationMinutes`, as `10:00–11:30`.
 *
 * **No `Date` involved, and that is what makes this safe.** `startTime` is a
 * wall-clock string with no date attached, so the only correct way to add a
 * duration to it is minutes-of-day arithmetic wrapping at 1440 — never
 * `new Date(...)`, which would need a date to anchor to and would drag the BST
 * changeover back into a calculation that has nothing to do with it. A session
 * starting at `23:00` for 120 minutes ends at `01:00`, on the next calendar day,
 * and this deliberately says nothing about *which* day — that is what
 * `sessionDate` is for, and this function is never given one.
 *
 * Returns `startTime` alone, unchanged, when it will not parse — the same
 * "show what arrived" rule as the rest of this file.
 */
export function formatTimeRange(startTime: string, durationMinutes: number): string {
  const parts = LOCAL_TIME.exec(startTime);
  if (parts === null) return startTime;

  const hours = Number(parts[1]);
  const minutes = Number(parts[2]);

  const MINUTES_PER_DAY = 24 * 60;
  const endTotal =
    (((hours * 60 + minutes + durationMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) %
    MINUTES_PER_DAY;
  const endHours = Math.floor(endTotal / 60);
  const endMinutes = endTotal % 60;

  return `${startTime}–${pad(endHours)}:${pad(endMinutes)}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}
