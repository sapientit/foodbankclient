import { useParams } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { formatSessionDate } from '../../../lib/london-time';
import { useSessionReferralDetails } from '../queries';
import styles from './session-referral-details-screen.module.css';

export function SessionReferralDetailsScreen() {
  const { sessionId = '' } = useParams();
  const details = useSessionReferralDetails(sessionId);
  if (details.isPending) return <Spinner label="Loading referral details…" />;
  if (details.isError)
    return (
      <ErrorNotice
        error={details.error}
        onRetry={() => {
          void details.refetch();
        }}
      />
    );
  const { data } = details;
  return (
    <>
      <PageHeader title="Referral details" />
      <p>
        {formatSessionDate(data.sessionDate)}, {data.startTime} — {data.location}
      </p>
      <button
        type="button"
        onClick={() => {
          window.print();
        }}
      >
        Print referral details
      </button>
      {/* Focusable, because a table that scrolls sideways on a phone is
          unreachable by keyboard otherwise — the same wrapper the session lists
          use. */}
      <div
        className={styles.tableWrap}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The scrollable table needs a keyboard focus target.
        tabIndex={0}
      >
        <table className={styles.table}>
          <caption>Referral details for every household on this session</caption>
          {/* The printed widths live on the columns rather than on the header
              cells, so a column keeps its share of the page whether or not its
              heading is the widest thing in it. See the stylesheet: without
              `table-layout: fixed` and these, one long address pushes the
              referrer's phone number off the edge of the paper. */}
          <colgroup>
            <col className={styles.client} />
            <col className={styles.address} />
            <col className={styles.postcode} />
            <col className={styles.phone} />
            <col className={styles.referrer} />
            <col className={styles.referrerPhone} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Client</th>
              <th scope="col">Address</th>
              <th scope="col">Postcode</th>
              <th scope="col">Phone</th>
              <th scope="col">Referrer</th>
              <th scope="col">Referrer phone</th>
            </tr>
          </thead>
          <tbody>
            {data.referrals.map((referral) => (
              <tr key={referral.referralId}>
                <td>
                  {[referral.refereeFirstName, referral.refereeSurname].filter(Boolean).join(' ') ||
                    'Unknown'}
                </td>
                <td>{referral.refereeAddress ?? '—'}</td>
                <td>{referral.refereePostcode ?? '—'}</td>
                <td>{referral.refereePhone ?? '—'}</td>
                <td>{referral.referrerName ?? '—'}</td>
                <td>{referral.referrerPhone ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
