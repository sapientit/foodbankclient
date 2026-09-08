import { useId, useState } from 'react';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import {
  useAmendStockTakeGrouping,
  useCreateStockTakeGrouping,
  useStockTakeGroupings,
  type StockTakeGrouping,
} from '../queries';
import styles from './stock-items-screen.module.css';

/** Administrator maintenance for the named sections used by the grouped stock take. */
export function StockGroupingsScreen() {
  const groupings = useStockTakeGroupings();
  const create = useCreateStockTakeGrouping();
  const amend = useAmendStockTakeGrouping();
  const inputId = useId();
  const [name, setName] = useState('');
  const [newError, setNewError] = useState<string | null>(null);

  if (groupings.isPending)
    return (
      <>
        <PageHeader title="Stock-take groupings" />
        <Spinner label="Loading stock-take groupings…" />
      </>
    );
  if (groupings.isError)
    return (
      <>
        <PageHeader title="Stock-take groupings" />
        <ErrorNotice error={groupings.error} onRetry={() => void groupings.refetch()} />
      </>
    );

  const add = async () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setNewError('Enter a grouping name.');
      return;
    }
    try {
      await create.mutateAsync(trimmed);
      setName('');
      setNewError(null);
    } catch {
      // The mutation error below has the server's useful message.
    }
  };

  return (
    <>
      <PageHeader title="Stock-take groupings" />
      <p className={styles.intro}>
        A stock take is run one grouping at a time. Items not counted by a crate are assigned to one
        of these groupings.
      </p>
      {(create.error !== null || amend.error !== null) && (
        <ErrorNotice error={create.error ?? amend.error} />
      )}
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {groupings.data.map((grouping) => (
            <GroupingRow grouping={grouping} key={grouping.id} />
          ))}
        </tbody>
      </table>
      <div className={styles.actions}>
        <label htmlFor={inputId}>New grouping name</label>
        <input
          id={inputId}
          onChange={(event) => {
            setName(event.target.value);
            setNewError(null);
          }}
          type="text"
          value={name}
        />
        <button disabled={create.isPending} onClick={() => void add()} type="button">
          {create.isPending ? 'Adding…' : 'Add grouping'}
        </button>
      </div>
      {newError !== null && <p role="alert">{newError}</p>}
    </>
  );
}

function GroupingRow({ grouping }: { readonly grouping: StockTakeGrouping }) {
  const amend = useAmendStockTakeGrouping();
  const id = useId();
  const [name, setName] = useState(grouping.name);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setError('Enter a grouping name.');
      return;
    }
    try {
      await amend.mutateAsync({ id: grouping.id, name: trimmed });
      setError(null);
    } catch {
      /* shown below */
    }
  };
  return (
    <tr>
      <td>
        <label className="visually-hidden" htmlFor={id}>
          Name for {grouping.name}
        </label>
        <input
          id={id}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          type="text"
          value={name}
        />
        {error !== null && <p role="alert">{error}</p>}
      </td>
      <td>
        <button disabled={amend.isPending} onClick={() => void save()} type="button">
          Save
        </button>
        {amend.error !== null && <ErrorNotice error={amend.error} />}
      </td>
    </tr>
  );
}
