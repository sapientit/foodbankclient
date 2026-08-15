import { Link, useParams } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { listenerColumns, listenerColumnValue } from '../listener-sheet.logic';
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
  const sheet = useListenerSheet(sessionId);
  const columns = listenerColumns();

  if (sheet.isPending)
    return (
      <>
        <PageHeader title="Listener sheet" />
        <Spinner label="Loading the listener sheet…" />
      </>
    );
  if (sheet.isError)
    return (
      <>
        <PageHeader title="Listener sheet" />
        <ErrorNotice error={sheet.error} onRetry={() => void sheet.refetch()} />
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
                {columns.map((column, index) => {
                  const value = listenerColumnValue(column, household);
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
