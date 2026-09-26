import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { ErrorNotice } from '../../../components/error-notice';
import { PublishIcon } from '../../../components/icons';
import { PageHeader } from '../../../components/page-header';
import { ShowableError } from '../../../lib/errors';
import { preloadSheetsAccess, requestSheetsAccess } from '../../../lib/google-auth';
import { formatLondonDateTime } from '../../../lib/london-time';
import { useStockItems } from '../../stock/queries';
import { readGeneratedRelease } from '../configuration-release-sheet';
import {
  manifestMatchesPayloads,
  parseConfigurationManifest,
  validateConfigurationRelease,
  type ConfigurationManifest,
} from '../configuration-release.logic';
import {
  useConfigurationWorkbookConfig,
  usePublishConfigurationRelease,
  useUploadConfigurationRelease,
} from '../queries';
import styles from './publish-referral-form-screen.module.css';

/**
 * The plan's own "short-lived, read-only Google access" — narrower than the
 * spreadsheet extract's read-write scope, since this screen only ever reads
 * the workbook. See `lib/google-auth.ts`.
 */
const READONLY_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

type Phase =
  | 'idle'
  | 'authorising'
  | 'reading'
  | 'confirming'
  | 'validating'
  | 'invalid'
  | 'uploading'
  | 'done'
  | 'error';

interface DownloadedRelease {
  readonly spreadsheetId: string;
  readonly questionnaire: string;
  readonly rules: string;
  readonly manifest: ConfigurationManifest;
}

/**
 * `screenDetails.md`, "Referral form releases". A description and one
 * button: read the workbook, confirm the manifest's generation date and
 * time, validate against today's questionnaire rules and today's stock, then
 * upload and publish in the same action. No draft review, no history list
 * and no rollback control here — the server keeps all three, but a
 * correction is made by fixing the workbook and pressing the button again.
 */
export function PublishReferralFormScreen() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<unknown>(null);
  const [validationErrors, setValidationErrors] = useState<readonly string[]>([]);
  const [publishedFormId, setPublishedFormId] = useState<string | null>(null);
  const [gisReady, setGisReady] = useState(false);
  // The manifest is small and drives the confirmation dialog, so it is state.
  // The questionnaire/rules text never renders and is read only from event
  // handlers, so it stays in a ref rather than causing a render on arrival —
  // reading a ref during render is what the manifest used to do here too,
  // which is exactly the bug this split fixes.
  const [manifest, setManifest] = useState<ConfigurationManifest | null>(null);
  const downloaded = useRef<DownloadedRelease | null>(null);

  const config = useConfigurationWorkbookConfig(true);
  const stockItems = useStockItems();
  const upload = useUploadConfigurationRelease();
  const publish = usePublishConfigurationRelease();

  // GIS must be ready before the button is pressed, not after: loading its
  // script asynchronously between the click and the consent popup loses the
  // gesture Safari otherwise ties the popup to. Same reasoning as the
  // spreadsheet extract screen.
  useEffect(() => {
    void preloadSheetsAccess().then(
      () => {
        setGisReady(true);
      },
      () => {
        // The button stays disabled; a later retry would lose the gesture again.
      },
    );
  }, []);

  function reset(): void {
    downloaded.current = null;
    setManifest(null);
    setError(null);
    setValidationErrors([]);
    setPublishedFormId(null);
    setPhase('idle');
  }

  function begin(): void {
    if (
      !config.data?.configured ||
      config.data.spreadsheetId === undefined ||
      config.data.googleClientId === undefined
    ) {
      setError(
        new ShowableError('Publishing the referral form is not configured for this deployment.'),
      );
      setPhase('error');
      return;
    }
    const { spreadsheetId, googleClientId } = config.data;
    setPhase('authorising');
    requestSheetsAccess(googleClientId, READONLY_SHEETS_SCOPE)
      .then((token) => readAndConfirm(spreadsheetId, token))
      .catch((reason: unknown) => {
        setError(reason);
        setPhase('error');
      });
  }

  async function readAndConfirm(spreadsheetId: string, accessToken: string): Promise<void> {
    setPhase('reading');
    try {
      const release = await readGeneratedRelease(spreadsheetId, accessToken);
      const manifest = parseConfigurationManifest(release.manifestRaw);
      const matches = await manifestMatchesPayloads(manifest, release.questionnaire, release.rules);
      if (!matches)
        throw new ShowableError(
          'The downloaded Questionnaire and Rules no longer match the generation manifest. Generate the configuration release again and try uploading it.',
        );
      downloaded.current = {
        spreadsheetId,
        questionnaire: release.questionnaire,
        rules: release.rules,
        manifest,
      };
      setManifest(manifest);
      setPhase('confirming');
    } catch (reason) {
      setError(reason);
      setPhase('error');
    }
  }

  async function confirmAndPublish(): Promise<void> {
    const release = downloaded.current;
    // Validating against an empty stock list, because the levels have not
    // arrived yet, would fail every rule that names a real item — a false
    // refusal rather than a true one. The dialog's `busy` state is what stops
    // this being reachable while `stockItems` is still pending.
    if (release === null || stockItems.data === undefined) return;
    setPhase('validating');

    const validation = validateConfigurationRelease(
      release.questionnaire,
      release.rules,
      stockItems.data,
    );
    if (validation.errors.length > 0) {
      setValidationErrors(validation.errors);
      setPhase('invalid');
      return;
    }

    setPhase('uploading');
    try {
      const draft = await upload.mutateAsync({
        questionnaire: release.questionnaire,
        rules: release.rules,
        questionnaireHash: release.manifest.questionnaireSha256,
        rulesHash: release.manifest.rulesSha256,
        generationId: release.manifest.generationId,
        generatedAt: release.manifest.generatedAt,
        sourceWorkbookId: release.spreadsheetId,
      });
      await publish.mutateAsync(draft.formId);
      setPublishedFormId(draft.formId);
      setPhase('done');
    } catch (reason) {
      setError(reason);
      setPhase('error');
    }
  }

  const generatedAt = manifest?.generatedAt ?? null;

  return (
    <div className={styles.page}>
      <div className={styles.headerCard}>
        <PageHeader
          description={
            <p>
              Reads the charity&rsquo;s configuration workbook, checks it against today&rsquo;s
              stock and questions, and makes it the referral form and preference rules everyone uses
              from then on.
            </p>
          }
          icon={<PublishIcon />}
          title="Publish referral form"
        />
      </div>
      <section aria-labelledby="publish-heading" className={styles.panel}>
        <h2 id="publish-heading">Fetch and publish the latest version</h2>
        {phase === 'idle' && (
          <button disabled={!gisReady} onClick={begin} type="button">
            Fetch and publish the latest version
          </button>
        )}
        {(phase === 'authorising' || phase === 'reading') && (
          <p className={styles.progress} role="status">
            {phase === 'authorising'
              ? 'Waiting for Google Sheets permission…'
              : 'Reading the configuration workbook…'}
          </p>
        )}
        {(phase === 'validating' || phase === 'uploading') && (
          <p className={styles.progress} role="status">
            {phase === 'validating' ? 'Checking the new version…' : 'Publishing…'}
          </p>
        )}
        {phase === 'invalid' && (
          <div className={styles.results} role="alert">
            <p>This version cannot be published:</p>
            <ul>
              {validationErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
            <p>Fix the workbook and press the button again.</p>
            <button onClick={reset} type="button">
              Try again
            </button>
          </div>
        )}
        {phase === 'done' && (
          <div className={styles.results} role="status">
            <p>The new version is now live.</p>
            {publishedFormId !== null && <p>Version id: {publishedFormId}</p>}
            <button onClick={reset} type="button">
              Done
            </button>
          </div>
        )}
        {phase === 'error' && (
          <>
            <ErrorNotice error={error} />
            <button onClick={reset} type="button">
              Try again
            </button>
          </>
        )}
      </section>
      {phase === 'confirming' && generatedAt !== null && (
        <ConfirmDialog
          busy={stockItems.isPending || stockItems.isError}
          confirmLabel="Publish this version"
          onCancel={reset}
          onConfirm={() => void confirmAndPublish()}
          title="Publish this version?"
        >
          {stockItems.isError ? (
            <ErrorNotice error={stockItems.error} onRetry={() => void stockItems.refetch()} />
          ) : stockItems.isPending ? (
            <p>Loading current stock…</p>
          ) : (
            <p>
              This configuration was generated on{' '}
              <strong>{formatLondonDateTime(generatedAt)}</strong>. Is this the version to make
              live?
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
