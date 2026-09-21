import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { useStockItems } from '../../stock/queries';
import { preferenceRuleConfig, validatePreferenceRules } from '../preference-rules';
import styles from './preference-rule-health-screen.module.css';

/** Admin maintenance check for the client-owned preference-rule configuration. */
export function PreferenceRuleHealthScreen() {
  const stockItems = useStockItems();
  if (stockItems.isPending)
    return (
      <div className={styles.page}>
        <Spinner label="Checking preference rules…" />
      </div>
    );
  if (stockItems.isError)
    return (
      <div className={styles.page}>
        <ErrorNotice error={stockItems.error} onRetry={() => void stockItems.refetch()} />
      </div>
    );

  const health = validatePreferenceRules(stockItems.data);
  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader title="Preference rule check" />
      </div>
      <section aria-label="Preference rule check results" className={styles.results}>
        <p>
          {preferenceRuleConfig.rules.length} rule
          {preferenceRuleConfig.rules.length === 1 ? '' : 's'} checked against the current
          questionnaire and active stock items.
        </p>
        {health.errors.length === 0 ? (
          <p role="status">All preference rules are valid.</p>
        ) : (
          <div role="alert">
            <p>Fix these rules before generating a pick list:</p>
            <ul>
              {health.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
