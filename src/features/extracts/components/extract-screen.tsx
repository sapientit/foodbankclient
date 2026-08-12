import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { ErrorNotice } from '../../../components/error-notice';
import { PageHeader } from '../../../components/page-header';
import { requestSheetsAccess } from '../google-auth';
import { writeClaim } from '../google-sheets';
import { useCompleteExtractClaim, useExtractClaim, useExtractConfig } from '../queries';

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

export function ExtractScreen() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [batchCount, setBatchCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [runSequence, setRunSequence] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [pendingCompletion, setPendingCompletion] = useState<PendingCompletion | null>(null);
  const accessToken = useRef<string | null>(null);
  const spreadsheetId = useRef<string | null>(null);
  const started = useRef(false);
  const config = useExtractConfig(phase === 'configuring');
  const claim = useExtractClaim();
  const complete = useCompleteExtractClaim();

  useEffect(() => {
    if (phase !== 'configuring' || !config.isSuccess) return;
    queueMicrotask(() => {
      if (
        !config.data.configured ||
        config.data.spreadsheetId === undefined ||
        config.data.googleClientId === undefined
      ) {
        setError(new Error('Spreadsheet extraction is not configured for this deployment.'));
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
        throw new Error('Google Sheets permission is no longer available.');
      await writeClaim(sheet, token, response.claim);
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
  function stop(): void {
    accessToken.current = null;
    spreadsheetId.current = null;
    started.current = false;
    setPhase('idle');
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
            : `Extracting sessions: ${String(totalCount)} completed in this run.`}
        </p>
      )}
      {phase === 'done' && (
        <>
          <p role="status">There are no unextracted confirmed sessions waiting.</p>
          <button onClick={stop} type="button">
            Finish
          </button>
        </>
      )}
      {phase === 'error' && (
        <>
          <ErrorNotice error={error} />
          <button onClick={stop} type="button">
            Finish
          </button>
        </>
      )}
      {phase === 'completion-error' && (
        <>
          <ErrorNotice error={error} />
          <p>The rows may be in the spreadsheet. Google will not be called again.</p>
          <button onClick={() => void retryCompletion()} type="button">
            Try marking this session extracted again
          </button>
          <button onClick={stop} type="button">
            Finish
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
