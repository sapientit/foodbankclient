import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import * as z from 'zod';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { Spinner } from '../../../components/spinner';
import { ApiError, issuesToFieldErrors } from '../../../lib/errors';
import { formatSessionDate } from '../../../lib/london-time';
import { useAmendSession, useCancelSession, useSession, type Session } from '../queries';
import {
  CAPACITY_BOUNDS,
  DURATION_BOUNDS,
  MAX_CANCEL_REASON_LENGTH,
  MAX_LOCATION_LENGTH,
  SESSION_STATUS_LABELS,
  describeLockedSession,
  describeOccupancy,
  isLocalTime,
  occupancy,
  parseWholeNumber,
} from '../sessions.logic';
import styles from './session-form.module.css';

/**
 * One session: its own fields, its occupancy, and — for whoever opens it —
 * the amend form and the cancel action. **Not role-gated in the component**,
 * the same convention `AmendUserScreen` and `AmendStockItemScreen` follow: the
 * server's `403` on a genuine mutation attempt is the only check that means
 * anything, and this screen makes the same request whoever is looking at it.
 *
 * `GET /sessions/{id}` is real and **not capped by role** (`API.md` §2), so
 * this is a direct fetch rather than a projection over the list the way the
 * users and stock amend screens have to be — see `queries.ts`.
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

const sessionFormSchema = z.object({
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

type SessionFormValues = z.infer<typeof sessionFormSchema>;

export function SessionDetailScreen() {
  const { sessionId = '' } = useParams();
  const session = useSession(sessionId);

  if (session.isPending) {
    return (
      <>
        <PageHeader title="Session" />
        <Spinner label="Loading the session…" />
      </>
    );
  }

  if (session.isError) {
    return (
      <>
        <PageHeader title="Session" />
        <ErrorNotice
          error={session.error}
          onRetry={() => {
            void session.refetch();
          }}
        />
      </>
    );
  }

  return <SessionDetailForm session={session.data} />;
}

function SessionDetailForm({ session }: { session: Session }) {
  const navigate = useNavigate();
  const amend = useAmendSession();
  const cancel = useCancelSession();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

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
  const lockedId = useId();
  const reasonId = useId();

  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<SessionFormValues>({
    resolver: zodResolver(sessionFormSchema),
    // Not reset on failure, so whatever was typed survives a 400.
    defaultValues: {
      sessionDate: session.sessionDate,
      startTime: session.startTime,
      durationMinutes: String(session.durationMinutes),
      location: session.location,
      capacity: String(session.capacity),
    },
  });

  const locked = describeLockedSession(session);
  const stats = occupancy(session);

  const submit = handleSubmit(async (values) => {
    if (locked !== null) return;

    const duration = parseWholeNumber(values.durationMinutes, DURATION_BOUNDS);
    const capacity = parseWholeNumber(values.capacity, CAPACITY_BOUNDS);
    if (!duration.ok || !capacity.ok) return;

    try {
      await amend.mutateAsync({
        id: session.id,
        // Named fields only. `startsAtUtc` is re-derived server-side from
        // these two and must never be sent — there is nothing here to spread
        // from the fetched `session` that could leak it by accident.
        patch: {
          sessionDate: values.sessionDate,
          startTime: values.startTime,
          durationMinutes: duration.value,
          location: values.location,
          capacity: capacity.value,
        },
      });
      await navigate('/sessions');
    } catch (error) {
      applyFieldErrors(error, setError);
    }
  });

  const confirmCancel = () => {
    cancel.mutate(
      { id: session.id, reason },
      {
        onSuccess: () => {
          setCancelling(false);
        },
      },
    );
  };

  return (
    <>
      <PageHeader title={`Session on ${formatSessionDate(session.sessionDate)}`} />

      <dl className={styles.static}>
        <dt>Status</dt>
        <dd>{SESSION_STATUS_LABELS[session.status]}</dd>
        <dt>Booked</dt>
        <dd>
          {describeOccupancy(stats)}
          {stats.isOverCapacity && ' (over capacity)'}
        </dd>
        {session.cancelledReason !== null && (
          <>
            <dt>Cancelled because</dt>
            <dd>{session.cancelledReason}</dd>
          </>
        )}
        {session.isCustomised && (
          <>
            <dt>Weekly template</dt>
            <dd>
              This occurrence has been changed by hand, so the weekly template no longer overwrites
              it.
            </dd>
          </>
        )}
      </dl>

      {locked !== null && (
        <p className={styles.refusal} id={lockedId}>
          {locked}
        </p>
      )}

      {amend.error !== null && !isFieldFailure(amend.error) && <ErrorNotice error={amend.error} />}
      {cancel.error !== null && <ErrorNotice error={cancel.error} />}

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

        <div className={styles.formActions}>
          {/* Refused, not removed: aria-disabled on a real focusable button,
              with the reason attached — the same pattern as the users
              lockout guards. */}
          <button
            aria-describedby={locked === null ? undefined : lockedId}
            aria-disabled={locked !== null}
            className={styles.submit}
            type="submit"
          >
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </button>
          <Link to="/sessions">Cancel</Link>
        </div>
      </form>

      <button
        aria-describedby={locked === null ? undefined : lockedId}
        aria-disabled={locked !== null}
        className={styles.danger}
        onClick={() => {
          if (locked !== null) return;
          setCancelling(true);
        }}
        type="button"
      >
        Cancel this session
      </button>

      {cancelling && (
        <ConfirmDialog
          busy={cancel.isPending}
          confirmLabel="Cancel the session"
          onCancel={() => {
            setCancelling(false);
          }}
          onConfirm={confirmCancel}
          title="Cancel this session?"
        >
          <p>This cannot be undone from here.</p>
          <div className={styles.reasonField}>
            <label htmlFor={reasonId}>Reason (optional)</label>
            <input
              className={styles.input}
              id={reasonId}
              maxLength={MAX_CANCEL_REASON_LENGTH}
              onChange={(event) => {
                setReason(event.target.value);
              }}
              type="text"
              value={reason}
            />
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}

function isFieldFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

function applyFieldErrors(error: unknown, setError: UseFormSetError<SessionFormValues>): void {
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
