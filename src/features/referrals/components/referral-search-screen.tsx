import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { formatSessionDate } from '../../../lib/london-time';
import { useReferralSearch } from '../queries';

const MATCH_LABELS = {
  date_of_birth: 'Date of birth',
  postcode: 'Postcode',
  phone: 'Phone number',
} as const;

export function ReferralSearchScreen() {
  const search = useReferralSearch();
  const [postcode, setPostcode] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const hasTerm = postcode !== '' || phone !== '' || dateOfBirth !== '';
  return (
    <>
      <PageHeader title="Search referrals" />
      <p>
        Search by postcode, phone number and/or date of birth. Matching any supplied value returns a
        result.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (hasTerm)
            search.mutate({
              ...(postcode === '' ? {} : { postcode }),
              ...(phone === '' ? {} : { phone }),
              ...(dateOfBirth === '' ? {} : { dateOfBirth }),
            });
        }}
      >
        <label>
          Postcode{' '}
          <input
            value={postcode}
            onChange={(event) => {
              setPostcode(event.target.value);
            }}
          />
        </label>{' '}
        <label>
          Phone number{' '}
          <input
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
            }}
          />
        </label>{' '}
        <label>
          Date of birth{' '}
          <input
            type="date"
            value={dateOfBirth}
            onChange={(event) => {
              setDateOfBirth(event.target.value);
            }}
          />
        </label>{' '}
        <button disabled={!hasTerm || search.isPending} type="submit">
          Search
        </button>
      </form>
      {search.error !== null && <ErrorNotice error={search.error} />}
      {search.data !== undefined && (
        <>
          <p>
            {search.data.count} result{search.data.count === 1 ? '' : 's'} found.
          </p>
          <table>
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Address</th>
                <th scope="col">Session</th>
                <th scope="col">Status</th>
                <th scope="col">Matched on</th>
              </tr>
            </thead>
            <tbody>
              {search.data.results.map((result) => (
                <tr key={result.referralId}>
                  <td>
                    <Link to={`/referrals/${result.referralId}`}>
                      {[result.refereeFirstName, result.refereeSurname].filter(Boolean).join(' ') ||
                        'Unknown'}
                    </Link>
                  </td>
                  <td>{result.refereeAddress ?? '—'}</td>
                  <td>
                    {formatSessionDate(result.sessionDate)}, {result.sessionLocation}
                  </td>
                  <td>{result.status}</td>
                  <td>{result.matchedOn.map((field) => MATCH_LABELS[field]).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
