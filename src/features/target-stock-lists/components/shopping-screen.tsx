import { useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { Toast } from '../../../components/toast';
import { useToast } from '../../../components/use-toast';
import { copyToClipboard } from '../../../lib/clipboard';
import { useStockLevels } from '../../stock/queries';
import {
  computeShoppingList,
  shoppingListToPlainText,
  splitGroupedColumns,
} from '../shopping-list.logic';
import { useTargetStockLists } from '../queries';
import styles from './shopping-screen.module.css';

/**
 * The team lead's half of target stock lists: pick a list, and be told what to
 * buy — the target less what the last stock take says is on hand, only where
 * that is positive, grouped by category.
 *
 * Admin and team lead; **no role guard on the route**. The buy list is worked
 * out here from the chosen list and the current stock levels — nothing is
 * saved. See `shopping-list.logic.ts` for the computation and why it is
 * client-side (a team lead reads a list's raw `lines` — server Q48, settled).
 */
export function ShoppingScreen() {
  const lists = useTargetStockLists();
  const levels = useStockLevels();
  const [searchParams, setSearchParams] = useSearchParams();
  const { message: toastMessage, show: showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const pickerId = useId();
  const summaryId = useId();
  const attentionSectionId = useId();

  const selectedId = searchParams.get('list') ?? '';
  const selectedList = lists.data?.find((list) => list.id === selectedId) ?? null;

  // Keyed on the id and the two raw query results, not on `selectedList` — a
  // derived object whose stability only holds while `data` stays referentially
  // stable between refetches.
  const shopping = useMemo(() => {
    const list = lists.data?.find((candidate) => candidate.id === selectedId);
    return list === undefined || levels.data === undefined
      ? null
      : computeShoppingList(list.lines, levels.data);
  }, [lists.data, selectedId, levels.data]);

  const columns = useMemo(
    () => (shopping === null ? null : splitGroupedColumns(shopping.groups, 3)),
    [shopping],
  );

  if (lists.isPending || levels.isPending) {
    return (
      <>
        <PageHeader title="Shopping" />
        <Spinner label="Loading target stock lists…" />
      </>
    );
  }

  if (lists.isError) {
    return (
      <>
        <PageHeader title="Shopping" />
        <ErrorNotice error={lists.error} onRetry={() => void lists.refetch()} />
      </>
    );
  }

  if (levels.isError) {
    return (
      <>
        <PageHeader title="Shopping" />
        <ErrorNotice error={levels.error} onRetry={() => void levels.refetch()} />
      </>
    );
  }

  const flaggedCount = shopping === null ? 0 : shopping.attention.length + shopping.renamed.length;

  // Only say "everything is stocked" when that is the whole story — a list whose
  // lines are all retired or missing also has no groups, but the reason is the
  // attention section below, not the stock position.
  const everythingStocked =
    shopping !== null && shopping.groups.length === 0 && shopping.attention.length === 0;

  const onCopy = () => {
    if (shopping === null) return;
    void copyToClipboard(shoppingListToPlainText(shopping.groups, shopping.attention)).then(
      (ok) => {
        setCopied(ok);
        showToast(
          ok ? 'Shopping list copied.' : 'Could not copy — the list is on screen to read or print.',
        );
      },
    );
  };

  return (
    <>
      <div className={styles.screenOnly}>
        <PageHeader title="Shopping" />

        {lists.data.length === 0 ? (
          <p>
            There are no target stock lists yet. An administrator sets them up under Target stock
            lists.
          </p>
        ) : (
          <div className={styles.field}>
            <label htmlFor={pickerId}>Choose a target stock list</label>
            <select
              className={styles.select}
              id={pickerId}
              onChange={(event) => {
                const value = event.target.value;
                setSearchParams(
                  (params) => {
                    if (value === '') params.delete('list');
                    else params.set('list', value);
                    return params;
                  },
                  { replace: true },
                );
                setCopied(false);
              }}
              value={selectedId}
            >
              <option value="">Choose a list…</option>
              {lists.data.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {selectedId !== '' && selectedList === null && (
          <p>That target stock list is no longer available. Choose another.</p>
        )}

        {shopping !== null && (
          <>
            {flaggedCount > 0 && (
              <details className={styles.summary}>
                <summary id={summaryId}>
                  {flaggedCount} {flaggedCount === 1 ? 'item needs' : 'items need'} an
                  administrator&rsquo;s attention
                </summary>
                <ul>
                  {shopping.renamed.map((name) => (
                    <li key={`renamed-${name}`}>
                      <strong>{name}</strong> — renamed since it went on the list; still bought
                    </li>
                  ))}
                  {shopping.attention.map((line) => (
                    <li key={`${line.kind}-${line.storedName}`}>
                      <strong>{line.storedName}</strong> (target {line.targetQuantity}) —{' '}
                      {line.kind === 'retired'
                        ? 'retired; not bought'
                        : 'no longer in the catalogue; not bought'}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className={styles.actions}>
              <button
                aria-describedby={flaggedCount > 0 ? summaryId : undefined}
                className={styles.action}
                onClick={() => {
                  window.print();
                }}
                type="button"
              >
                Open print dialog
              </button>
              <button className={styles.action} onClick={onCopy} type="button">
                {copied ? 'Copied' : 'Copy to clipboard'}
              </button>
            </div>
          </>
        )}
      </div>

      {shopping !== null && columns !== null && (
        <div className={styles.sheet}>
          <h2 className={styles.sheetHeading}>Shopping list — {selectedList?.name}</h2>

          {columns.every((column) => column.length === 0) ? (
            <p>
              {everythingStocked
                ? 'Nothing to buy — every item on this list is at or above its target.'
                : 'Nothing to buy from this list — see the items that need an administrator’s attention below.'}
            </p>
          ) : (
            <div className={styles.columns}>
              {columns.map((column, columnIndex) => (
                <div className={styles.column} key={columnIndex}>
                  {column.map((group) => (
                    <div className={styles.categoryGroup} key={group.category}>
                      <h3 className={styles.categoryHeading}>{group.category}</h3>
                      <table className={styles.items}>
                        <tbody>
                          {group.items.map((item) => (
                            <tr key={item.name}>
                              <th scope="row">
                                {item.name}
                                {item.renamedFrom !== null && (
                                  <span className={styles.flag}>
                                    {' '}
                                    <span aria-hidden="true">⚠ </span>was “{item.renamedFrom}”
                                  </span>
                                )}
                              </th>
                              <td className={styles.numeric}>{item.need}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {shopping.attention.length > 0 && (
            <section aria-labelledby={attentionSectionId} className={styles.attention}>
              <h3 id={attentionSectionId}>Needs an administrator&rsquo;s attention — not bought</h3>
              <table className={styles.items}>
                <tbody>
                  {shopping.attention.map((line) => (
                    <tr key={`${line.kind}-${line.storedName}`}>
                      <th scope="row">
                        {line.storedName}
                        <span className={styles.flag}>
                          {' '}
                          <span aria-hidden="true">⚠ </span>
                          {line.kind === 'retired' ? 'retired' : 'no longer in the catalogue'}
                        </span>
                      </th>
                      <td className={styles.numeric}>{line.targetQuantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}

      <Toast message={toastMessage} />
    </>
  );
}
