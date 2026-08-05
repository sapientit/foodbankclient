import { zodResolver } from '@hookform/resolvers/zod';
import { useId } from 'react';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import * as z from 'zod';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { ApiError, issuesToFieldErrors } from '../../../lib/errors';
import { useCreateRecurringSession } from '../queries';
import {
  CAPACITY_BOUNDS,
  DEFAULT_CAPACITY,
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

const createRecurringSessionSchema = z
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
    // Empty means "no end date" — the server's `activeUntil` is nullable, and a
    // blank date input is how that is spelled on this form.
    activeUntil: z.string(),
  })
  .refine((values) => values.activeUntil === '' || values.activeUntil >= values.activeFrom, {
    message: 'The end date cannot be before the start date.',
    path: ['activeUntil'],
  });

type CreateRecurringSessionValues = z.infer<typeof createRecurringSessionSchema>;

/**
 * A new weekly template. Admin only via the menu, unconditionally rendered —
 * see `create-session-screen.tsx` for why that is deliberate rather than an
 * oversight.
 */
export function CreateRecurringSessionScreen() {
  const navigate = useNavigate();
  const create = useCreateRecurringSession();

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
  } = useForm<CreateRecurringSessionValues>({
    resolver: zodResolver(createRecurringSessionSchema),
    defaultValues: {
      name: '',
      weekday: '1',
      startTime: '',
      durationMinutes: '',
      location: '',
      capacity: String(DEFAULT_CAPACITY),
      activeFrom: '',
      activeUntil: '',
    },
  });

  const submit = handleSubmit(async (values) => {
    const duration = parseWholeNumber(values.durationMinutes, DURATION_BOUNDS);
    const capacity = parseWholeNumber(values.capacity, CAPACITY_BOUNDS);
    const weekday = Number(values.weekday);
    if (!duration.ok || !capacity.ok || !isWeekday(weekday)) return;

    try {
      await create.mutateAsync({
        name: values.name,
        weekday,
        startTime: values.startTime,
        durationMinutes: duration.value,
        location: values.location,
        capacity: capacity.value,
        activeFrom: values.activeFrom,
        activeUntil: values.activeUntil === '' ? null : values.activeUntil,
      });
      await navigate('/sessions/recurring');
    } catch (error) {
      applyFieldErrors(error, setError);
    }
  });

  return (
    <>
      <PageHeader title="Add a weekly session" />

      {/*
       * Said here because this is where the wrong expectation forms. Saving this
       * form adds a template and no sessions, so an admin who came to put a
       * session in the diary goes to the sessions list, finds it unchanged, and
       * reasonably concludes the save failed. For a single date they wanted "Add
       * a session" instead, which is one link away.
       */}
      <p className={styles.help}>
        This sets up a session that repeats every week. It does not create any sessions on its own —
        use “Generate sessions now” on the <Link to="/sessions/recurring">weekly sessions</Link>{' '}
        list afterwards, or leave it for the overnight job. For a one-off date, use{' '}
        <Link to="/sessions/new">Add a session</Link> instead.
      </p>

      {create.error !== null && !isFieldFailure(create.error) && (
        <ErrorNotice error={create.error} />
      )}

      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <div className={styles.field}>
          <label htmlFor={nameId}>Name</label>
          <p className={styles.help} id={`${nameId}-help`}>
            For your own reference on this list — it is not shown to a referrer.
          </p>
          <input
            {...register('name')}
            aria-describedby={
              [`${nameId}-help`, errors.name === undefined ? null : nameErrorId]
                .filter((id) => id !== null)
                .join(' ') || undefined
            }
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
          <p className={styles.help} id={`${timeId}-help`}>
            Europe/London wall clock — a 10:00 session stays 10:00 across the clocks changing.
          </p>
          <input
            {...register('startTime')}
            aria-describedby={
              [`${timeId}-help`, errors.startTime === undefined ? null : timeErrorId]
                .filter((id) => id !== null)
                .join(' ') || undefined
            }
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
            {isSubmitting ? 'Adding…' : 'Add weekly session'}
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
  setError: UseFormSetError<CreateRecurringSessionValues>,
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
