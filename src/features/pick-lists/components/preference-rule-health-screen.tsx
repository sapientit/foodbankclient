import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { useStockItems } from '../../stock/queries';
import { preferenceRuleConfig, validatePreferenceRules } from '../preference-rules';

/** Admin maintenance check for the client-owned preference-rule configuration. */
export function PreferenceRuleHealthScreen() {
  const stockItems = useStockItems();
  if (stockItems.isPending) return <Spinner label="Checking preference rules…" />;
  if (stockItems.isError)
    return <ErrorNotice error={stockItems.error} onRetry={() => void stockItems.refetch()} />;

  const health = validatePreferenceRules(stockItems.data);
  return (
    <>
      <PageHeader title="Preference rule check" />
      <p>
        {preferenceRuleConfig.rules.length} rule{preferenceRuleConfig.rules.length === 1 ? '' : 's'}{' '}
        checked against the current questionnaire and active stock items.
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
    </>
  );
}
