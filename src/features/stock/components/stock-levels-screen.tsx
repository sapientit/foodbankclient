import { useRef, useState } from 'react';
import { useAuth } from '../../../auth/auth-context';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { ApiError } from '../../../lib/errors';
import { useCorrectStockLevel, useStockLevels, type StockLevel } from '../queries';
import { isLowStock } from '../stock.logic';
import styles from './stock-levels-screen.module.css';

/**
 * What is on the shelves. Visible to both roles — a team lead is the person
 * standing in the warehouse.
 *
 * Two rules the server hands over and this screen must not undo:
 *
 * - **The order is the server's**, a plain string comparison of shelf labels:
 *   `A1, A10, A2`. Nothing here sorts.
 * - **`quantityOnHand` can be negative.** Parcels can go out between weekly
 *   counts, so it is rendered as the real number rather than as an error.
 */
export function StockLevelsScreen() {
  const { state } = useAuth();
  const levels = useStockLevels();
  const correction = useCorrectStockLevel();
  const correctionLock = useRef(false);
  const [writeLocked, setWriteLocked] = useState(false);
  const [adjusting, setAdjusting] = useState<StockLevel | null>(null);
  const [operation, setOperation] = useState<Operation>('set');
  const [quantity, setQuantity] = useState('');
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null);

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
  const canCorrect =
    state.status === 'signed-in' &&
    (state.user.role === 'admin' || state.user.role === 'team_lead');

  const beginCorrection = (level: StockLevel) => {
    correction.reset();
    setAdjusting(level);
    setOperation('set');
    setQuantity(String(level.quantityOnHand));
    setAdjustmentError(null);
  };

  const submitCorrection = async () => {
    if (adjusting === null || correctionLock.current) return;
    const parsedQuantity = parseQuantity(quantity, operation);
    if (typeof parsedQuantity === 'string') {
      setAdjustmentError(parsedQuantity);
      return;
    }
    if (operation === 'set' && parsedQuantity === adjusting.quantityOnHand) {
      setAdjustmentError('That is already the current stock level.');
      return;
    }
    const displayedDelta =
      operation === 'set'
        ? parsedQuantity - adjusting.quantityOnHand
        : operation === 'add'
          ? parsedQuantity
          : -parsedQuantity;
    if (Math.abs(displayedDelta) > 100_000) {
      setAdjustmentError('The change must be 100,000 or less.');
      return;
    }

    correctionLock.current = true;
    setWriteLocked(true);
    try {
      await correction.mutateAsync({
        stockItemId: adjusting.id,
        operation,
        quantity: parsedQuantity,
      });
      correctionLock.current = false;
      setWriteLocked(false);
      setAdjusting(null);
    } catch (error) {
      // A 4xx means the server confirms it did not write; a network or 5xx answer does not.
      // Keep the synchronous lock in the latter case, because retrying could write twice.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500)
        correctionLock.current = false;
      if (error instanceof ApiError && error.status >= 400 && error.status < 500)
        setWriteLocked(false);
    }
  };

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
              <th className={styles.numeric} scope="col">
                Low-stock threshold
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Rendered in the order the server sent. Shelf labels use plain
                string order, so A10 is before A2. */}
            {visible.map((level) => {
              const lowStock = isLowStock(level);
              return (
                <StockLevelRow
                  adjusting={adjusting}
                  canCorrect={canCorrect}
                  correctionError={correction.error}
                  key={level.id}
                  level={level}
                  lowStock={lowStock}
                  onAdjust={beginCorrection}
                  onCancel={() => {
                    setAdjusting(null);
                    setAdjustmentError(null);
                  }}
                  onOperationChange={(nextOperation) => {
                    setOperation(nextOperation);
                    setQuantity(nextOperation === 'set' ? String(level.quantityOnHand) : '');
                    setAdjustmentError(null);
                  }}
                  onQuantityChange={setQuantity}
                  onSubmit={() => {
                    void submitCorrection();
                  }}
                  operation={operation}
                  quantity={quantity}
                  saving={correction.isPending || writeLocked}
                  validationError={adjustmentError}
                />
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

type Operation = 'set' | 'add' | 'reduce';

function StockLevelRow({
  adjusting,
  canCorrect,
  correctionError,
  level,
  lowStock,
  onAdjust,
  onCancel,
  onOperationChange,
  onQuantityChange,
  onSubmit,
  operation,
  quantity,
  saving,
  validationError,
}: {
  readonly adjusting: StockLevel | null;
  readonly canCorrect: boolean;
  readonly correctionError: Error | null;
  readonly level: StockLevel;
  readonly lowStock: boolean;
  readonly onAdjust: (level: StockLevel) => void;
  readonly onCancel: () => void;
  readonly onOperationChange: (operation: Operation) => void;
  readonly onQuantityChange: (quantity: string) => void;
  readonly onSubmit: () => void;
  readonly operation: Operation;
  readonly quantity: string;
  readonly saving: boolean;
  readonly validationError: string | null;
}) {
  const isAdjusting = adjusting?.id === level.id;
  return (
    <>
      <tr className={lowStock ? styles.lowStockRow : undefined}>
        <th scope="row">
          {level.name}
          {lowStock && <span className={styles.lowStock}>Low stock</span>}
          {!level.isActive && <span className={styles.retired}> (retired)</span>}
        </th>
        <td>{level.shelfNumber}</td>
        <td className={styles.numeric}>
          {level.quantityOnHand}
          {canCorrect && (
            <button
              aria-expanded={isAdjusting}
              aria-label={`Adjust ${level.name} stock`}
              className={styles.adjust}
              onClick={() => {
                onAdjust(level);
              }}
              type="button"
            >
              ✎
            </button>
          )}
        </td>
        <td className={styles.numeric}>{level.lowStockThreshold ?? 'Not watched'}</td>
      </tr>
      {isAdjusting && (
        <tr className={styles.adjustmentRow}>
          <td colSpan={4}>
            <form
              aria-label={`Adjust ${level.name} stock`}
              className={styles.adjustmentForm}
              onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
              }}
            >
              <label htmlFor={`stock-operation-${level.id}`}>Operation</label>
              <select
                id={`stock-operation-${level.id}`}
                onChange={(event) => {
                  onOperationChange(event.target.value as Operation);
                }}
                value={operation}
              >
                <option value="set">Set</option>
                <option value="add">Add</option>
                <option value="reduce">Reduce</option>
              </select>
              <label htmlFor={`stock-quantity-${level.id}`}>
                {operation === 'set'
                  ? 'Stock level'
                  : operation === 'add'
                    ? 'Amount to add'
                    : 'Amount to reduce'}
              </label>
              <input
                id={`stock-quantity-${level.id}`}
                inputMode="numeric"
                onChange={(event) => {
                  onQuantityChange(event.target.value);
                }}
                type="text"
                value={quantity}
              />
              <button aria-disabled={saving} type="submit">
                Save stock change
              </button>
              <button disabled={saving} onClick={onCancel} type="button">
                Cancel
              </button>
              {validationError !== null && <p role="alert">{validationError}</p>}
              {correctionError !== null && <ErrorNotice error={correctionError} />}
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

function parseQuantity(value: string, operation: Operation): number | string {
  if (!/^\d+$/.test(value)) return 'Use a whole number.';
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity)) return 'That number is too large.';
  if (operation !== 'set' && quantity === 0) return 'Enter 1 or more.';
  return quantity;
}
