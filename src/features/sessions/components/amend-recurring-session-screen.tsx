import { zodResolver } from '@hookform/resolvers/zod';
import { useId } from 'react';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import * as z from 'zod';
import { EmptyState } from '../../../components/empty-state';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { ApiError, issuesToFieldErrors } from '../../../lib/errors';
import { useAmendRecurringSession, useRecurringSession, type RecurringSession } from '../queries';
import {
  CAPACITY_BOUNDS,
  DURATION_BOUNDS,
  MAX_LOCATION_LENGTH,
  MAX_RECURRING_NAME_LENGTH,
  WEEKDAY_OPTIONS,
  isLocalTime,
  isWeekday,
  parseWholeNumber,
} from '../sessions.logic';
import styles from './session-form.module.css';

const DURATION_MESSAGES: Record<string, string> = {
  empty: 'Enter how long each session runs, in minutes.',
  'not-a-whole-number': 'Use a whole number of minutes, for example 90.',
  'below-minimum': 'A session has to last at least a minute.',
  'above-maximum': 'Use 1440 minutes (24 hours) or fewer.',
};

const CAPACITY_MESSAGES: Record<string, string> = {
  empty: 'Enter how many households each session can take.',
  'not-a-whole-number': 'Use a whole number of households, for example 25.',
  'below-minimum': 'Capacity cannot be negative.',
  'above-maximum': 'Use 1000 or fewer.',
};

const amendRecurringSessionSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Give this weekly session a name.')
      .max(MAX_RECURRING_NAME_LENGTH, 'Use 120 characters or fewer.'),
    weekday: z.string().refine((value) => isWeekday(Number(value)), 'Choose a day.'),
    startTime: z.string().refine(isLocalTime, 'Enter a time as HH:MM.'),
    durationMinutes: z.string().superRefine((value, ctx) => {
      const parsed = parseWholeNumber(value, DURATION_BOUNDS);
      if (!parsed.ok) ctx.addIssue({ code: 'custom', message: DURATION_MESSAGES[parsed.problem] });
    }),
    location: z
      .string()
      .trim()
      .min(1, 'Enter where this session happens.')
      .max(MAX_LOCATION_LENGTH, 'Use 200 characters or fewer.'),
    capacity: z.string().superRefine((value, ctx) => {
      const parsed = parseWholeNumber(value, CAPACITY_BOUNDS);
      if (!parsed.ok) ctx.addIssue({ code: 'custom', message: CAPACITY_MESSAGES[parsed.problem] });
    }),
    activeFrom: z.string().min(1, 'Choose when this weekly session starts.'),
    activeUntil: z.string(),
  })
  .refine((values) => values.activeUntil === '' || values.activeUntil >= values.activeFrom, {
    message: 'The end date cannot be before the start date.',
    path: ['activeUntil'],
  });

type AmendRecurringSessionValues = z.infer<typeof amendRecurringSessionSchema>;

/**
 * Amend a weekly template. **There is no `GET /recurring-sessions/{id}`**, so —
 * exactly like `AmendUserScreen` — this is a `select` projection over the one
 * list query rather than a fetch of its own. See `useRecurringSession`.
 *
 * Amending here does not touch any session already generated from this
 * template; see the module comment on `recurring-sessions-screen.tsx`.
 */
export function AmendRecurringSessionScreen() {
  const { recurringSessionId = '' } = useParams();
  const target = useRecurringSession(recurringSessionId);

  if (target.isPending) {
    return (
      <>
        <PageHeader title="Amend a weekly session" />
        <Spinner label="Loading the weekly session…" />
      </>
    );
  }

  if (target.isError) {
    return (
      <>
        <PageHeader title="Amend a weekly session" />
        <ErrorNotice
          error={target.error}
          onRetry={() => {
            void target.refetch();
          }}
        />
      </>
    );
  }

  if (target.data === null) {
    return (
      <>
        <PageHeader title="Amend a weekly session" />
        <EmptyState
          action={<Link to="/sessions/recurring">Back to weekly sessions</Link>}
          headline="That weekly session is not in the list"
          sentence="The link may be out of date."
        />
      </>
    );
  }

  return <AmendRecurringSessionForm row={target.data} />;
}

function AmendRecurringSessionForm({ row }: { row: RecurringSession }) {
  const navigate = useNavigate();
  const amend = useAmendRecurringSession();

  const nameId = useId();
  const nameErrorId = useId();
  const weekdayId = useId();
  const weekdayErrorId = useId();
  const timeId = useId();
  const timeErrorId = useId();
  const durationId = useId();
  const durationErrorId = useId();
  const locationId = useId();
  const locationErrorId = useId();
  const capacityId = useId();
  const capacityErrorId = useId();
  const fromId = useId();
  const fromErrorId = useId();
  const untilId = useId();
  const untilErrorId = useId();

  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<AmendRecurringSessionValues>({
    resolver: zodResolver(amendRecurringSessionSchema),
    defaultValues: {
      name: row.name,
      weekday: String(row.weekday),
      startTime: row.startTime,
      durationMinutes: String(row.durationMinutes),
      location: row.location,
      capacity: String(row.capacity),
      activeFrom: row.activeFrom,
      activeUntil: row.activeUntil ?? '',
    },
  });

  const submit = handleSubmit(async (values) => {
    const duration = parseWholeNumber(values.durationMinutes, DURATION_BOUNDS);
    const capacity = parseWholeNumber(values.capacity, CAPACITY_BOUNDS);
    const weekday = Number(values.weekday);
    if (!duration.ok || !capacity.ok || !isWeekday(weekday)) return;

    try {
      await amend.mutateAsync({
        id: row.id,
        patch: {
          name: values.name,
          weekday,
          startTime: values.startTime,
          durationMinutes: duration.value,
          location: values.location,
          capacity: capacity.value,
          activeFrom: values.activeFrom,
          activeUntil: values.activeUntil === '' ? null : values.activeUntil,
        },
      });
      await navigate('/sessions/recurring');
    } catch (error) {
      applyFieldErrors(error, setError);
    }
  });

  return (
    <>
      <PageHeader title={`Amend ${row.name}`} />

      {amend.error !== null && !isFieldFailure(amend.error) && <ErrorNotice error={amend.error} />}

      <p className={styles.help}>
        This does not change any session already generated from this template — only the ones the
        weekly cron creates from here on.
      </p>

      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <div className={styles.field}>
          <label htmlFor={nameId}>Name</label>
          <input
            {...register('name')}
            aria-describedby={errors.name === undefined ? undefined : nameErrorId}
            aria-invalid={errors.name === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={nameId}
            maxLength={MAX_RECURRING_NAME_LENGTH}
            type="text"
          />
          {errors.name !== undefined && (
            <p className={styles.fieldError} id={nameErrorId}>
              {errors.name.message}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={weekdayId}>Day of the week</label>
          <select
            {...register('weekday')}
            aria-describedby={errors.weekday === undefined ? undefined : weekdayErrorId}
            className={styles.input}
            id={weekdayId}
          >
            {WEEKDAY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {errors.weekday !== undefined && (
            <p className={styles.fieldError} id={weekdayErrorId}>
              {errors.weekday.message}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={timeId}>Start time</label>
          <input
            {...register('startTime')}
            aria-describedby={errors.startTime === undefined ? undefined : timeErrorId}
            aria-invalid={errors.startTime === undefined ? undefined : true}
            className={styles.input}
            id={timeId}
            type="time"
          />
          {errors.startTime !== undefined && (
            <p className={styles.fieldError} id={timeErrorId}>
              {errors.startTime.message}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={durationId}>Duration (minutes)</label>
          <input
            {...register('durationMinutes')}
            aria-describedby={errors.durationMinutes === undefined ? undefined : durationErrorId}
            aria-invalid={errors.durationMinutes === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={durationId}
            inputMode="numeric"
            type="text"
          />
          {errors.durationMinutes !== undefined && (
            <p className={styles.fieldError} id={durationErrorId}>
              {errors.durationMinutes.message}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={locationId}>Location</label>
          <input
            {...register('location')}
            aria-describedby={errors.location === undefined ? undefined : locationErrorId}
            aria-invalid={errors.location === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={locationId}
            maxLength={MAX_LOCATION_LENGTH}
            type="text"
          />
          {errors.location !== undefined && (
            <p className={styles.fieldError} id={locationErrorId}>
              {errors.location.message}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={capacityId}>Capacity</label>
          <input
            {...register('capacity')}
            aria-describedby={errors.capacity === undefined ? undefined : capacityErrorId}
            aria-invalid={errors.capacity === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={capacityId}
            inputMode="numeric"
            type="text"
          />
          {errors.capacity !== undefined && (
            <p className={styles.fieldError} id={capacityErrorId}>
              {errors.capacity.message}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={fromId}>Starts from</label>
          <input
            {...register('activeFrom')}
            aria-describedby={errors.activeFrom === undefined ? undefined : fromErrorId}
            aria-invalid={errors.activeFrom === undefined ? undefined : true}
            className={styles.input}
            id={fromId}
            type="date"
          />
          {errors.activeFrom !== undefined && (
            <p className={styles.fieldError} id={fromErrorId}>
              {errors.activeFrom.message}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={untilId}>Ends after (optional)</label>
          <p className={styles.help} id={`${untilId}-help`}>
            Leave blank for a weekly session with no planned end.
          </p>
          <input
            {...register('activeUntil')}
            aria-describedby={
              [`${untilId}-help`, errors.activeUntil === undefined ? null : untilErrorId]
                .filter((id) => id !== null)
                .join(' ') || undefined
            }
            aria-invalid={errors.activeUntil === undefined ? undefined : true}
            className={styles.input}
            id={untilId}
            type="date"
          />
          {errors.activeUntil !== undefined && (
            <p className={styles.fieldError} id={untilErrorId}>
              {errors.activeUntil.message}
            </p>
          )}
        </div>

        <div className={styles.formActions}>
          <button className={styles.submit} type="submit">
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </button>
          <Link to="/sessions/recurring">Cancel</Link>
        </div>
      </form>
    </>
  );
}

function isFieldFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

function applyFieldErrors(
  error: unknown,
  setError: UseFormSetError<AmendRecurringSessionValues>,
): void {
  if (!isFieldFailure(error) || !(error instanceof ApiError)) return;

  for (const [path, message] of Object.entries(issuesToFieldErrors(error))) {
    if (
      path === 'name' ||
      path === 'weekday' ||
      path === 'startTime' ||
      path === 'durationMinutes' ||
      path === 'location' ||
      path === 'capacity' ||
      path === 'activeFrom' ||
      path === 'activeUntil'
    ) {
      setError(path, { message });
    }
  }
}
