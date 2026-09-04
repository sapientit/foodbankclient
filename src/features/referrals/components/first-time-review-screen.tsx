import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { formatCalendarDate, formatSessionDate } from '../../../lib/london-time';
import { refereeName } from '../referrals.logic';
import {
  useReferral,
  useRepeatReferrals,
  useSaveFirstTimeReview,
  type RepeatReferralMatch,
} from '../queries';
import styles from './first-time-review-screen.module.css';

const NO_PREVIOUS_ATTENDANCE = 'no-previous-attendance';

const MATCHED_ON_LABELS: Record<RepeatReferralMatch['matchedOn'][number], string> = {
  date_of_birth: 'DOB',
  postcode: 'Postcode',
  phone: 'Phone',
};

function maskedPhone(phone: string | null): string {
  if (phone === null) return '—';
  const digits = phone.replaceAll(/\D/g, '');
  return digits.length < 4 ? '••••' : `•••• ${digits.slice(-4)}`;
}

export function FirstTimeReviewScreen() {
  const { referralId = '' } = useParams();
  const navigate = useNavigate();
  const referral = useReferral(referralId);
  const [excludePostcode, setExcludePostcode] = useState(false);
  const matches = useRepeatReferrals(referralId, excludePostcode, referralId !== '');
  const save = useSaveFirstTimeReview();
  const [choice, setChoice] = useState<string | null>(null);
  const [surnameInput, setSurnameInput] = useState('');
  const [surnameStartsWith, setSurnameStartsWith] = useState('');

  if (referral.isPending || matches.isPending)
    return <Spinner label="Loading potential matches…" />;
  if (referral.isError)
    return <ErrorNotice error={referral.error} onRetry={() => void referral.refetch()} />;
  if (matches.isError)
    return <ErrorNotice error={matches.error} onRetry={() => void matches.refetch()} />;
  const review = referral.data.firstTimeReview;
  if (review === undefined)
    return <p role="alert">First-time review is available to administrators only.</p>;
  if (review.status !== 'unreviewed')
    return (
      <main>
        <PageHeader title="Potential matches" />
        <p>This referral’s previous-attendance decision has already been recorded.</p>
        <Link className="button-link button-secondary" to={`/referrals/${referralId}`}>
          Back to referral
        </Link>
      </main>
    );

  const displayedMatches = matches.data.matches.filter(
    (match) =>
      match.refereeSurname?.toLocaleLowerCase().startsWith(surnameStartsWith.toLocaleLowerCase()) ??
      surnameStartsWith === '',
  );
  const selectedMatch = matches.data.matches.find((match) => match.referralId === choice);

  return (
    <main>
      <PageHeader title="Potential matches" />
      <div className={styles.layout}>
        <div className={styles.content}>
          <section aria-labelledby="referral-being-submitted">
            <h2 id="referral-being-submitted">Referral being submitted</h2>
            <dl className={styles.referralSummary}>
              <SummaryField label="Name" value={refereeName(referral.data) ?? '—'} />
              <SummaryField
                label="DOB"
                value={
                  referral.data.refereeDateOfBirth === null
                    ? '—'
                    : formatCalendarDate(referral.data.refereeDateOfBirth)
                }
              />
              <SummaryField label="Phone" value={maskedPhone(referral.data.refereePhone)} />
              <SummaryField label="Postcode" value={referral.data.refereePostcode ?? '—'} />
              <SummaryField label="Address" value={referral.data.refereeAddress ?? '—'} />
            </dl>
          </section>

          <section aria-labelledby="potential-matches-heading" className={styles.matches}>
            <h2 id="potential-matches-heading">Potential matches</h2>
            <p>Select a previous referral to confirm the client and last attended session.</p>
            <form
              className={styles.filters}
              onSubmit={(event) => {
                event.preventDefault();
                setSurnameStartsWith(surnameInput.trim());
              }}
            >
              <label>
                Surname starts with
                <input
                  onChange={(event) => {
                    setSurnameInput(event.target.value);
                  }}
                  value={surnameInput}
                />
              </label>
              <label className={styles.checkbox}>
                <input
                  checked={excludePostcode}
                  onChange={(event) => {
                    setExcludePostcode(event.target.checked);
                  }}
                  type="checkbox"
                />
                Exclude postcode matches
              </label>
              <button className="button-secondary" type="submit">
                Search
              </button>
            </form>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (choice === null) return;
                if (choice === NO_PREVIOUS_ATTENDANCE) {
                  save.mutate(
                    { id: referralId, body: { noPreviousReferral: true } },
                    { onSuccess: () => void navigate(`/referrals/${referralId}`) },
                  );
                  return;
                }
                if (selectedMatch === undefined) return;
                save.mutate(
                  { id: referralId, body: { previousSessionDate: selectedMatch.sessionDate } },
                  { onSuccess: () => void navigate(`/referrals/${referralId}`) },
                );
              }}
            >
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Select</th>
                      <th scope="col">Client</th>
                      <th scope="col">Matched on</th>
                      <th scope="col">DOB</th>
                      <th scope="col">Phone</th>
                      <th scope="col">Postcode</th>
                      <th scope="col">Address</th>
                      <th scope="col">Last attended</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedMatches.map((match) => (
                      <MatchRow
                        choice={choice}
                        key={match.referralId}
                        match={match}
                        onChoose={setChoice}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <label className={styles.noPrevious}>
                <input
                  checked={choice === NO_PREVIOUS_ATTENDANCE}
                  name="previous-attendance"
                  onChange={() => {
                    setChoice(NO_PREVIOUS_ATTENDANCE);
                  }}
                  type="radio"
                />
                Never attended / none of these referrals
              </label>
              {save.error !== null && <ErrorNotice error={save.error} />}
              <div className={styles.actions}>
                <Link className="button-link button-secondary" to="/referrals">
                  Back
                </Link>
                <button disabled={choice === null || save.isPending} type="submit">
                  {save.isPending ? 'Saving…' : 'Confirm and continue'}
                </button>
              </div>
            </form>
          </section>
        </div>
        <aside aria-labelledby="referral-check-heading" className={styles.check}>
          <h2 id="referral-check-heading">Referral check</h2>
          <p>
            {choice === NO_PREVIOUS_ATTENDANCE
              ? 'This referral confirms no attendance in the last 12 months.'
              : selectedMatch === undefined
                ? 'Select a referral to confirm the client and last attended session.'
                : 'The selected referral confirms the client and last attended session.'}
          </p>
        </aside>
      </div>
    </main>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function MatchRow({
  choice,
  match,
  onChoose,
}: {
  choice: string | null;
  match: RepeatReferralMatch;
  onChoose: (choice: string) => void;
}) {
  const unavailable = match.outcome === 'no_show';
  const name = refereeName(match) ?? 'potential match';
  return (
    <tr>
      <td>
        <input
          aria-label={`Select ${name}`}
          checked={choice === match.referralId}
          disabled={unavailable}
          name="previous-attendance"
          onChange={() => {
            onChoose(match.referralId);
          }}
          type="radio"
        />
      </td>
      <td>{name}</td>
      <td>{match.matchedOn.map((field) => MATCHED_ON_LABELS[field]).join(', ')}</td>
      <td>
        {match.refereeDateOfBirth === null ? '—' : formatCalendarDate(match.refereeDateOfBirth)}
      </td>
      <td>{maskedPhone(match.refereePhone)}</td>
      <td>{match.refereePostcode ?? '—'}</td>
      <td>{match.refereeAddress ?? '—'}</td>
      <td>
        {formatSessionDate(match.sessionDate)}
        {unavailable && ' — No Show / Not in'}
        {match.outcome === 'booked' && ' — Booked'}
      </td>
    </tr>
  );
}
