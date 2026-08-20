import { zodResolver } from '@hookform/resolvers/zod';
import { useId, type ChangeEvent } from 'react';
import { useForm, useWatch, type UseFormSetError } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import * as z from 'zod';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { ApiError, issuesToFieldErrors } from '../../../lib/errors';
import { useCreateSession } from '../queries';
import {
  CAPACITY_BOUNDS,
  DEFAULT_CAPACITY,
  DELIVERY_CAPACITY_BOUNDS,
  DURATION_BOUNDS,
  MAX_LOCATION_LENGTH,
  isLocalTime,
  parseWholeNumber,
  validateDeliveryCapacity,
  validateDeliveryWindow,
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

const DELIVERY_CAPACITY_MESSAGES: Record<string, string> = {
  empty: 'Enter how many households this session can deliver to, or 0 for none.',
  'not-a-whole-number': 'Use a whole number of households, for example 5, or 0 for none.',
  'below-minimum': 'Delivery capacity cannot be negative.',
  'above-maximum': 'Use 1000 or fewer.',
};

// Named rather than inlined so `applyFieldErrors` below can name it too — the
// server has no `deliveryWindowStart`/`deliveryWindowEnd` field errors of its
// own to map back (both share one client-side check), but the constant keeps
// the three prose strings in one place regardless.
const DELIVERY_WINDOW_MESSAGES: Record<
  'start-required' | 'end-required' | 'end-not-after-start',
  string
> = {
  'start-required': 'Enter when the delivery window starts.',
  'end-required': 'Enter when the delivery window ends.',
  'end-not-after-start': 'The delivery window must end after it starts.',
};

const createSessionSchema = z
  .object({
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
    // Required only while the delivery capacity is above nought — see
    // `validateDeliveryWindow`. Each box still has to look like a time when it
    // is not empty, same rule as `startTime`.
    deliveryWindowStart: z.string().refine((value) => value === '' || isLocalTime(value), {
      message: 'Enter a time as HH:MM.',
    }),
    deliveryWindowEnd: z.string().refine((value) => value === '' || isLocalTime(value), {
      message: 'Enter a time as HH:MM.',
    }),
    deliveryCapacity: z.string().superRefine((value, ctx) => {
      const parsed = parseWholeNumber(value, DELIVERY_CAPACITY_BOUNDS);
      if (!parsed.ok) {
        ctx.addIssue({ code: 'custom', message: DELIVERY_CAPACITY_MESSAGES[parsed.problem] });
      }
    }),
  })
  .superRefine((values, ctx) => {
    const capacity = parseWholeNumber(values.capacity, CAPACITY_BOUNDS);
    const deliveryCapacity = parseWholeNumber(values.deliveryCapacity, DELIVERY_CAPACITY_BOUNDS);

    const problem = validateDeliveryWindow(
      deliveryCapacity.ok && deliveryCapacity.value > 0,
      values.deliveryWindowStart,
      values.deliveryWindowEnd,
    );
    if (problem !== null) {
      const path = problem === 'start-required' ? 'deliveryWindowStart' : 'deliveryWindowEnd';
      ctx.addIssue({ code: 'custom', path: [path], message: DELIVERY_WINDOW_MESSAGES[problem] });
    }

    // Only checked once both numbers parse — a box that already fails on its
    // own already says why, and stacking a second, cross-field complaint on
    // top of it is noise for the same box.
    if (capacity.ok && deliveryCapacity.ok) {
      const capacityProblem = validateDeliveryCapacity(capacity.value, deliveryCapacity.value);
      if (capacityProblem !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['deliveryCapacity'],
          message: 'A session cannot have more delivery places than places.',
        });
      }
    }
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
  const windowStartId = useId();
  const windowStartErrorId = useId();
  const windowEndId = useId();
  const windowEndErrorId = useId();
  const deliveryCapacityId = useId();
  const deliveryCapacityErrorId = useId();

  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
    setValue,
  } = useForm<CreateSessionValues>({
    resolver: zodResolver(createSessionSchema),
    defaultValues: {
      sessionDate: '',
      startTime: '',
      durationMinutes: '',
      location: '',
      capacity: String(DEFAULT_CAPACITY),
      deliveryWindowStart: '',
      deliveryWindowEnd: '',
      // Nought, settled 2026-08-16: a driver is the exception rather than the
      // assumption, and a session wrongly set to deliver promises a round
      // nobody is doing. The server used to default this on, which is what
      // this deliberately contradicted; it now requires the figure outright
      // and defaults to nothing, so what is being said here is only that an
      // untouched box means no deliveries.
      deliveryCapacity: '0',
    },
  });

  const deliveryCapacityText = useWatch({ control, name: 'deliveryCapacity' });
  const parsedDeliveryCapacity = parseWholeNumber(deliveryCapacityText, DELIVERY_CAPACITY_BOUNDS);
  const takesDeliveries = parsedDeliveryCapacity.ok && parsedDeliveryCapacity.value > 0;

  const submit = handleSubmit(async (values) => {
    const duration = parseWholeNumber(values.durationMinutes, DURATION_BOUNDS);
    const capacity = parseWholeNumber(values.capacity, CAPACITY_BOUNDS);
    const deliveryCapacity = parseWholeNumber(values.deliveryCapacity, DELIVERY_CAPACITY_BOUNDS);
    if (!duration.ok || !capacity.ok || !deliveryCapacity.ok) return;

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
        deliveryCapacity: deliveryCapacity.value,
        // Omitted entirely for a session that takes no deliveries — never a
        // window for a session with nobody to drive. The validation above
        // already requires both boxes once the delivery capacity is above
        // nought, so by the time this runs it is either nought (omit both) or
        // both a time (send both).
        ...(deliveryCapacity.value > 0
          ? {
              deliveryWindowStart: values.deliveryWindowStart,
              deliveryWindowEnd: values.deliveryWindowEnd,
            }
          : {}),
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

        <div className={styles.field}>
          <label htmlFor={deliveryCapacityId}>Delivery capacity</label>
          <p className={styles.help} id={`${deliveryCapacityId}-help`}>
            Households, not people — and must not exceed the session’s capacity. Nought means this
            session takes no deliveries.
          </p>
          <input
            {...register('deliveryCapacity', {
              onChange: (event: ChangeEvent<HTMLInputElement>) => {
                // Off means no window: the pair is cleared the instant the
                // typed value parses to nought, not left stale for a later
                // submit to paper over — see `windowStartId`'s help text.
                const parsed = parseWholeNumber(event.target.value, DELIVERY_CAPACITY_BOUNDS);
                if (parsed.ok && parsed.value === 0) {
                  setValue('deliveryWindowStart', '');
                  setValue('deliveryWindowEnd', '');
                }
              },
            })}
            aria-describedby={
              [
                `${deliveryCapacityId}-help`,
                `${windowStartId}-help`,
                errors.deliveryCapacity === undefined ? null : deliveryCapacityErrorId,
              ]
                .filter((id) => id !== null)
                .join(' ') || undefined
            }
            aria-invalid={errors.deliveryCapacity === undefined ? undefined : true}
            autoComplete="off"
            className={styles.input}
            id={deliveryCapacityId}
            inputMode="numeric"
            type="text"
          />
          {errors.deliveryCapacity !== undefined && (
            <p className={styles.fieldError} id={deliveryCapacityErrorId}>
              {errors.deliveryCapacity.message}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor={windowStartId}>Delivery window starts</label>
          <p className={styles.help} id={`${windowStartId}-help`}>
            Both times are required while the delivery capacity is above nought, and are disabled
            and cleared while it is not.
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
            disabled={!takesDeliveries}
            id={windowStartId}
            required={takesDeliveries}
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
            disabled={!takesDeliveries}
            id={windowEndId}
            required={takesDeliveries}
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
      path === 'capacity' ||
      path === 'deliveryWindowStart' ||
      path === 'deliveryWindowEnd' ||
      path === 'deliveryCapacity'
    ) {
      setError(path, { message });
    }
  }
}
