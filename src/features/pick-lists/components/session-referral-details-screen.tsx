import { useParams } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { formatSessionDate } from '../../../lib/london-time';
import { useSessionReferralDetails } from '../queries';

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
      <table>
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
    </>
  );
}
