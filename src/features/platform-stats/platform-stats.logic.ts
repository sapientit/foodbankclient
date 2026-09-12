import { addCalendarDays, isCalendarDate } from '../../lib/london-time';

export const MAX_PLATFORM_USAGE_DAYS = 50;
export const PLATFORM_USAGE_DEFAULT_DAYS = 14;

export interface PlatformUsageRange {
  readonly from: string;
  readonly to: string;
}

/** The inclusive, UTC calendar range the server's daily Cloudflare job uses. */
export function defaultPlatformUsageRange(todayUtc: string): PlatformUsageRange {
  return { from: addCalendarDays(todayUtc, -(PLATFORM_USAGE_DEFAULT_DAYS - 1)), to: todayUtc };
}

export function platformUsageRangeError({ from, to }: PlatformUsageRange): string | null {
  if (!isCalendarDate(from) || !isCalendarDate(to)) return 'Enter a valid start and end date.';
  if (to < from) return 'The end date must not be before the start date.';
  if (addCalendarDays(from, MAX_PLATFORM_USAGE_DAYS - 1) < to) {
    return 'Choose a date range of no more than 50 days.';
  }
  return null;
}
