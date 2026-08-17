import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { formatSessionDate } from '../../../lib/london-time';
import { fuelColumns, fuelColumnsNeedOptionSources, fuelColumnValue } from '../fuel-help.logic';
import { useReferralOptionSources } from '../../referrals/queries';
import { useFuelHelpList } from '../queries';
import styles from './fuel-help-list-screen.module.css';

/**
 * A deliberately plain table: fuel work happens in a spreadsheet, and copying
 * rows intact is safer than retyping a phone number. The referral form decides
 * which columns fuel workers may see; unmarked answers never reach the DOM.
 */
export function FuelHelpListScreen() {
  const list = useFuelHelpList();
  const columns = fuelColumns();
  // Only where a marked question chooses from a lookup, which none do today:
  // its answer would otherwise be copied into the spreadsheet as an id.
  const reasons = useReferralOptionSources(fuelColumnsNeedOptionSources(columns));

  if (list.isPending || reasons.isPending) {
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

  if (reasons.isError) {
    return (
      <>
        <PageHeader title="Fuel help list" />
        <ErrorNotice error={reasons.error} onRetry={() => void reasons.refetch()} />
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
        <div
          aria-label="Fuel help list"
          className={styles.tableWrap}
          role="region"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The scrollable table needs a keyboard focus target.
          tabIndex={0}
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Session date</th>
                {columns.map((column) => (
                  <th key={column.key} scope="col">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data.households.map((household) => {
                return (
                  <tr key={household.referralId}>
                    <td>{formatSessionDate(household.sessionDate)}</td>
                    {columns.map((column, index) => {
                      const value = fuelColumnValue(column, household, reasons.sources);
                      return index === 0 ? (
                        <th key={column.key} scope="row">
                          {value}
                        </th>
                      ) : (
                        <td key={column.key}>{value}</td>
                      );
                    })}
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
