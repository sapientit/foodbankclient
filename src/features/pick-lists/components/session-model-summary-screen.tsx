import { useState } from 'react';
import { useParams } from 'react-router';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { copyToClipboard } from '../../../lib/clipboard';
import { useSessionModelSummary } from '../queries';
import styles from './session-model-summary-screen.module.css';

type Order = 'model' | 'pick-number';

function collectionMethod(answers: Readonly<Record<string, unknown>>): string {
  const value = answers['Collection method'];
  return typeof value === 'string' ? value : '';
}

function dietaryRequirement(answers: Readonly<Record<string, unknown>>): string {
  const value = answers['Dietary Req'];
  return typeof value === 'string' ? value : '';
}

/** Current-grid parcel names for the session, intentionally not a parcel history. */
export function SessionModelSummaryScreen() {
  const { sessionId = '' } = useParams();
  const summary = useSessionModelSummary(sessionId);
  const [order, setOrder] = useState<Order>('model');
  const [copied, setCopied] = useState(false);

  if (summary.isPending)
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Model summary" />
        </div>
        <Spinner label="Loading model summary…" />
      </div>
    );
  if (summary.isError)
    return (
      <div className={styles.page}>
        <div className={styles.headerCard}>
          <PageHeader title="Model summary" />
        </div>
        <ErrorNotice
          error={summary.error}
          onRetry={() => {
            void summary.refetch();
          }}
        />
      </div>
    );

  const households = [...summary.data.households].sort((left, right) => {
    const pick = (value: number | null) => value ?? Number.MAX_SAFE_INTEGER;
    if (order === 'pick-number') return pick(left.pickNumber) - pick(right.pickNumber);
    const model = (left.modelParcelName ?? '').localeCompare(right.modelParcelName ?? '');
    return model === 0 ? pick(left.pickNumber) - pick(right.pickNumber) : model;
  });
  const adults = households.reduce((total, household) => total + household.adults, 0);
  const children = households.reduce((total, household) => total + household.children, 0);
  const copy = async () => {
    if (order !== 'model') return;
    const rows = households
      .map((household) =>
        [
          household.pickNumber === null ? '' : `#${String(household.pickNumber)}`,
          household.modelParcelName ?? '',
          [household.refereeFirstName, household.refereeSurname].filter(Boolean).join(' '),
          collectionMethod(household.answers),
          dietaryRequirement(household.answers),
        ].join('\t'),
      )
      .join('\n');
    const header = ['Pick #', 'Model name', 'Client', 'Collection method', 'Dietary Req'].join(
      '\t',
    );
    setCopied(await copyToClipboard(`${header}\n${rows}`));
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader title="Model summary" />
      </div>
      <section className={styles.detailsCard} aria-label="Model summary">
        <p>Current parcel-grid lookup for this session.</p>
        <p>
          <label>
            Order by{' '}
            <select
              value={order}
              onChange={(event) => {
                setOrder(event.target.value as Order);
              }}
            >
              <option value="model">Model name</option>
              <option value="pick-number">Pick-list number</option>
            </select>
          </label>{' '}
          <button disabled={order !== 'model'} onClick={() => void copy()} type="button">
            {copied ? 'Copied' : 'Copy model summary'}
          </button>
        </p>
        <p>
          Total adults: <strong>{adults}</strong>. Total children: <strong>{children}</strong>.
        </p>
        <div className={styles.tableWrap} role="region" aria-label="Model summary table">
          <table>
            <thead>
              <tr>
                <th scope="col">Pick #</th>
                <th scope="col">Model name</th>
                <th scope="col">Client</th>
                <th scope="col">Collection method</th>
                <th scope="col">Dietary Req</th>
                <th scope="col">Children</th>
                <th scope="col">Adults</th>
              </tr>
            </thead>
            <tbody>
              {households.map((household, index) => (
                <tr
                  key={`${String(household.pickNumber ?? 'none')}-${household.refereeFirstName ?? ''}-${household.refereeSurname ?? ''}-${String(index)}`}
                >
                  <td>
                    {household.pickNumber === null ? '—' : `#${String(household.pickNumber)}`}
                  </td>
                  <td>{household.modelParcelName ?? 'Not configured'}</td>
                  <th scope="row">
                    {[household.refereeFirstName, household.refereeSurname]
                      .filter(Boolean)
                      .join(' ') || 'Unknown'}
                  </th>
                  <td>{collectionMethod(household.answers)}</td>
                  <td>{dietaryRequirement(household.answers)}</td>
                  <td>{household.children}</td>
                  <td>{household.adults}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
