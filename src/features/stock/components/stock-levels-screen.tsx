import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { useStockLevels } from '../queries';
import styles from './stock-levels-screen.module.css';

/**
 * What is on the shelves. Visible to both roles — a team lead is the person
 * standing in the warehouse.
 *
 * Two rules the server hands over and this screen must not undo:
 *
 * - **The order is the server's**, derived from a zero-padded shelf key so a
 *   picker walks the aisle once: `A1, A2, A10`. Nothing here sorts.
 * - **`quantityOnHand` can be negative.** Parcels can go out between weekly
 *   counts, so it is rendered as the real number rather than as an error.
 */
export function StockLevelsScreen() {
  const levels = useStockLevels();

  if (levels.isPending)
    return (
      <>
        <PageHeader title="Stock" />
        <Spinner label="Loading stock levels…" />
      </>
    );
  if (levels.isError)
    return (
      <>
        <PageHeader title="Stock" />
        <ErrorNotice error={levels.error} onRetry={() => void levels.refetch()} />
      </>
    );

  const visible = levels.data.filter((level) => level.isActive);

  return (
    <>
      <PageHeader title="Stock" />
      <p className={styles.intro}>
        What the system says is on each shelf, in the order you would walk them.
      </p>
      {visible.length === 0 ? (
        <EmptyState
          headline="No stock items yet"
          sentence="An administrator adds items to the list before anything can be counted or picked."
        />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Shelf</th>
              <th className={styles.numeric} scope="col">
                On hand
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Rendered in the order the server sent. Never re-sorted: a
                `sort()` on shelfNumber puts A10 before A2. */}
            {visible.map((level) => (
              <tr key={level.id}>
                <th scope="row">
                  {level.name}
                  {!level.isActive && <span className={styles.retired}> (retired)</span>}
                </th>
                <td>{level.shelfNumber}</td>
                <td className={styles.numeric}>{level.quantityOnHand}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
