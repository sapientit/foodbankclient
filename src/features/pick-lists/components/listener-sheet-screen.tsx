import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { isNewClientsAssigned } from '../../../lib/errors';
import { referralKeys } from '../../referrals/keys';
import { fetchReferrals, useReferralOptionSources } from '../../referrals/queries';
import {
  listenerColumns,
  listenerColumnsNeedReferralReasons,
  listenerColumnValue,
} from '../listener-sheet.logic';
import { useListenerSheet } from '../queries';
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
 */
export function ListenerSheetScreen() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rebuildError, setRebuildError] = useState<unknown>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const sheet = useListenerSheet(sessionId);
  const columns = listenerColumns();

  // The reason lookup, because a question choosing from it stores an id.
  const needsReasons = listenerColumnsNeedReferralReasons(columns);
  const reasons = useReferralOptionSources(needsReasons);

  async function acknowledgeNewClients() {
    setRebuilding(true);
    setRebuildError(null);
    try {
      const filters = { sessionId };
      const queryKey = referralKeys.list(filters);
      // The conflict proves this tab may hold an apparently fresh but now old
      // referral list. Reconciliation must use a read made after acknowledgement.
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.fetchQuery({
        queryKey,
        queryFn: () => fetchReferrals(filters),
        staleTime: 0,
      });
      void navigate(`/run-sessions/${sessionId}`);
    } catch (error) {
      setRebuildError(error);
      setRebuilding(false);
    }
  }

  if (sheet.isPending)
    return (
      <>
        <PageHeader title="Listener sheet" />
        <Spinner label="Loading the listener sheet…" />
      </>
    );
  if (sheet.isError) {
    if (isNewClientsAssigned(sheet.error))
      return (
        <>
          <PageHeader title="Listener sheet" />
          <section className={styles.newClientsAssigned} role="alert">
            <h2>New clients assigned</h2>
            <p>{sheet.error.message}</p>
            <p>
              Return to the session to rebuild the client list, then select Listener sheet again.
            </p>
            {rebuildError === null ? (
              <button
                aria-busy={rebuilding}
                disabled={rebuilding}
                onClick={() => void acknowledgeNewClients()}
                type="button"
              >
                {rebuilding ? 'Rebuilding client list…' : 'Acknowledge and return to session'}
              </button>
            ) : (
              <ErrorNotice error={rebuildError} onRetry={() => void acknowledgeNewClients()} />
            )}
          </section>
        </>
      );
    return (
      <>
        <PageHeader title="Listener sheet" />
        <ErrorNotice error={sheet.error} onRetry={() => void sheet.refetch()} />
      </>
    );
  }
  if (reasons.isPending)
    return (
      <>
        <PageHeader title="Listener sheet" />
        <Spinner label="Loading the listener sheet…" />
      </>
    );
  // Held back rather than printed with an identifier where a cause of crisis
  // should be: a listener reads this sheet aloud to a household.
  if (reasons.isError)
    return (
      <>
        <PageHeader title="Listener sheet" />
        <ErrorNotice error={reasons.error} onRetry={() => void reasons.refetch()} />
      </>
    );

  return (
    <>
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
      <p className={styles.screenOnly}>
        This sensitive sheet is for the selected listeners only. It lists non-delivery households on
        this session.
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className={styles.screenOnly}>
        <Link to={`/run-sessions/${sessionId}`}>Back to session</Link>
      </p>
    </>
  );
}
