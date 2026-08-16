import { zodResolver } from '@hookform/resolvers/zod';
import { useId, type ChangeEvent } from 'react';
import { useForm, useWatch, type UseFormSetError } from 'react-hook-form';
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
  validateDeliveryWindow,
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

const DELIVERY_WINDOW_MESSAGES: Record<
  'start-required' | 'end-required' | 'end-not-after-start',
  string
> = {
  'start-required': 'Enter when the delivery window starts.',
  'end-required': 'Enter when the delivery window ends.',
  'end-not-after-start': 'The delivery window must end after it starts.',
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
    // Required only while `deliveriesAllowed` is on — see `validateDeliveryWindow`.
    deliveryWindowStart: z.string().refine((value) => value === '' || isLocalTime(value), {
      message: 'Enter a time as HH:MM.',
    }),
    deliveryWindowEnd: z.string().refine((value) => value === '' || isLocalTime(value), {
      message: 'Enter a time as HH:MM.',
    }),
    deliveriesAllowed: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (values.activeUntil !== '' && values.activeUntil < values.activeFrom) {
      ctx.addIssue({
        code: 'custom',
        path: ['activeUntil'],
        message: 'The end date cannot be before the start date.',
      });
    }

    const problem = validateDeliveryWindow(
      values.deliveriesAllowed,
      values.deliveryWindowStart,
      values.deliveryWindowEnd,
    );
    if (problem !== null) {
      const path = problem === 'start-required' ? 'deliveryWindowStart' : 'deliveryWindowEnd';
      ctx.addIssue({ code: 'custom', path: [path], message: DELIVERY_WINDOW_MESSAGES[problem] });
    }
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
  const windowStartId = useId();
  const windowStartErrorId = useId();
  const windowEndId = useId();
  const windowEndErrorId = useId();
  const deliveriesAllowedId = useId();

  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
    setValue,
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
      deliveryWindowStart: '',
      deliveryWindowEnd: '',
      // Deliberately **not** the server's own create default of `true` —
      // settled 2026-08-16, same reasoning as `create-session-screen.tsx`.
      deliveriesAllowed: false,
    },
  });

  const deliveriesAllowed = useWatch({ control, name: 'deliveriesAllowed' });

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
        deliveriesAllowed: values.deliveriesAllowed,
        // Omitted entirely for a template that takes no deliveries — see
        // `create-session-screen.tsx`.
        ...(values.deliveriesAllowed
          ? {
              deliveryWindowStart: values.deliveryWindowStart,
              deliveryWindowEnd: values.deliveryWindowEnd,
            }
          : {}),
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

        <div className={styles.field}>
          <label className={styles.checkboxField} htmlFor={deliveriesAllowedId}>
            <input
              {...register('deliveriesAllowed', {
                onChange: (event: ChangeEvent<HTMLInputElement>) => {
                  // Off means no window: the pair is cleared the instant the
                  // box is unticked — see `windowStartId`'s help text.
                  if (!event.target.checked) {
                    setValue('deliveryWindowStart', '');
                    setValue('deliveryWindowEnd', '');
                  }
                },
              })}
              // Points at the delivery times' guidance as well as its own label: while
              // this is unticked those inputs are disabled, so they are skipped by the
              // tab order and by a screen reader's field list, and the sentence saying
              // what ticking it turns on would otherwise be unreachable from here.
              aria-describedby={`${windowStartId}-help`}
              id={deliveriesAllowedId}
              type="checkbox"
            />
            Every occurrence takes deliveries
          </label>
        </div>

        <div className={styles.field}>
          <label htmlFor={windowStartId}>Delivery window starts</label>
          <p className={styles.help} id={`${windowStartId}-help`}>
            Copied onto every occurrence. Both times are required while occurrences take deliveries,
            and are disabled and cleared while they do not.
          </p>
          <input
            {...register('deliveryWindowStart')}
            aria-describedby={
              [
                `${windowStartId}-help`,
                errors.deliveryWindowStart === undefined ? null : windowStartErrorId,
              ]
                .filter((id) => id !== null)
                .join(' ') || undefined
            }
            aria-invalid={errors.deliveryWindowStart === undefined ? undefined : true}
            className={styles.input}
            disabled={!deliveriesAllowed}
            id={windowStartId}
            required={deliveriesAllowed}
            type="time"
          />
          {errors.deliveryWindowStart !== undefined && (
            <p className={styles.fieldError} id={windowStartErrorId}>
              {errors.deliveryWindowStart.message}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={windowEndId}>Delivery window ends</label>
          <input
            {...register('deliveryWindowEnd')}
            aria-describedby={[
              `${windowStartId}-help`,
              errors.deliveryWindowEnd === undefined ? null : windowEndErrorId,
            ]
              .filter((id) => id !== null)
              .join(' ')}
            aria-invalid={errors.deliveryWindowEnd === undefined ? undefined : true}
            className={styles.input}
            disabled={!deliveriesAllowed}
            id={windowEndId}
            required={deliveriesAllowed}
            type="time"
          />
          {errors.deliveryWindowEnd !== undefined && (
            <p className={styles.fieldError} id={windowEndErrorId}>
              {errors.deliveryWindowEnd.message}
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
      path === 'activeUntil' ||
      path === 'deliveryWindowStart' ||
      path === 'deliveryWindowEnd' ||
      path === 'deliveriesAllowed'
    ) {
      setError(path, { message });
    }
  }
}
