import { useState } from 'react';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { useSaveVoucherConfig, useVoucherConfig } from '../queries';

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

  const invalidRange = startDate !== '' && endDate !== '' && endDate < startDate;
  return (
    <main>
      <PageHeader title="Christmas vouchers" />
      <p>Set the session dates during which the Christmas voucher scheme applies.</p>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (invalidRange || startDate === '' || endDate === '') return;
          save.mutate({ startDate, endDate });
        }}
      >
        <p>
          <label>
            Voucher start date
            <input
              aria-describedby={invalidRange ? 'voucher-date-error' : undefined}
              onChange={(event) => {
                setStartDate(event.target.value);
              }}
              required
              type="date"
              value={startDate}
            />
          </label>
        </p>
        <p>
          <label>
            Voucher end date
            <input
              aria-describedby={invalidRange ? 'voucher-date-error' : undefined}
              onChange={(event) => {
                setEndDate(event.target.value);
              }}
              required
              type="date"
              value={endDate}
            />
          </label>
        </p>
        {invalidRange && (
          <p id="voucher-date-error" role="alert">
            The end date must not be before the start date.
          </p>
        )}
        {save.error !== null && <ErrorNotice error={save.error} />}
        <button
          disabled={save.isPending || invalidRange || startDate === '' || endDate === ''}
          type="submit"
        >
          {save.isPending ? 'Saving voucher dates…' : 'Save voucher dates'}
        </button>
      </form>
    </main>
  );
}
