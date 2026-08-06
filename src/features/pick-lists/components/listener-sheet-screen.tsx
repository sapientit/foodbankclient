import { Link, useParams } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { useListenerSheet } from '../queries';
import styles from './listener-sheet-screen.module.css';

const CAUSE_DETAILS_KEY = 'Cause Details';

function causeDetails(answers: Record<string, unknown>): string | null {
  const answer = answers[CAUSE_DETAILS_KEY];
  return typeof answer === 'string' && answer.trim() !== '' ? answer : null;
}

/**
 * The listener sheet is intentionally separate from the picking sheet. It is
 * the only printed surface that may show a referral reason, and its dedicated
 * API response is the boundary that keeps every other referral field out.
 */
export function ListenerSheetScreen() {
  const { sessionId = '' } = useParams();
  const sheet = useListenerSheet(sessionId);

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
              <th scope="col">Name</th>
              <th scope="col">Reason for referral</th>
              <th scope="col">Cause Details</th>
              <th scope="col">Fuel help</th>
            </tr>
          </thead>
          <tbody>
            {sheet.data.households.map((household) => (
              <tr key={household.referralId}>
                <th scope="row">
                  {household.refereeFirstName ?? 'Unknown'} {household.refereeSurname ?? ''}
                </th>
                <td>{household.reason ?? 'Not available'}</td>
                <td>{causeDetails(household.answers) ?? 'None given'}</td>
                <td>{household.needsFuelHelp ? 'Yes' : 'No'}</td>
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
