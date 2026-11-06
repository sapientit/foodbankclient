import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { isNewClientsAssigned } from '../../../lib/errors';
import { usePublicReferralFormDefinition, useReferralOptionSources } from '../../referrals/queries';
import { useSession } from '../../sessions/queries';
import {
  listenerColumns,
  listenerColumnsNeedReferralReasons,
  listenerColumnValue,
  listenerFirstTimeOrVoucherText,
} from '../listener-sheet.logic';
import { useGenerateMissingPickLists, useListenerSheet } from '../queries';
import { isSessionReadOnly } from '../run-session.logic';
import styles from './listener-sheet-screen.module.css';

/**
 * The listener sheet is intentionally separate from the picking sheet. It is
 * the only printed surface that may show a referral reason, and its dedicated
 * API response is the boundary that keeps every other referral field out.
 *
 * **What it shows is chosen by the referral form**, through the
 * `forListenerSheet` marker — see `listener-sheet.logic.ts`. The charity decides
 * what a listener needs by marking the questionnaire; this screen holds no list
 * of its own, because the one it used to hold named a question the form had
 * since renamed, and the column read "None given" on every sheet.
 *
 * **Columns come from the currently active release, not each household's
 * own.** A session mixing households from more than one release is possible
 * but rare, and Pete settled on 2026-09-26 that this one shared table shows
 * only what the current release marks — a household referred under an older
 * release simply does not surface its own marked answers here, rather than
 * the table growing a column for every release that has ever applied to
 * somebody on this session.
 */
export function ListenerSheetScreen() {
  const { sessionId = '' } = useParams();
  // Keyed so that "already tried to generate" belongs to one session, not to
  // whichever session this route happens to be showing.
  return <SessionListenerSheet key={sessionId} sessionId={sessionId} />;
}

function SessionListenerSheet({ sessionId }: { readonly sessionId: string }) {
  const session = useSession(sessionId);
  const sheet = useListenerSheet(sessionId);
  const generate = useGenerateMissingPickLists();
  const form = usePublicReferralFormDefinition();
  const columns = form.data === undefined ? [] : listenerColumns(form.data.definition);

  // The reason lookup, because a question choosing from it stores an id.
  const needsReasons = listenerColumnsNeedReferralReasons(columns);
  const reasons = useReferralOptionSources(needsReasons);

  /*
   * The sheet is refused while any household on it has no pick number: somebody
   * referred or moved here since the pick lists were made. Generating is
   * idempotent and leaves existing parcels alone, so it happens without asking.
   *
   * **Once by itself, never in a loop.** The ref is set before the request, so
   * nothing can start a second attempt that would answer `parcelsCreated: 0`. A
   * second refusal — another client arriving in the same moment — is put in
   * front of the person, whose "Try again" is the only thing that asks again. A
   * finished session is read, never reconciled: `POST` on a confirmed list
   * answers `200` having created nothing.
   */
  const newClientsAssigned = isNewClientsAssigned(sheet.error);
  const closed = session.data !== undefined && isSessionReadOnly(session.data.status);
  const canGenerate = session.data !== undefined && !closed;
  const attempted = useRef(false);
  const [retrying, setRetrying] = useState(false);
  // Added up, because each attempt reports only what it created itself and the
  // print-again warning has to cover all of them.
  const [parcelsCreated, setParcelsCreated] = useState(0);
  const { mutate } = generate;
  const generatePickLists = useCallback(() => {
    mutate(sessionId, {
      onSuccess: (result) => {
        setParcelsCreated((total) => total + (result.parcelsCreated ?? 0));
      },
    });
  }, [mutate, sessionId]);
  useEffect(() => {
    if (newClientsAssigned && canGenerate && !sheet.isFetching && !attempted.current) {
      attempted.current = true;
      generatePickLists();
    }
  }, [canGenerate, generatePickLists, newClientsAssigned, sheet.isFetching]);

  // Only the automatic attempt takes over the screen. Pressing "Try again" leaves
  // the notice standing, so the button keeps keyboard focus.
  if (newClientsAssigned && !closed && (generate.isIdle || (generate.isPending && !retrying)))
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Listener sheet" />
        </div>
        <Spinner label="Creating pick lists for new clients…" />
      </div>
    );
  if (sheet.isPending)
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Listener sheet" />
        </div>
        <Spinner label="Loading the listener sheet…" />
      </div>
    );
  if (sheet.isError) {
    if (isNewClientsAssigned(sheet.error))
      return (
        <div className={styles.page}>
          <div className={styles.headerCard}>
            <PageHeader title="Listener sheet" />
          </div>
          <section className={styles.newClientsAssigned}>
            <h2>New clients assigned</h2>
            {closed ? (
              <div role="alert">
                <p>{sheet.error.message}</p>
                <p>This session is closed, so no pick lists can be added to it.</p>
              </div>
            ) : generate.isError ? (
              <>
                <p>
                  The listener sheet needs a pick number for every client, and the new clients’ pick
                  lists could not be created.
                </p>
                <ErrorNotice error={generate.error} />
              </>
            ) : (
              <p role="alert">{sheet.error.message}</p>
            )}
            {/* Its own button, because `ErrorNotice` rightly offers none on a
                `409` or `422` — but here an administrator completing the grid is
                exactly what makes the same request succeed. Outside the branches
                above so it stays the same element, and keeps focus, throughout. */}
            {!closed && (
              <button
                aria-busy={generate.isPending}
                aria-disabled={generate.isPending}
                onClick={() => {
                  if (generate.isPending) return;
                  setRetrying(true);
                  generatePickLists();
                }}
                type="button"
              >
                {generate.isPending ? 'Trying again…' : 'Try again'}
              </button>
            )}
          </section>
        </div>
      );
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Listener sheet" />
        </div>
        <ErrorNotice error={sheet.error} onRetry={() => void sheet.refetch()} />
      </div>
    );
  }
  if (form.isPending || reasons.isPending)
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Listener sheet" />
        </div>
        <Spinner label="Loading the listener sheet…" />
      </div>
    );
  if (form.isError)
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Listener sheet" />
        </div>
        <ErrorNotice
          error={form.error}
          onRetry={() => {
            void form.refetch();
          }}
        />
      </div>
    );
  // Held back rather than printed with an identifier where a cause of crisis
  // should be: a listener reads this sheet aloud to a household.
  if (reasons.isError)
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Listener sheet" />
        </div>
        <ErrorNotice error={reasons.error} onRetry={() => void reasons.refetch()} />
      </div>
    );

  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader
          title="Listener sheet"
          action={
            <button
              onClick={() => {
                window.print();
              }}
              type="button"
            >
              Print listener sheet
            </button>
          }
        />
      </div>
      <section aria-label="Listener sheet details" className={styles.detailsCard}>
        {/* Said here because it is said nowhere else: the Clients tab's own
            reconciliation will now find nothing left to create. */}
        {parcelsCreated > 0 && (
          <p className={styles.screenOnly} role="status">
            {parcelsCreated} new pick list{parcelsCreated === 1 ? '' : 's'}{' '}
            {generate.data?.firstPrintedAt === null
              ? 'created.'
              : `created — print the pick lists again to include ${parcelsCreated === 1 ? 'it' : 'them'}.`}
          </p>
        )}
        <p className={styles.screenOnly}>
          This sensitive sheet is for the selected listeners only. It lists non-delivery households
          on this session.
        </p>
        <p className={styles.confidentialNotice}>
          Confidential: this sheet is for the selected listeners only. Destroy it after use.
        </p>
        {sheet.data.households.length === 0 ? (
          <p>No non-delivery households are on this session.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Pick number</th>
                {columns.map((column) => (
                  <th key={column.key} scope="col">
                    {column.label}
                  </th>
                ))}
                <th scope="col">First time / voucher</th>
              </tr>
            </thead>
            <tbody>
              {sheet.data.households.map((household) => (
                <tr key={household.referralId}>
                  <td>#{household.pickNumber}</td>
                  {columns.map((column, index) => {
                    const value = listenerColumnValue(column, household, reasons.sources);
                    // The first column heads its row: a listener finds a household
                    // by whatever the form puts first, which is their name.
                    return index === 0 ? (
                      <th key={column.key} scope="row">
                        {value}
                      </th>
                    ) : (
                      <td key={column.key}>{value}</td>
                    );
                  })}
                  <td>{listenerFirstTimeOrVoucherText(household)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
