import { useParams } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { formatSessionDate } from '../../../lib/london-time';
import { useSessionReferralDetails } from '../queries';
import {
  FIRST_TIME_MARKER,
  byPickNumber,
  otherAnswer,
  voucherInstructionLabel,
} from '../run-session.logic';
import styles from './session-referral-details-screen.module.css';

/**
 * The Run sheet: the session's contact list, plus the three things the Client
 * List also shows about each household — whether they are new, the
 * Christmas-voucher instruction and the referrer's comments. All three come
 * with the referral, so a household nobody has picked for yet has them too.
 * `screenDetails.md`, "#Session processing".
 */
export function SessionReferralDetailsScreen() {
  const { sessionId = '' } = useParams();
  const details = useSessionReferralDetails(sessionId);
  if (details.isPending)
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Run sheet" />
        </div>
        <Spinner label="Loading the run sheet…" />
      </div>
    );
  if (details.isError)
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Run sheet" />
        </div>
        <ErrorNotice
          error={details.error}
          onRetry={() => {
            void details.refetch();
          }}
        />
      </div>
    );
  const { data } = details;
  // The same test the Client List uses: the server gives every household in an
  // in-range session an instruction, without sending a team lead the dates.
  const voucherSchemeApplies = data.referrals.some(
    (referral) => referral.voucherInstruction !== null,
  );
  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader title="Run sheet" />
      </div>
      <section aria-label="Run sheet" className={styles.detailsCard}>
        <p>
          {formatSessionDate(data.sessionDate)}, {data.startTime}
        </p>
        <button
          type="button"
          onClick={() => {
            window.print();
          }}
        >
          Print run sheet
        </button>
        {/* Focusable, because a table that scrolls sideways on a phone is
            unreachable by keyboard otherwise — the same wrapper the session lists
            use. */}
        <div
          aria-label="Run sheet table"
          role="region"
          className={styles.tableWrap}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The scrollable table needs a keyboard focus target.
          tabIndex={0}
        >
          <table className={styles.table}>
            <caption>Run sheet for every household on this session</caption>
            {/* The printed widths live on the columns rather than on the header
              cells, so a column keeps its share of the page whether or not its
              heading is the widest thing in it. See the stylesheet: without
              `table-layout: fixed` and these, one long address pushes the
              referrer's phone number off the edge of the paper. */}
            <colgroup>
              <col className={styles.pickNumber} />
              <col className={styles.client} />
              <col className={styles.address} />
              <col className={styles.postcode} />
              <col className={styles.phone} />
              <col className={styles.referrer} />
              <col className={styles.referrerPhone} />
              <col className={styles.firstTime} />
              {voucherSchemeApplies && <col className={styles.voucher} />}
              <col className={styles.referrerComments} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Pick #</th>
                <th scope="col">Client</th>
                <th scope="col">Address</th>
                <th scope="col">Postcode</th>
                <th scope="col">Phone</th>
                <th scope="col">Referrer</th>
                <th scope="col">Referrer phone</th>
                <th scope="col">First?</th>
                {voucherSchemeApplies && <th scope="col">Voucher</th>}
                <th scope="col">Referrer comments</th>
              </tr>
            </thead>
            <tbody>
              {byPickNumber(data.referrals).map((referral) => (
                <tr key={referral.referralId}>
                  <td>
                    {referral.pickNumber === null ? (
                      <span aria-label="No pick number assigned">—</span>
                    ) : (
                      `#${String(referral.pickNumber)}`
                    )}
                  </td>
                  <th scope="row">
                    {[referral.refereeFirstName, referral.refereeSurname]
                      .filter(Boolean)
                      .join(' ') || 'Unknown'}
                  </th>
                  <td>{referral.refereeAddress ?? '—'}</td>
                  <td>{referral.refereePostcode ?? '—'}</td>
                  <td>{referral.refereePhone ?? '—'}</td>
                  <td>{referral.referrerName ?? '—'}</td>
                  <td>{referral.referrerPhone ?? '—'}</td>
                  <td>
                    {referral.firstTimeMarker === null
                      ? ''
                      : FIRST_TIME_MARKER[referral.firstTimeMarker]}
                  </td>
                  {voucherSchemeApplies && (
                    <td>
                      {referral.voucherInstruction === null
                        ? ''
                        : voucherInstructionLabel(referral.voucherInstruction)}
                    </td>
                  )}
                  <td>{otherAnswer(referral) ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
