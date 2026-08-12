import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { formatSessionDate } from '../../../lib/london-time';
import { fuelAnswers } from '../fuel-help.logic';
import { useFuelHelpList } from '../queries';
import styles from './fuel-help-list-screen.module.css';

/**
 * A deliberately plain table: fuel work happens in a spreadsheet, and copying
 * rows intact is safer than retyping a phone number. It reads only the two
 * documented fuel answers; the whole `answers` object never reaches the DOM.
 */
export function FuelHelpListScreen() {
  const list = useFuelHelpList();

  if (list.isPending) {
    return (
      <>
        <PageHeader title="Fuel help list" />
        <Spinner label="Loading the fuel help list…" />
      </>
    );
  }

  if (list.isError) {
    return (
      <>
        <PageHeader title="Fuel help list" />
        <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Fuel help list" />
      <p className={styles.intro}>Copy this table into Excel to work through it.</p>

      {list.data.households.length === 0 ? (
        <p>No households currently need fuel follow-up.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Session date</th>
                <th scope="col">Name</th>
                <th scope="col">Address</th>
                <th scope="col">Postcode</th>
                <th scope="col">Phone</th>
                <th scope="col">Pre-payment meter</th>
                <th scope="col">Permission to ring</th>
              </tr>
            </thead>
            <tbody>
              {list.data.households.map((household) => {
                const answers = fuelAnswers(household.answers);

                return (
                  <tr key={household.referralId}>
                    <td>{formatSessionDate(household.sessionDate)}</td>
                    <th scope="row">
                      {household.refereeFirstName ?? 'Unknown'} {household.refereeSurname ?? ''}
                    </th>
                    <td>{household.refereeAddress ?? 'Not provided'}</td>
                    <td>{household.refereePostcode ?? 'Not provided'}</td>
                    <td>{household.refereePhone ?? 'Not provided'}</td>
                    <td>{answers.prePayment}</td>
                    <td className={styles.permission}>{answers.contactApproved}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
