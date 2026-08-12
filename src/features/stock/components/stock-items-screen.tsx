import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { useAmendStockItem, useStockItems, type StockItem } from '../queries';
import { splitByStatus } from '../stock.logic';
import styles from './stock-items-screen.module.css';

const RETIRED_PARAM = 'retired';

export function StockItemsScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const items = useStockItems();
  const amend = useAmendStockItem();
  const [retiring, setRetiring] = useState<StockItem | null>(null);

  if (items.isPending)
    return (
      <>
        <PageHeader title="Stock items" />
        <Spinner label="Loading stock items…" />
      </>
    );
  if (items.isError)
    return (
      <>
        <PageHeader title="Stock items" />
        <ErrorNotice error={items.error} onRetry={() => void items.refetch()} />
      </>
    );

  const showRetired = searchParams.get(RETIRED_PARAM) === '1';
  const { active, retired } = splitByStatus(items.data);
  const visible = showRetired ? [...active, ...retired] : active;

  const setActive = (item: StockItem, isActive: boolean) => {
    amend.mutate(
      { id: item.id, patch: { isActive } },
      {
        onSuccess: () => {
          setRetiring(null);
        },
      },
    );
  };

  return (
    <>
      <PageHeader
        title="Stock items"
        action={
          <Link className={styles.add} to="/stock/items/new">
            Add an item
          </Link>
        }
      />
      <p className={styles.intro}>
        Maintain the names, categories, descriptions and shelf locations used throughout stock work
        and pick lists.
      </p>
      {amend.error !== null && <ErrorNotice error={amend.error} />}
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
          sentence="Add the first item to start the list."
          action={<Link to="/stock/items/new">Add an item</Link>}
        />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Category</th>
              <th scope="col">Description</th>
              <th scope="col">Shelf</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.id}>
                <th scope="row">{item.name}</th>
                <td>{item.category}</td>
                <td>{item.description ?? ''}</td>
                <td>{item.shelfNumber}</td>
                <td>{item.isActive ? 'Active' : 'Retired'}</td>
                <td className={styles.actions}>
                  <Link to={`/stock/items/${item.id}`}>Amend</Link>
                  {item.isActive ? (
                    <button
                      onClick={() => {
                        setRetiring(item);
                      }}
                      type="button"
                    >
                      Retire
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setActive(item, true);
                      }}
                      type="button"
                    >
                      Reactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {retiring !== null && (
        <ConfirmDialog
          busy={amend.isPending}
          confirmLabel="Retire"
          onCancel={() => {
            setRetiring(null);
          }}
          onConfirm={() => {
            setActive(retiring, false);
          }}
          title={`Retire ${retiring.name}?`}
        >
          <p>
            This does not delete the item or change past stock records. You can reactivate it later.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
