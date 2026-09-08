import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { useStockValidation } from '../queries';

/** Server-authoritative checks for the intentionally non-automatic grouping and crate relationships. */
export function StockValidationScreen() {
  const validation = useStockValidation();
  if (validation.isPending)
    return (
      <>
        <PageHeader title="Stock validation" />
        <Spinner label="Checking stock setup…" />
      </>
    );
  if (validation.isError)
    return (
      <>
        <PageHeader title="Stock validation" />
        <ErrorNotice error={validation.error} onRetry={() => void validation.refetch()} />
      </>
    );
  return (
    <>
      <PageHeader title="Stock validation" />
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
    </>
  );
}
