import { useId, useState } from 'react';
import { Link } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { CalendarIcon, MapPinIcon, PhoneIcon, SearchIcon } from '../../../components/icons';
import { PageHeader } from '../../../components/page-header';
import { formatSessionDate } from '../../../lib/london-time';
import { useReferralReasons } from '../../admin-setup/queries';
import { useReferralSearch, useReferralSearchMemory } from '../queries';
import {
  REASON_ADDITIONAL_KEY,
  SECONDARY_REASON_KEY,
  SURNAME_PREFIX_MIN_LENGTH,
  answerChoiceId,
  answerText,
  referralSearchInput,
  surnamePrefixState,
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
  const input = referralSearchInput({ dateOfBirth, postcode, phone, surnamePrefix });
  const surnameTooShort = surnamePrefixState(surnamePrefix) === 'too-short';
  const surnameId = useId();
  const surnameHintId = useId();

  function clear(): void {
    setDateOfBirth('');
    setPostcode('');
    setPhone('');
    setSurnamePrefix('');
    setCriteria(null);
    memory.clear();
  }

  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader
          description={
            <p>
              Search by date of birth, postcode or phone number: a referral matching any one is
              shown. A surname start can be searched on its own, or added to narrow those results.
            </p>
          }
          icon={<SearchIcon />}
          title="Search referrals"
        />
      </div>
      <form
        className={styles.formPanel}
        onSubmit={(event) => {
          event.preventDefault();
          if (input === null) return;
          // Searching the same boxes twice is the same cached query, so it
          // would sit inside the stale window and look like a dead button.
          // Anything else is a new key and fetches on its own.
          const unchanged = criteria !== null && JSON.stringify(criteria) === JSON.stringify(input);
          memory.remember(input);
          setCriteria(input);
          if (unchanged) void search.refetch();
        }}
      >
        <div className={styles.fieldGrid}>
          <label className={styles.field}>
            <span>DoB</span>
            <span className={styles.inputWithIcon}>
              <CalendarIcon className={styles.fieldIcon} />
              <input
                type="date"
                value={dateOfBirth}
                onChange={(event) => {
                  setDateOfBirth(event.target.value);
                }}
              />
            </span>
          </label>
          <label className={styles.field}>
            <span>or Postcode</span>
            <span className={styles.inputWithIcon}>
              <MapPinIcon className={styles.fieldIcon} />
              <input
                placeholder="Enter postcode"
                value={postcode}
                onChange={(event) => {
                  setPostcode(event.target.value);
                }}
              />
            </span>
          </label>
          <label className={styles.field}>
            <span>or Phone number</span>
            <span className={styles.inputWithIcon}>
              <PhoneIcon className={styles.fieldIcon} />
              <input
                placeholder="Enter phone number"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                }}
              />
            </span>
          </label>
          <div className={styles.field}>
            <label htmlFor={surnameId}>Start of surname</label>
            {/* Not trimmed: a trailing space is part of the prefix the server
                matches, which is how "Di " finds Di Lima and not Dibb. */}
            <input
              aria-describedby={surnameHintId}
              aria-invalid={surnameTooShort}
              id={surnameId}
              value={surnamePrefix}
              onChange={(event) => {
                setSurnamePrefix(event.target.value);
              }}
            />
            <span className={surnameTooShort ? styles.fieldError : styles.hint} id={surnameHintId}>
              {surnameTooShort
                ? `Too short: type at least ${String(SURNAME_PREFIX_MIN_LENGTH)} characters to search.`
                : `At least ${String(SURNAME_PREFIX_MIN_LENGTH)} characters. A space counts, so “Di ” finds Di Lima.`}
            </span>
          </div>
          <div className={styles.actions}>
            <button disabled={input === null || search.isFetching} type="submit">
              Search
            </button>
            <button className="button-secondary" onClick={clear} type="button">
              Clear
            </button>
          </div>
        </div>
      </form>
      {search.error !== null && <ErrorNotice error={search.error} />}
      {search.data !== undefined && (
        <section aria-labelledby="search-results-heading" className={styles.resultsPanel}>
          <h2 id="search-results-heading">
            {search.data.count} result{search.data.count === 1 ? '' : 's'} found
          </h2>
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
                  <th scope="col">Notes</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {search.data.results.map((result) => (
                  <tr key={result.referralId}>
                    <td>{formatSessionDate(result.sessionDate)}</td>
                    <td>
                      <span className={styles.status} data-status={result.status}>
                        {REFERRAL_STATUS_LABELS[result.status]}
                      </span>
                    </td>
                    <th scope="row">
                      {/* The flag is what puts "Back to search results" on the
                            referral, and it is a boolean rather than the search
                            itself: history state is not a place personal data
                            may go. */}
                      <Link
                        className={styles.nameLink}
                        state={{ fromSearch: true }}
                        to={`/referrals/${result.referralId}`}
                      >
                        {formatName(result.refereeSurname, result.refereeFirstName)}
                      </Link>
                    </th>
                    <td>{result.refereePostcode ?? '—'}</td>
                    <td>{result.refereePhone ?? '—'}</td>
                    <td>{result.referrerOrganisation}</td>
                    <td className={styles.notes}>
                      {reasonLabel(reasons.data, result.reasonId)} /{' '}
                      {reasonLabel(
                        reasons.data,
                        answerChoiceId(result.answers, SECONDARY_REASON_KEY),
                      )}{' '}
                      / {answerText(result.answers, REASON_ADDITIONAL_KEY)} /{' '}
                      {result.adminInfo ?? '—'}
                    </td>
                    <td>
                      <Link
                        className="button-link button-secondary"
                        state={{ fromSearch: true }}
                        to={`/referrals/${result.referralId}`}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
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
        </section>
      )}
    </div>
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
