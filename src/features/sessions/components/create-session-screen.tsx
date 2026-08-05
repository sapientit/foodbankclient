import { zodResolver } from '@hookform/resolvers/zod';
import { useId } from 'react';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import * as z from 'zod';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { ApiError, issuesToFieldErrors } from '../../../lib/errors';
import { useCreateSession } from '../queries';
import {
  CAPACITY_BOUNDS,
  DEFAULT_CAPACITY,
  DURATION_BOUNDS,
  MAX_LOCATION_LENGTH,
  isLocalTime,
  parseWholeNumber,
} from '../sessions.logic';
import styles from './session-form.module.css';

/**
 * Add an ad hoc session — one that belongs to no weekly template, so the
 * materialisation cron never touches it. Admin only, **and this form does not
 * check that**: it renders for whoever opens `/sessions/new`, the same way
 * `CreateUserScreen` and `CreateStockItemScreen` do. Only the menu keeps a team
 * lead from finding the link; the server's `403` on submit is the real gate,
 * and `create-session-forbidden.test.tsx` is what proves the request still
 * gets made rather than being swallowed by a client-side check.
 */

const DURATION_MESSAGES: Record<string, string> = {
  empty: 'Enter how long the session runs, in minutes.',
  'not-a-whole-number': 'Use a whole number of minutes, for example 90.',
  'below-minimum': 'A session has to last at least a minute.',
  'above-maximum': 'Use 1440 minutes (24 hours) or fewer.',
};

const CAPACITY_MESSAGES: Record<string, string> = {
  empty: 'Enter how many households this session can take.',
  'not-a-whole-number': 'Use a whole number of households, for example 25.',
  'below-minimum': 'Capacity cannot be negative.',
  'above-maximum': 'Use 1000 or fewer.',
};

const createSessionSchema = z.object({
  sessionDate: z.string().min(1, 'Choose a date.'),
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
});

type CreateSessionValues = z.infer<typeof createSessionSchema>;

export function CreateSessionScreen() {
  const navigate = useNavigate();
  const create = useCreateSession();

  const dateId = useId();
  const dateErrorId = useId();
  const timeId = useId();
  const timeErrorId = useId();
  const durationId = useId();
  const durationErrorId = useId();
  const locationId = useId();
  const locationErrorId = useId();
  const capacityId = useId();
  const capacityErrorId = useId();

  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<CreateSessionValues>({
    resolver: zodResolver(createSessionSchema),
    defaultValues: {
      sessionDate: '',
      startTime: '',
      durationMinutes: '',
      location: '',
      capacity: String(DEFAULT_CAPACITY),
    },
  });

  const submit = handleSubmit(async (values) => {
    const duration = parseWholeNumber(values.durationMinutes, DURATION_BOUNDS);
    const capacity = parseWholeNumber(values.capacity, CAPACITY_BOUNDS);
    if (!duration.ok || !capacity.ok) return;

    try {
      /*
       * Named fields only — never a spread of anything the server sent back.
       * `startsAtUtc` is derived server-side from `sessionDate` and `startTime`
       * and must never be sent; building this object field-by-field is what
       * makes that structurally true rather than a rule to remember.
       */
      await create.mutateAsync({
        sessionDate: values.sessionDate,
        startTime: values.startTime,
        durationMinutes: duration.value,
        location: values.location,
        capacity: capacity.value,
      });
      await navigate('/sessions');
    } catch (error) {
      applyFieldErrors(error, setError);
    }
  });

  return (
    <>
      <PageHeader title="Add a session" />

      {create.error !== null && !isFieldFailure(create.error) && (
        <ErrorNotice error={create.error} />
      )}

      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <div className={styles.field}>
          <label htmlFor={dateId}>Date</label>
          <input
            {...register('sessionDate')}
            aria-describedby={errors.sessionDate === undefined ? undefined : dateErrorId}
            aria-invalid={errors.sessionDate === undefined ? undefined : true}
            className={styles.input}
            id={dateId}
            type="date"
          />
          {errors.sessionDate !== undefined && (
            <p className={styles.fieldError} id={dateErrorId}>
              {errors.sessionDate.message}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={timeId}>Start time</label>
          <p className={styles.help} id={`${timeId}-help`}>
            The Europe/London wall clock time, exactly as it should be announced — this stays put
            across the clocks changing.
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
          <p className={styles.help} id={`${capacityId}-help`}>
            Households, not people — a session of 25 takes 25 referrals however large each household
            is.
          </p>
          <input
            {...register('capacity')}
            aria-describedby={
              [`${capacityId}-help`, errors.capacity === undefined ? null : capacityErrorId]
                .filter((id) => id !== null)
                .join(' ') || undefined
            }
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

        <div className={styles.formActions}>
          <button className={styles.submit} type="submit">
            {isSubmitting ? 'Adding…' : 'Add session'}
          </button>
          <Link to="/sessions">Cancel</Link>
        </div>
      </form>
    </>
  );
}

function isFieldFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

function applyFieldErrors(error: unknown, setError: UseFormSetError<CreateSessionValues>): void {
  if (!isFieldFailure(error) || !(error instanceof ApiError)) return;

  for (const [path, message] of Object.entries(issuesToFieldErrors(error))) {
    if (
      path === 'sessionDate' ||
      path === 'startTime' ||
      path === 'durationMinutes' ||
      path === 'location' ||
      path === 'capacity'
    ) {
      setError(path, { message });
    }
  }
}
