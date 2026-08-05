import { Link, useSearchParams } from 'react-router';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { useStockLevels } from '../queries';
import { splitByStatus } from '../stock.logic';
import styles from './stock-levels-screen.module.css';

const RETIRED_PARAM = 'retired';

/**
 * What is on the shelves. Visible to both roles — a team lead is the person
 * standing in the warehouse, and correcting stock by hand is their job.
 *
 * Two rules the server hands over and this screen must not undo:
 *
 * - **The order is the server's**, derived from a zero-padded shelf key so a
 *   picker walks the aisle once: `A1, A2, A10`. Nothing here sorts.
 * - **`quantityOnHand` is a ledger sum and may be negative.** It is rendered as
 *   the number it is. A negative level is a real state after a correction, not
 *   a fault, and dressing it up as an error would send somebody looking for a
 *   bug instead of for the missing tins.
 */
export function StockLevelsScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
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

  const showRetired = searchParams.get(RETIRED_PARAM) === '1';
  const { active, retired } = splitByStatus(levels.data);
  const visible = showRetired ? levels.data : active;

  return (
    <>
      <PageHeader title="Stock" />
      <p className={styles.intro}>
        What the ledger says is on each shelf, in the order you would walk them. Levels are worked
        out from every movement recorded, so a count that disagrees with the shelf is put right with
        an adjustment.
      </p>
      <p>
        <label className={styles.toggle}>
          <input
            checked={showRetired}
            onChange={(event) => {
              setSearchParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  if (event.target.checked) next.set(RETIRED_PARAM, '1');
                  else next.delete(RETIRED_PARAM);
                  return next;
                },
                { replace: true },
              );
            }}
            type="checkbox"
          />
          Show retired items ({retired.length})
        </label>
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
              <th scope="col">Actions</th>
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
                <td className={styles.actions}>
                  <Link to={`/stock/adjust/${level.id}`}>Adjust</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
