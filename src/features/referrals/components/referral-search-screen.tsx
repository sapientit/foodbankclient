import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { formatSessionDate } from '../../../lib/london-time';
import { useReferralReasons } from '../../admin-setup/queries';
import { useReferralSearch, useReferralSearchMemory } from '../queries';
import {
  REASON_ADDITIONAL_KEY,
  SECONDARY_REASON_KEY,
  answerChoiceId,
  answerText,
} from '../referral-search.logic';
import { REFERRAL_STATUS_LABELS } from '../referrals.logic';
import styles from './referral-search-screen.module.css';

export function ReferralSearchScreen() {
  const memory = useReferralSearchMemory();
  // The search an administrator ran before opening one of its results, so that
  // coming back shows the same boxes and the same list.
  const [criteria, setCriteria] = useState(() => memory.read());
  const search = useReferralSearch(criteria);
  const reasons = useReferralReasons();
  const [postcode, setPostcode] = useState(criteria?.postcode ?? '');
  const [phone, setPhone] = useState(criteria?.phone ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(criteria?.dateOfBirth ?? '');
  const [surnamePrefix, setSurnamePrefix] = useState(criteria?.surnamePrefix ?? '');
  const hasTerm = postcode !== '' || phone !== '' || dateOfBirth !== '';
  return (
    <>
      <PageHeader title="Search referrals" />
      <p>
        Search by date of birth, postcode and/or phone number. A surname start narrows those
        results.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!hasTerm) return;
          const input = {
            ...(dateOfBirth === '' ? {} : { dateOfBirth }),
            ...(postcode === '' ? {} : { postcode }),
            ...(phone === '' ? {} : { phone }),
            ...(surnamePrefix === '' ? {} : { surnamePrefix }),
          };
          // Searching the same boxes twice is the same cached query, so it
          // would sit inside the stale window and look like a dead button.
          // Anything else is a new key and fetches on its own.
          const unchanged = criteria !== null && JSON.stringify(criteria) === JSON.stringify(input);
          memory.remember(input);
          setCriteria(input);
          if (unchanged) void search.refetch();
        }}
      >
        <div className={styles.fieldRow}>
          <label>
            DoB{' '}
            <input
              type="date"
              value={dateOfBirth}
              onChange={(event) => {
                setDateOfBirth(event.target.value);
              }}
            />
          </label>
          <label>
            or Postcode{' '}
            <input
              value={postcode}
              onChange={(event) => {
                setPostcode(event.target.value);
              }}
            />
          </label>
          <label>
            or Phone number{' '}
            <input
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
              }}
            />
          </label>
        </div>
        <div className={styles.fieldRow}>
          <label>
            Start of surname{' '}
            <input
              value={surnamePrefix}
              onChange={(event) => {
                setSurnamePrefix(event.target.value);
              }}
            />
          </label>
          <button disabled={!hasTerm || search.isFetching} type="submit">
            Search
          </button>
        </div>
      </form>
      {search.error !== null && <ErrorNotice error={search.error} />}
      {search.data !== undefined && (
        <>
          <p>
            {search.data.count} result{search.data.count === 1 ? '' : 's'} found.
          </p>
          <div
            aria-label="Referral search results"
            className={styles.tableWrap}
            role="region"
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The scrollable table needs a keyboard focus target.
            tabIndex={0}
          >
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Session date</th>
                  <th scope="col">Status</th>
                  <th scope="col">Name</th>
                  <th scope="col">Postcode</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Referrer organisation</th>
                </tr>
              </thead>
              <tbody>
                {search.data.results.map((result) => (
                  <Fragment key={result.referralId}>
                    <tr>
                      <td>{formatSessionDate(result.sessionDate)}</td>
                      <td>{REFERRAL_STATUS_LABELS[result.status]}</td>
                      <th scope="row">
                        {/* The flag is what puts "Back to search results" on the
                            referral, and it is a boolean rather than the search
                            itself: history state is not a place personal data
                            may go. */}
                        <Link state={{ fromSearch: true }} to={`/referrals/${result.referralId}`}>
                          {formatName(result.refereeSurname, result.refereeFirstName)}
                        </Link>
                      </th>
                      <td>{result.refereePostcode ?? '—'}</td>
                      <td>{result.refereePhone ?? '—'}</td>
                      <td>{result.referrerOrganisation}</td>
                    </tr>
                    <tr className={styles.summaryRow}>
                      <td colSpan={6}>
                        {reasonLabel(reasons.data, result.reasonId)} /{' '}
                        {reasonLabel(
                          reasons.data,
                          answerChoiceId(result.answers, SECONDARY_REASON_KEY),
                        )}{' '}
                        / {answerText(result.answers, REASON_ADDITIONAL_KEY)} /{' '}
                        {result.adminInfo ?? '—'}
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {search.data.count > search.data.results.length && (
            <p role="status">
              Showing the first {search.data.results.length} results. Narrow the search to see fewer
              households.
            </p>
          )}
        </>
      )}
    </>
  );
}

function reasonLabel(
  reasons: readonly { readonly id: string; readonly label: string }[] | undefined,
  id: string | null,
): string {
  if (id === null) return '—';
  return reasons?.find((reason) => reason.id === id)?.label ?? '—';
}

function formatName(
  surname: string | null | undefined,
  firstName: string | null | undefined,
): string {
  return (
    [surname, firstName]
      .filter((name): name is string => name !== null && name !== undefined && name !== '')
      .join(', ') || 'Unknown'
  );
}
