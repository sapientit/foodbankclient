import * as z from 'zod';
import { ShowableError } from '../../lib/errors';
import { parseReferralFormConfig } from '../referrals/referral-form-config';
import type { ReferralFormDefinition } from '../referrals/referral-form-definition';
import { parsePreferenceRuleConfig, validatePreferenceRules } from '../pick-lists/preference-rules';
import type { PreferenceRule } from '../pick-lists/preference-rules';
import type { StockItem } from '../stock/queries';

const manifestSchema = z.object({
  version: z.number(),
  generationId: z.string().min(1),
  generatedAt: z.string().min(1),
  questionnaireSha256: z.string().min(1),
  rulesSha256: z.string().min(1),
});

export type ConfigurationManifest = z.infer<typeof manifestSchema>;

/**
 * Parses the manifest the Apps Script writes and checks it is a manifest at
 * all. This says nothing about whether it matches the downloaded payloads —
 * see `manifestMatchesPayloads` for that, which is the check that actually
 * catches a stale one.
 */
export function parseConfigurationManifest(raw: string): ConfigurationManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ShowableError(
      'The generation manifest is not valid JSON. Generate the configuration release again and try uploading it.',
    );
  }
  const result = manifestSchema.safeParse(parsed);
  if (!result.success)
    throw new ShowableError(
      'The generation manifest is missing something the uploader needs. Generate the configuration release again and try uploading it.',
    );
  return result.data;
}

/** Lowercase hex SHA-256, matching the Apps Script's own `sha256Hex_` exactly. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether the freshly downloaded Questionnaire and Rules JSON are the exact
 * bytes the manifest was generated from. Running an older individual
 * generator, hand-editing a generated cell after the fact, or reading a
 * stale manifest all show up here — this is the whole reason the manifest
 * exists, and nothing downstream should be trusted without it passing first.
 */
export async function manifestMatchesPayloads(
  manifest: ConfigurationManifest,
  questionnaire: string,
  rules: string,
): Promise<boolean> {
  const [questionnaireHash, rulesHash] = await Promise.all([
    sha256Hex(questionnaire),
    sha256Hex(rules),
  ]);
  return questionnaireHash === manifest.questionnaireSha256 && rulesHash === manifest.rulesSha256;
}

export interface ConfigurationReleaseValidation {
  readonly errors: readonly string[];
  readonly definition?: ReferralFormDefinition;
  readonly rules?: readonly PreferenceRule[];
}

/**
 * The uploader's own check, run here rather than trusted from the workbook:
 * structural and compatibility validation of the questionnaire, then the
 * same rule-reference and current-stock checks the Rule check screen already
 * runs — against this freshly downloaded version, not the live one. Stops at
 * the first kind of failure, since a broken questionnaire makes the rules
 * unreadable in its terms.
 */
export function validateConfigurationRelease(
  questionnaireRaw: string,
  rulesRaw: string,
  stockItems: readonly StockItem[],
): ConfigurationReleaseValidation {
  let definition: ReferralFormDefinition;
  try {
    definition = parseReferralFormConfig(JSON.parse(questionnaireRaw));
  } catch (error) {
    return { errors: [`Questionnaire: ${describeParseError(error)}`] };
  }

  let parsedRules: { readonly rules: readonly PreferenceRule[] };
  try {
    parsedRules = parsePreferenceRuleConfig(JSON.parse(rulesRaw));
  } catch (error) {
    return { errors: [`Rules: ${describeParseError(error)}`] };
  }

  const health = validatePreferenceRules(stockItems, parsedRules.rules, definition);
  return { errors: health.errors, definition, rules: parsedRules.rules };
}

function describeParseError(error: unknown): string {
  if (error instanceof SyntaxError) return 'is not valid JSON.';
  if (error instanceof z.ZodError)
    return `does not match the required shape (${error.issues[0]?.message ?? 'invalid'}).`;
  return error instanceof Error ? error.message : 'is invalid.';
}
