import { useState } from 'react';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { copyHtmlToClipboard } from '../../../lib/clipboard';
import { formatSessionDate } from '../../../lib/london-time';
import {
  fuelColumns,
  fuelColumnsNeedOptionSources,
  fuelColumnValue,
  fuelCopyCells,
  fuelCopyHeadings,
  fuelCopyHtml,
  fuelCopyText,
  householdsToCopy,
} from '../fuel-help.logic';
import { usePublicReferralFormDefinition, useReferralOptionSources } from '../../referrals/queries';
import { useFuelHelpList } from '../queries';
import styles from './fuel-help-list-screen.module.css';

type CopyOutcome =
  | { readonly kind: 'copied'; readonly count: number }
  | { readonly kind: 'failed' }
  | { readonly kind: 'nothing-chosen' }
  | null;

function countHouseholds(count: number): string {
  return count === 1 ? '1 household' : `${String(count)} households`;
}

function copyStatus(outcome: CopyOutcome, toCopy: number, copyFrom: string | null): string {
  if (outcome?.kind === 'copied') {
    return `${countHouseholds(outcome.count)} copied. Paste them into Excel.`;
  }
  if (outcome?.kind === 'failed') {
    return 'Could not copy automatically. Select the rows in the table by hand and copy them, then check the phone numbers in Excel, because a leading zero can be lost.';
  }
  if (outcome?.kind === 'nothing-chosen') return 'Choose a session first.';
  return copyFrom !== null && toCopy > 0
    ? `From ${formatSessionDate(copyFrom)} to the newest session.`
    : '';
}

/**
 * A deliberately plain table: fuel work happens in a spreadsheet, and copying
 * rows intact is safer than retyping a phone number. The referral form decides
 * which columns fuel workers may see; unmarked answers never reach the DOM.
 *
 * **Columns come from the currently active release, not each household's
 * own** — the same choice, for the same reason, as the listener sheet: Pete
 * settled on 2026-09-26 that one shared table shows only what the current
 * release marks, rather than growing a column for every release anybody on
 * the list has ever been referred under.
 */
export function FuelHelpListScreen() {
  const list = useFuelHelpList();
  const form = usePublicReferralFormDefinition();
  // Deliberately forgotten on leaving the screen: where the team got to is what
  // their spreadsheet records, not this system.
  const [copyFrom, setCopyFrom] = useState<string | null>(null);
  // Starting unticked is a guess: OPEN-QUESTIONS.md Q55.
  const [includeHeadings, setIncludeHeadings] = useState(false);
  const [outcome, setOutcome] = useState<CopyOutcome>(null);
  const columns =
    form.data === undefined ? [] : fuelColumns(form.data.definition, list.data?.households ?? []);
  // Only where a marked question chooses from a lookup, which none do today:
  // its answer would otherwise be copied into the spreadsheet as an id.
  const reasons = useReferralOptionSources(fuelColumnsNeedOptionSources(columns));

  if (list.isPending || form.isPending || reasons.isPending) {
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Fuel help list" />
        </div>
        <Spinner label="Loading the fuel help list…" />
      </div>
    );
  }

  if (list.isError) {
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Fuel help list" />
        </div>
        <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />
      </div>
    );
  }

  if (form.isError) {
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Fuel help list" />
        </div>
        <ErrorNotice
          error={form.error}
          onRetry={() => {
            void form.refetch();
          }}
        />
      </div>
    );
  }

  if (reasons.isError) {
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Fuel help list" />
        </div>
        <ErrorNotice error={reasons.error} onRetry={() => void reasons.refetch()} />
      </div>
    );
  }

  const households = list.data.households;
  // The highlight and the copy read this one value, so they cannot disagree,
  // including after a refetch when somebody comes back from Excel.
  const toCopy = householdsToCopy(households, copyFrom);
  const copying = new Set(toCopy);

  const copy = async () => {
    // Cleared first so that copying again changes the status, and is announced.
    setOutcome(null);
    if (toCopy.length === 0) {
      setOutcome({ kind: 'nothing-chosen' });
      return;
    }
    const rows = fuelCopyCells(toCopy, columns, reasons.sources);
    const cells = includeHeadings ? [fuelCopyHeadings(columns), ...rows] : rows;
    const copied = await copyHtmlToClipboard(fuelCopyHtml(cells), fuelCopyText(cells));
    setOutcome(copied ? { kind: 'copied', count: toCopy.length } : { kind: 'failed' });
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader title="Fuel help list" />
      </div>
      {households.length === 0 ? (
        <p>No households currently need fuel follow-up.</p>
      ) : (
        <>
          <p className={styles.intro} id="fuel-copy-instruction">
            Choose the oldest session you still need. That session and every newer one are
            highlighted. Then copy them and paste them into Excel.
          </p>
          <div
            aria-label="Fuel help list"
            className={styles.tableWrap}
            role="region"
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The scrollable table needs a keyboard focus target.
            tabIndex={0}
          >
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Session date</th>
                  {columns.map((column) => (
                    <th key={column.key} scope="col">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {households.map((household, index) => {
                  const date = formatSessionDate(household.sessionDate);
                  const firstOfSession =
                    households[index - 1]?.sessionDate !== household.sessionDate;
                  return (
                    <tr
                      data-first-of-session={firstOfSession ? '' : undefined}
                      data-will-copy={copying.has(household) ? '' : undefined}
                      key={household.referralId}
                    >
                      <th scope="row">
                        {/* In the date's own cell, not a column of its own, so that
                            selecting the table by hand still copies clean columns. */}
                        {firstOfSession ? (
                          <label className={styles.copyFrom}>
                            <input
                              aria-describedby="fuel-copy-instruction"
                              checked={copyFrom === household.sessionDate}
                              name="fuel-copy-from"
                              onChange={() => {
                                setCopyFrom(household.sessionDate);
                                setOutcome(null);
                              }}
                              type="radio"
                            />
                            {date}
                          </label>
                        ) : (
                          <span className={styles.sessionContinues}>{date}</span>
                        )}
                      </th>
                      {columns.map((column) => {
                        const value = fuelColumnValue(column, household, reasons.sources);
                        return <td key={column.key}>{value}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.copyBar}>
            <button onClick={() => void copy()} type="button">
              {toCopy.length === 0 ? 'Copy households' : `Copy ${countHouseholds(toCopy.length)}`}
            </button>
            <label className={styles.headingsOption}>
              <input
                checked={includeHeadings}
                onChange={(event) => {
                  setIncludeHeadings(event.target.checked);
                  setOutcome(null);
                }}
                type="checkbox"
              />{' '}
              Include column headings
            </label>
            <p className={styles.copyStatus} role="status">
              {copyStatus(outcome, toCopy.length, copyFrom)}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
