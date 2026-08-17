import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { ShowableError } from '../../../lib/errors';
import { requestSheetsAccess } from '../google-auth';
import { writeClaim } from '../google-sheets';
import { useCompleteExtractClaim, useExtractClaim, useExtractConfig } from '../queries';
import { useReferralReasons } from '../../admin-setup/queries';
import { referralFormDefinition } from '../../referrals/referral-form-config';
import { allQuestions, needsOptionSources } from '../../referrals/referral-form-definition';
import { reasonOptionSources } from '../../referrals/referral-lookups';

/**
 * Whether any answer could have been chosen from a maintained lookup, and so is
 * stored as an id the archive must not be given. Read from the shipped
 * configuration, which is where the marker lives.
 */
const ANSWERS_NEED_LOOKUPS = needsOptionSources(allQuestions(referralFormDefinition));

type Phase =
  | 'idle'
  | 'configuring'
  | 'authorising'
  | 'running'
  | 'continue'
  | 'error'
  | 'completion-error'
  | 'done';
interface PendingCompletion {
  claimId: string;
  spreadsheetId: string;
}

/**
 * `12 rows added to Sheets`. Sessions are what the extract works through, but
 * rows are what land in the spreadsheet and what an administrator counts when
 * they go and check it — a session with no referrals on it adds none at all.
 */
function rowsAdded(rows: number): string {
  return `${String(rows)} ${rows === 1 ? 'row' : 'rows'} added to Sheets`;
}

export function ExtractScreen() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [batchCount, setBatchCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  /**
   * Rows appended to the archive, counted **when the Sheets write returns** and
   * not when the session is marked extracted.
   *
   * The two are deliberately different moments. A write that succeeds and a
   * completion that then fails leaves rows in the spreadsheet against a session
   * still queued — that is the intended failure direction, and it is exactly
   * when somebody needs to know how many rows went in, because they are the
   * ones that will be duplicated by the next run.
   */
  const [rowCount, setRowCount] = useState(0);
  const [runSequence, setRunSequence] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [pendingCompletion, setPendingCompletion] = useState<PendingCompletion | null>(null);
  const accessToken = useRef<string | null>(null);
  const spreadsheetId = useRef<string | null>(null);
  const started = useRef(false);
  const config = useExtractConfig(phase === 'configuring');
  const claim = useExtractClaim();
  const complete = useCompleteExtractClaim();
  /*
   * The reason lookup, so an answer chosen from it is archived as the words it
   * was chosen by. The admin list rather than the public one — this screen is
   * an administrator's, and only that list names a retired reason, which is
   * exactly what an archive of past referrals is full of.
   */
  const reasons = useReferralReasons(ANSWERS_NEED_LOOKUPS);

  useEffect(() => {
    if (phase !== 'configuring' || !config.isSuccess) return;
    queueMicrotask(() => {
      if (
        !config.data.configured ||
        config.data.spreadsheetId === undefined ||
        config.data.googleClientId === undefined
      ) {
        setError(
          new ShowableError('Spreadsheet extraction is not configured for this deployment.'),
        );
        setPhase('error');
        return;
      }
      spreadsheetId.current = config.data.spreadsheetId;
      setPhase('authorising');
      void requestSheetsAccess(config.data.googleClientId)
        .then((token) => {
          accessToken.current = token;
          setPhase('running');
        })
        .catch((reason: unknown) => {
          setError(reason);
          setPhase('error');
        });
    });
  }, [config.data, config.isSuccess, phase]);

  async function extractNext(): Promise<void> {
    try {
      const response = await claim.mutateAsync();
      if (response.claim === null) {
        setPhase('done');
        return;
      }
      const token = accessToken.current;
      const sheet = spreadsheetId.current;
      if (token === null || sheet === null)
        throw new ShowableError('Google Sheets permission is no longer available.');
      // Nothing is written without the lookup: a row already in the archive
      // cannot be corrected from here, so an unresolved id would stay one.
      if (ANSWERS_NEED_LOOKUPS && reasons.data === undefined)
        throw new ShowableError(
          'The reasons for referral could not be loaded. Nothing was written.',
        );
      await writeClaim(sheet, token, response.claim, reasonOptionSources(reasons.data ?? []));
      // One archive row per referral on the session, and they are in the sheet
      // now — counted here rather than after the mark, which may yet fail.
      const written = response.claim.rows.length;
      setRowCount((count) => count + written);
      try {
        await complete.mutateAsync(response.claim.claimId);
      } catch (reason) {
        setPendingCompletion({ claimId: response.claim.claimId, spreadsheetId: sheet });
        setError(reason);
        setPhase('completion-error');
        return;
      }
      setBatchCount((count) => count + 1);
      setTotalCount((count) => count + 1);
      if (batchCount + 1 >= 20) setPhase('continue');
      else setRunSequence((sequence) => sequence + 1);
    } catch (reason) {
      setError(reason);
      setPhase('error');
    }
  }

  async function retryCompletion(): Promise<void> {
    if (pendingCompletion === null) return;
    try {
      await complete.mutateAsync(pendingCompletion.claimId);
      setPendingCompletion(null);
      setBatchCount((count) => count + 1);
      setTotalCount((count) => count + 1);
      if (batchCount + 1 >= 20) setPhase('continue');
      else {
        setPhase('running');
        setRunSequence((sequence) => sequence + 1);
      }
    } catch (reason) {
      setError(reason);
    }
  }

  useEffect(() => {
    if (phase !== 'running') return;
    queueMicrotask(() => {
      void extractNext();
    });
    // `runSequence` is deliberately the trigger; the loop advances it only
    // after a completed server mark, so no Sheets write is retried here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, runSequence]);
  function start(): void {
    if (started.current) return;
    started.current = true;
    setError(null);
    setBatchCount(0);
    setPhase('configuring');
  }
  /**
   * Ends the run. **The counts go back to zero with it**, because `stop` drops
   * the Google token and the next run therefore has to ask for consent again —
   * and a non-zero total is what tells the confirmation dialog it is continuing
   * an authorised run rather than beginning one. Leaving them behind meant
   * stopping and starting again skipped consent and then failed on a token the
   * screen no longer held.
   */
  function stop(): void {
    accessToken.current = null;
    spreadsheetId.current = null;
    started.current = false;
    setBatchCount(0);
    setTotalCount(0);
    setRowCount(0);
    setPhase('idle');
  }

  /**
   * Picks the run back up after a failure, without going round the confirmation
   * and the Google consent prompt again where they still hold.
   *
   * **It claims the next waiting session, not the one that just failed.** That
   * one is already reserved to this browser and cannot be claimed again until
   * its ten minutes are up, at which point it returns to the queue on its own.
   * So this is "carry on with the rest", not "have another go at that" — which
   * is also why nothing here retries the Google write itself.
   *
   * A failure before consent — no spreadsheet configured, Google refusing — has
   * no token to carry on with, so that starts again from the top rather than
   * from a permission this screen does not hold.
   */
  function retryRun(): void {
    setError(null);
    if (accessToken.current === null || spreadsheetId.current === null) {
      setPhase('configuring');
      return;
    }
    setPhase('running');
    setRunSequence((sequence) => sequence + 1);
  }

  return (
    <>
      <PageHeader title="Spreadsheet extract" />
      <p>
        Send confirmed sessions to the food bank&rsquo;s Google spreadsheet. This sends household
        details outside this system.
      </p>
      {phase === 'idle' && (
        <button
          onClick={() => {
            setPhase('continue');
          }}
          type="button"
        >
          Start extract
        </button>
      )}
      {(phase === 'configuring' || phase === 'authorising' || phase === 'running') && (
        <p role="status">
          {phase === 'authorising'
            ? 'Waiting for Google Sheets permission…'
            : `Extracting sessions: ${String(totalCount)} completed in this run, ${rowsAdded(rowCount)}.`}
        </p>
      )}
      {phase === 'done' && (
        <>
          <p role="status">
            There are no unextracted confirmed sessions waiting. {String(totalCount)} extracted in
            this run, {rowsAdded(rowCount)}.
          </p>
          <button onClick={stop} type="button">
            Finish
          </button>
        </>
      )}
      {phase === 'error' && (
        <>
          <ErrorNotice error={error} />
          {/* What the run actually left behind. "Nothing was marked extracted"
              is the reassurance somebody needs before they go and look at the
              spreadsheet, and the row count is what they compare it against —
              rows can be in the sheet on a session that is still queued. */}
          <p>
            No session was marked extracted by this failure, and any session claimed for it returns
            to the queue within ten minutes. {rowsAdded(rowCount)} before it stopped.
          </p>
          {/* "Finish" said this run had finished, on a screen that had just
              failed to do it — which is why it was believed to be what marked
              sessions extracted. It never wrote anything; it says what it does
              now. Carrying on picks up the next waiting session, not the one
              that failed: see `retryRun`. */}
          <button onClick={retryRun} type="button">
            Try again
          </button>
          <button onClick={stop} type="button">
            Stop extracting
          </button>
        </>
      )}
      {phase === 'completion-error' && (
        <>
          <ErrorNotice error={error} />
          <p>
            The rows may be in the spreadsheet. Google will not be called again.{' '}
            {rowsAdded(rowCount)} in this run.
          </p>
          <button onClick={() => void retryCompletion()} type="button">
            Try marking this session extracted again
          </button>
          {/* Leaving here genuinely leaves work undone — rows written, session
              still queued — so this must not say "Finish" either. */}
          <button onClick={stop} type="button">
            Stop extracting
          </button>
        </>
      )}
      {phase === 'continue' && (
        <ConfirmDialog
          confirmLabel={totalCount === 0 ? 'Continue' : 'Continue extracting'}
          onCancel={stop}
          onConfirm={() => {
            if (totalCount === 0) start();
            else {
              setBatchCount(0);
              setPhase('running');
              setRunSequence((sequence) => sequence + 1);
            }
          }}
          title={totalCount === 0 ? 'This might take some time' : 'Continue extracting?'}
        >
          <p>
            {totalCount === 0
              ? 'Do you want to continue? You will then be asked separately for Google Sheets permission.'
              : `Twenty sessions have been extracted. Do you want to continue?`}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
