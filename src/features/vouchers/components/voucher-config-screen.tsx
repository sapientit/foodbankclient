import { useId, useState } from 'react';
import { ErrorNotice } from '../../../components/error-notice';
import { GiftIcon } from '../../../components/icons';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { useSaveVoucherConfig, useVoucherConfig } from '../queries';
import styles from './voucher-config-screen.module.css';

export function VoucherConfigScreen() {
  const config = useVoucherConfig();
  if (config.isPending) return <Spinner label="Loading voucher dates…" />;
  if (config.isError)
    return (
      <ErrorNotice
        error={config.error}
        onRetry={() => {
          void config.refetch();
        }}
      />
    );
  return (
    <VoucherConfigForm
      endDate={config.data.endDate ?? ''}
      startDate={config.data.startDate ?? ''}
    />
  );
}

function VoucherConfigForm({
  endDate: initialEndDate,
  startDate: initialStartDate,
}: {
  endDate: string;
  startDate: string;
}) {
  const save = useSaveVoucherConfig();
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const startId = useId();
  const endId = useId();
  const errorId = useId();

  const invalidRange = startDate !== '' && endDate !== '' && endDate < startDate;
  return (
    <div className={styles.page}>
      <main>
        <div className={styles.headerCard}>
          <PageHeader
            description="Set the session dates during which the Christmas voucher scheme applies."
            icon={<GiftIcon />}
            title="Christmas vouchers"
          />
        </div>
        <form
          className={styles.card}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (invalidRange || startDate === '' || endDate === '') return;
            save.mutate({ startDate, endDate });
          }}
        >
          <div className={styles.field}>
            <label htmlFor={startId}>Voucher start date</label>
            <input
              aria-describedby={invalidRange ? errorId : undefined}
              className={styles.input}
              id={startId}
              onChange={(event) => {
                setStartDate(event.target.value);
              }}
              required
              type="date"
              value={startDate}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={endId}>Voucher end date</label>
            <input
              aria-describedby={invalidRange ? errorId : undefined}
              className={styles.input}
              id={endId}
              onChange={(event) => {
                setEndDate(event.target.value);
              }}
              required
              type="date"
              value={endDate}
            />
          </div>
          {invalidRange && (
            <p className={styles.error} id={errorId} role="alert">
              The end date must not be before the start date.
            </p>
          )}
          {save.error !== null && <ErrorNotice error={save.error} />}
          <button
            className={styles.submit}
            disabled={save.isPending || invalidRange || startDate === '' || endDate === ''}
            type="submit"
          >
            {save.isPending ? 'Saving voucher dates…' : 'Save voucher dates'}
          </button>
        </form>
      </main>
    </div>
  );
}
