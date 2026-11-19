import { useMemo } from 'react';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import {
  useConfigurationReleaseHistory,
  useConfigurationReleasesBulk,
} from '../../configuration-releases/queries';
import { useStockItems } from '../../stock/queries';
import { parseReleases } from '../release-pick-list.logic';
import { validatePreferenceRules } from '../preference-rules';
import styles from './preference-rule-health-screen.module.css';

/**
 * Admin maintenance check for the currently *published* release — never the
 * bundled JSON, which is a local authoring/test fixture only (see
 * `run-sessions-screen.tsx`'s own published-release check). Validating the
 * bundle here would report errors a published correction has already fixed,
 * and miss ones a bad publish has just introduced.
 */
export function PreferenceRuleHealthScreen() {
  const stockItems = useStockItems();
  const history = useConfigurationReleaseHistory();
  const publishedFormId = useMemo(
    () => history.data?.find((release) => release.status === 'published')?.formId,
    [history.data],
  );
  const releases = useConfigurationReleasesBulk(
    publishedFormId === undefined ? [] : [publishedFormId],
  );

  if (stockItems.isPending || history.isPending)
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
  if (history.isError)
    return (
      <div className={styles.page}>
        <ErrorNotice error={history.error} onRetry={() => void history.refetch()} />
      </div>
    );
  if (publishedFormId === undefined)
    return (
      <div className={styles.page}>
        <p role="alert">No published referral form release was found to check.</p>
      </div>
    );
  if (releases.isPending)
    return (
      <div className={styles.page}>
        <Spinner label="Checking preference rules…" />
      </div>
    );
  if (releases.isError)
    return (
      <div className={styles.page}>
        <ErrorNotice error={releases.error} onRetry={() => void releases.refetch()} />
      </div>
    );

  const [published] = parseReleases(releases.data);
  if (published === undefined)
    return (
      <div className={styles.page}>
        <p role="alert">No published referral form release was found to check.</p>
      </div>
    );

  const health = validatePreferenceRules(stockItems.data, published.rules, published.definition);
  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader title="Preference rule check" />
      </div>
      <section aria-label="Preference rule check results" className={styles.results}>
        <p>
          {published.rules.length} rule
          {published.rules.length === 1 ? '' : 's'} checked against the current questionnaire and
          active stock items.
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
