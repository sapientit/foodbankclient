import { ErrorNotice } from '../../../components/error-notice';
import { Spinner } from '../../../components/spinner';
import { useSessionStockRequirement } from '../queries';
import { describeStockCheck, isShort, summariseStockCheck } from '../stock-check.logic';
import styles from './stock-check-panel.module.css';

/**
 * Can the warehouse cover this session? One row per stock item the session's
 * parcels between them call for, against what is on the shelves.
 *
 * **Only the items the session needs.** The server sends no line for an item
 * nothing that morning asks for, so the table is as long as the work is — this
 * is not the stock catalogue with the relevant rows picked out, and it must not
 * be padded into one.
 *
 * **Rendered in the order given**, which is shelf order, because somebody
 * reading this is usually about to go and look. Never re-sorted: the server
 * pads the numeric run so it answers `A1, A2, A10`, and a sort here on
 * `shelfNumber` would put `A10` second and send a volunteer back down the aisle.
 *
 * **The shelf number itself is not shown.** The order carries the walk, which
 * is the whole of what it is for here; printed against every row it is a column
 * of codes competing with the three figures this table exists to compare, on a
 * phone held in a hall. It stays in the response and out of the table.
 *
 * The section stays in the DOM while it is closed so the control that opens it
 * has something to point `aria-controls` at; `hidden` is what keeps it off the
 * screen and out of the accessibility tree. The request is not made until it is
 * opened.
 */
export function StockCheckPanel({
  id,
  open,
  sessionId,
}: {
  readonly id: string;
  readonly open: boolean;
  readonly sessionId: string;
}) {
  const requirement = useSessionStockRequirement(sessionId, open);
  const items = requirement.data?.items ?? [];
  const summary = summariseStockCheck(items);

  return (
    <section aria-labelledby={`${id}-heading`} className={styles.panel} hidden={!open} id={id}>
      <h2 className={styles.heading} id={`${id}-heading`}>
        Stock check
      </h2>
      {requirement.isPending && <Spinner label="Checking stock…" />}
      {requirement.isError && (
        <ErrorNotice error={requirement.error} onRetry={() => void requirement.refetch()} />
      )}
      {requirement.isSuccess && (
        <>
          {/* Announced, because it arrives after the panel opens and it is the
              one line somebody reads before they read the table. */}
          <p className={styles.summary} role="status">
            {describeStockCheck(summary)}
          </p>
          {items.length > 0 && (
            /* Focusable, so a table that scrolls sideways on a phone can still
               be reached by keyboard — the same treatment as the client list. */
            <div
              className={styles.tableWrap}
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The scrollable table needs a keyboard focus target.
              tabIndex={0}
            >
              <table className={styles.table}>
                <caption className={styles.visuallyHidden}>
                  Stock this session needs, against what is on the shelves, in shelf order
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Stock item</th>
                    <th className={styles.numeric} scope="col">
                      Needed
                    </th>
                    <th className={styles.numeric} scope="col">
                      In stock
                    </th>
                    <th className={styles.numeric} scope="col">
                      Short by
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((line) => {
                    const short = isShort(line);
                    return (
                      /* Never colour alone: the shortfall column carries the
                         number in words a screen reader reads out, and the row
                         styling only repeats what the figure already says. */
                      <tr data-short={short ? 'true' : undefined} key={line.id}>
                        <th className={styles.itemCell} scope="row">
                          {line.name}
                          {!line.isActive && ' (retired)'}
                          {line.description !== null && (
                            <span className={styles.itemDescription}>{line.description}</span>
                          )}
                        </th>
                        <td className={styles.numeric}>{line.requiredQuantity}</td>
                        {/* A level can be negative after a correction, and that
                            is a figure rather than a fault: shown as it comes. */}
                        <td className={styles.numeric}>{line.quantityOnHand}</td>
                        <td className={styles.numeric}>
                          {short ? <strong>{line.shortfall}</strong> : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
