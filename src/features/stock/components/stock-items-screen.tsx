import { useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { listPathFor, listReturnContext, useReturnedListItem } from '../../../lib/list-return';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { ArchiveIcon, BoxIcon, PencilIcon, RestoreIcon } from '../../../components/icons';
import { ResponsiveIconLabel } from '../../../components/responsive-icon-label';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import {
  useAmendStockItem,
  useCrates,
  useStockItems,
  useStockTakeGroupings,
  type StockItem,
} from '../queries';
import { splitByStatus } from '../stock.logic';
import styles from './stock-items-screen.module.css';

const RETIRED_PARAM = 'retired';

export function StockItemsScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const items = useStockItems();
  const crates = useCrates();
  const groupings = useStockTakeGroupings();
  const amend = useAmendStockItem();
  const [retiring, setRetiring] = useState<StockItem | null>(null);
  const [returnedItemId, returnedItemRef] = useReturnedListItem<HTMLAnchorElement>(
    items.isSuccess && !items.isFetching,
  );

  if (items.isPending || groupings.isPending || crates.isPending)
    return (
      <>
        <StockItemsHeader />
        <Spinner label="Loading stock items…" />
      </>
    );
  if (items.isError)
    return (
      <>
        <StockItemsHeader />
        <ErrorNotice error={items.error} onRetry={() => void items.refetch()} />
      </>
    );
  if (groupings.isError)
    return (
      <>
        <StockItemsHeader />
        <ErrorNotice error={groupings.error} onRetry={() => void groupings.refetch()} />
      </>
    );
  if (crates.isError)
    return (
      <>
        <StockItemsHeader />
        <ErrorNotice error={crates.error} onRetry={() => void crates.refetch()} />
      </>
    );

  const showRetired = searchParams.get(RETIRED_PARAM) === '1';
  const { active, retired } = splitByStatus(items.data);
  const visible = showRetired ? [...active, ...retired] : active;
  const groupingNames = new Map(groupings.data.map((grouping) => [grouping.id, grouping.name]));
  const crateMemberIds = new Set(
    crates.data.flatMap((crate) => crate.members.map((member) => member.stockItemId)),
  );

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
      <StockItemsHeader
        action={
          <Link className="button-link" to="/stock/items/new">
            Add an item
          </Link>
        }
      />
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
          action={
            <Link className="button-link" to="/stock/items/new">
              Add an item
            </Link>
          }
        />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Category</th>
              <th scope="col">Description</th>
              <th scope="col">Shelf</th>
              <th scope="col">Stock-take grouping</th>
              <th scope="col">Packing unit</th>
              <th scope="col">Low-stock threshold</th>
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
                <td>{groupingNameFor(item, groupingNames, crateMemberIds)}</td>
                <td>{packingUnitFor(item)}</td>
                <td>{item.lowStockThreshold ?? 'Not watched'}</td>
                <td>{item.isActive ? 'Active' : 'Retired'}</td>
                <td className={styles.actions}>
                  <Link
                    aria-label={`Amend ${item.name}`}
                    className="button-link button-plain"
                    ref={item.id === returnedItemId ? returnedItemRef : undefined}
                    state={listReturnContext(
                      listPathFor(location.pathname, location.search),
                      item.id,
                    )}
                    to={`/stock/items/${item.id}`}
                    title={`Amend ${item.name}`}
                  >
                    <ResponsiveIconLabel label="Edit">
                      <PencilIcon />
                    </ResponsiveIconLabel>
                  </Link>
                  {item.isActive ? (
                    <button
                      aria-label={`Retire ${item.name}`}
                      className="button-danger button-plain"
                      onClick={() => {
                        setRetiring(item);
                      }}
                      title={`Retire ${item.name}`}
                      type="button"
                    >
                      <ArchiveIcon />
                    </button>
                  ) : (
                    <button
                      aria-label={`Reactivate ${item.name}`}
                      className="button-plain"
                      onClick={() => {
                        setActive(item, true);
                      }}
                      title={`Reactivate ${item.name}`}
                      type="button"
                    >
                      <RestoreIcon />
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

function StockItemsHeader({ action }: { readonly action?: ReactNode } = {}) {
  return (
    <PageHeader
      action={action}
      description={
        <p>
          Maintain the names, categories, descriptions, shelf locations and counting arrangements
          used throughout stock work and pick lists.
        </p>
      }
      icon={<BoxIcon />}
      title="Stock items"
    />
  );
}

/** `groupingId: null` only means a crate count where the loaded crate confirms membership. */
function groupingNameFor(
  item: StockItem,
  names: ReadonlyMap<string, string>,
  crateMemberIds: ReadonlySet<string>,
): string {
  if (item.groupingId === null)
    return crateMemberIds.has(item.id) ? 'Counted by a crate' : 'No stock-take grouping assigned';
  return names.get(item.groupingId) ?? 'Grouping no longer exists';
}

function packingUnitFor(item: StockItem): string {
  if (item.unitsPerPack === null) return 'Individual units';
  const storedLabel = item.packUnitLabel?.trim();
  const label = storedLabel === undefined || storedLabel === '' ? 'packs' : storedLabel;
  return `${String(item.unitsPerPack)}-unit ${label}`;
}
