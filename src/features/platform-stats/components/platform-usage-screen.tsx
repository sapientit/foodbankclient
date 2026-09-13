import { useId, useState } from 'react';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { formatCalendarDate } from '../../../lib/london-time';
import type { PlatformStatsDay } from '../queries';
import { usePlatformUsage } from '../queries';
import { defaultPlatformUsageRange, platformUsageRangeError } from '../platform-stats.logic';
import styles from './platform-usage-screen.module.css';

const UTC_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
interface DisplayMeasure {
  readonly key: keyof Omit<PlatformStatsDay, 'date'>;
  readonly name: string;
  readonly format: (value: number) => string;
}
const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const MEASURES: readonly DisplayMeasure[] = [
  {
    key: 'workerRequestsAccountWide',
    name: 'Worker requests (account-wide)',
    format: (value) => number.format(value),
  },
  {
    key: 'workerRequestsThisApp',
    name: 'Worker requests (this app)',
    format: (value) => number.format(value),
  },
  {
    key: 'workerErrorsThisApp',
    name: 'Worker errors (this app)',
    format: (value) => number.format(value),
  },
  {
    key: 'workerCpuTimeP99Us',
    name: 'Worker CPU time p99 (µs)',
    format: (value) => number.format(value),
  },
  {
    key: 'workerSubrequestsAvgPerInvocation',
    name: 'Worker subrequests average per invocation',
    format: (value) => number.format(value),
  },
  {
    key: 'workerWallTimeP99Ms',
    name: 'Worker wall time p99 (ms)',
    format: (value) => number.format(value),
  },
  { key: 'd1RowsRead', name: 'D1 rows read', format: (value) => number.format(value) },
  { key: 'd1RowsWritten', name: 'D1 rows written', format: (value) => number.format(value) },
  { key: 'd1StorageBytes', name: 'D1 storage (bytes)', format: (value) => number.format(value) },
];

function utcToday(): string {
  return UTC_DATE.format(new Date());
}
function hasExceededThreshold(day: PlatformStatsDay): boolean {
  return MEASURES.some((measure) => {
    const value = day[measure.key];
    return 'exceeded' in value && value.exceeded;
  });
}

export function PlatformUsageScreen() {
  const [range, setRange] = useState(() => defaultPlatformUsageRange(utcToday()));
  const error = platformUsageRangeError(range);
  const usage = usePlatformUsage(range.from, range.to, error === null);
  const fromId = useId();
  const toId = useId();
  const errorId = useId();
  return (
    <main>
      <PageHeader title="Cloudflare statistics" />
      <p>Daily Worker and D1 usage against the current Cloudflare thresholds.</p>
      <fieldset className={styles.range}>
        <legend>Date range</legend>
        <label className={styles.field} htmlFor={fromId}>
          From
          <input
            aria-describedby={error === null ? undefined : errorId}
            id={fromId}
            max={range.to}
            onChange={(event) => {
              setRange((current) => ({ ...current, from: event.target.value }));
            }}
            type="date"
            value={range.from}
          />
        </label>
        <label className={styles.field} htmlFor={toId}>
          To
          <input
            aria-describedby={error === null ? undefined : errorId}
            id={toId}
            min={range.from}
            onChange={(event) => {
              setRange((current) => ({ ...current, to: event.target.value }));
            }}
            type="date"
            value={range.to}
          />
        </label>
        {error !== null && (
          <p className={styles.error} id={errorId} role="alert">
            {error}
          </p>
        )}
      </fieldset>
      {error === null && <UsageResults from={range.from} to={range.to} usage={usage} />}
    </main>
  );
}

function UsageResults({
  from,
  to,
  usage,
}: {
  readonly from: string;
  readonly to: string;
  readonly usage: ReturnType<typeof usePlatformUsage>;
}) {
  if (usage.isPending) return <Spinner label="Loading Cloudflare statistics…" />;
  if (usage.isError)
    return <ErrorNotice error={usage.error} onRetry={() => void usage.refetch()} />;
  const days = usage.data.days ?? [];
  if (days.length === 0)
    return (
      <EmptyState
        headline="No Cloudflare usage captured"
        sentence={`No usage was captured from ${formatCalendarDate(from)} to ${formatCalendarDate(to)}.`}
      />
    );
  return (
    <section aria-labelledby="usage-days-heading">
      <h2 id="usage-days-heading">Daily status</h2>
      <ul className={styles.days}>
        {days.map((day) => (
          <UsageDay day={day} key={day.date} />
        ))}
      </ul>
    </section>
  );
}

function UsageDay({ day }: { readonly day: PlatformStatsDay }) {
  const [expanded, setExpanded] = useState(false);
  const exceeded = hasExceededThreshold(day);
  const status = exceeded ? 'Something exceeded' : 'All OK';
  const panelId = `platform-usage-${day.date}`;
  return (
    <li className={styles.day}>
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        className={styles.dayButton}
        onClick={() => {
          setExpanded((current) => !current);
        }}
        type="button"
      >
        <span>{formatCalendarDate(day.date)}</span>
        <span className={exceeded ? styles.statusExceeded : styles.statusOk}>{status}</span>
      </button>
      {expanded && (
        <div className={styles.details} id={panelId}>
          <div
            aria-label={`Cloudflare usage table for ${formatCalendarDate(day.date)}`}
            className={styles.tableScroll}
          >
            <table>
              <caption>Cloudflare usage for {formatCalendarDate(day.date)}</caption>
              <thead>
                <tr>
                  <th scope="col">Criterion</th>
                  <th scope="col">Value</th>
                  <th scope="col">Cap</th>
                  <th scope="col">Threshold</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {MEASURES.map((measure) => {
                  const value = day[measure.key];
                  const flagged = 'exceeded' in value && value.exceeded;
                  const checked = 'threshold' in value;
                  return (
                    <tr className={flagged ? styles.exceeded : undefined} key={measure.key}>
                      <th scope="row">{measure.name}</th>
                      <td>{measure.format(value.value)}</td>
                      <td>{'cap' in value ? measure.format(value.cap) : 'No cap'}</td>
                      <td>{checked ? measure.format(value.threshold) : 'No threshold'}</td>
                      <td>{checked ? (flagged ? 'Exceeded' : 'All OK') : 'Informational'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </li>
  );
}
