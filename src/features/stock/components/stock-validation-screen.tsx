import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { useStockValidation } from '../queries';
import styles from './stock-validation-screen.module.css';

/** Server-authoritative checks for the intentionally non-automatic grouping and crate relationships. */
export function StockValidationScreen() {
  const validation = useStockValidation();
  if (validation.isPending)
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Stock validation" />
        </div>
        <Spinner label="Checking stock setup…" />
      </div>
    );
  if (validation.isError)
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Stock validation" />
        </div>
        <ErrorNotice error={validation.error} onRetry={() => void validation.refetch()} />
      </div>
    );
  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader title="Stock validation" />
      </div>
      {validation.data.length === 0 ? (
        <p role="status">Stock setup is valid. Every item is counted exactly once.</p>
      ) : (
        <>
          <p role="alert">
            {validation.data.length} {validation.data.length === 1 ? 'issue needs' : 'issues need'}{' '}
            attention. Changes are saved first, then checked, so this list helps you resolve an
            incomplete transition.
          </p>
          <ul>
            {validation.data.map((issue, index) => (
              <li key={`${issue.kind}-${issue.stockItemId ?? issue.crateId ?? String(index)}`}>
                {issue.message}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
