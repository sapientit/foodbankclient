import type { ConfigurationRelease } from '../configuration-releases/queries';
import type { Referral } from '../referrals/queries';
import { parseReferralFormConfig } from '../referrals/referral-form-config';
import type { OptionSources, ReferralFormDefinition } from '../referrals/referral-form-definition';
import type { StockItem } from '../stock/queries';
import {
  buildPickListInformation,
  pickListInformationNeedsOptionSources,
  type PickListInformation,
} from './pick-list-information';
import {
  parsePreferenceRuleConfig,
  resolveHistoricPreferenceLines,
  resolvePreferenceLines,
  validatePreferenceRules,
  type PreferenceRule,
} from './preference-rules';

/**
 * Grouping and per-release dispatch for pick-list generation across referrals
 * that do not all share one release — see
 * `docs/planning/versioned-configuration-releases.md`, "Pick-list
 * generation". Nothing here fetches: a caller collects the distinct `formId`s
 * with `distinctFormIds`, fetches them in one bulk call, and hands the result
 * to `parseReleases` and then `resolvePickListBody`.
 */

export interface ParsedRelease {
  readonly formId: string;
  readonly status: ConfigurationRelease['status'];
  readonly definition: ReferralFormDefinition;
  readonly rules: readonly PreferenceRule[];
}

/** The distinct, real `formId`s among a set of referrals, for one bulk read. */
export function distinctFormIds(referrals: readonly Pick<Referral, 'formId'>[]): readonly string[] {
  const ids = new Set<string>();
  for (const referral of referrals) {
    // `?? null` rather than trusting the type: a referral with no known
    // release must never poison the bulk read with a bad query value.
    const formId = referral.formId ?? null;
    if (formId !== null) ids.add(formId);
  }
  return [...ids];
}

/**
 * Parses a bulk read's releases into what generation needs. Throws if a
 * release is missing `rules` — absent only in a fuel administrator's read,
 * and this screen is never that role's.
 */
export function parseReleases(releases: readonly ConfigurationRelease[]): readonly ParsedRelease[] {
  return releases.map((release) => {
    if (release.rules === undefined) {
      throw new Error(`Release ${release.formId} has no rules to evaluate.`);
    }
    return {
      formId: release.formId,
      status: release.status,
      definition: parseReferralFormConfig(JSON.parse(release.questionnaire) as unknown),
      rules: parsePreferenceRuleConfig(JSON.parse(release.rules) as unknown).rules,
    };
  });
}

/** Whether any of these releases marks a pick-list-information question that chooses from a lookup. */
export function anyReleaseNeedsOptionSources(releases: readonly ParsedRelease[]): boolean {
  return releases.some((release) => pickListInformationNeedsOptionSources(release.definition));
}

export interface ResolvedPickListBody {
  readonly preferenceLines: readonly {
    referralId: string;
    lines: { stockItemId: string; quantity: number }[];
  }[];
  readonly pickListInformation: readonly PickListInformation[];
}

/**
 * Groups referrals by the release named by their own `formId` and evaluates
 * each group with that release's own questionnaire and rules.
 *
 * **The `published` release is validated and, on a failure, blocks
 * generation entirely** — unchanged from before this release was fetched
 * rather than bundled; a caller with a synchronous pre-check to run (so this
 * never throws where it matters — see `run-sessions-screen.tsx`) runs the
 * same `validatePreferenceRules` call itself first. Every other release is
 * resolved leniently: an item it names that is no longer active is dropped
 * and noted rather than treated as a fault, per "Historic unavailable stock".
 *
 * A referral whose `formId` is `null`, or names a release the bulk read did
 * not return, resolves to no preference lines and no picker note — there is
 * no known structure to evaluate a rule against, the same "genuinely unknown
 * legacy data" fallback `referral-detail-screen` applies to display.
 */
export function resolvePickListBody(
  referrals: readonly Referral[],
  stockItems: readonly StockItem[],
  releases: readonly ParsedRelease[],
  sources: OptionSources,
): ResolvedPickListBody {
  const byFormId = new Map(releases.map((release) => [release.formId, release] as const));

  for (const release of releases) {
    if (release.status !== 'published') continue;
    const health = validatePreferenceRules(stockItems, release.rules, release.definition);
    if (health.errors.length > 0) {
      throw new Error(`Preference rule configuration is invalid: ${health.errors.join(' ')}`);
    }
  }

  const byRelease = new Map<string, Referral[]>();
  for (const referral of referrals) {
    const formId = referral.formId ?? null;
    if (formId === null || !byFormId.has(formId)) continue;
    const bucket = byRelease.get(formId);
    if (bucket === undefined) byRelease.set(formId, [referral]);
    else bucket.push(referral);
  }

  const preferenceLines: ResolvedPickListBody['preferenceLines'][number][] = [];
  const pickListInformation: PickListInformation[] = [];
  const unavailableStockByReferralId = new Map<string, readonly string[]>();

  for (const [formId, group] of byRelease) {
    // Present by construction: `formId` came from `byFormId`'s own keys.
    const release = byFormId.get(formId);
    if (release === undefined) continue;

    if (release.status === 'published') {
      preferenceLines.push(
        ...resolvePreferenceLines(group, stockItems, release.rules, release.definition),
      );
    } else {
      for (const result of resolveHistoricPreferenceLines(group, stockItems, release.rules)) {
        if (result.lines.length > 0) {
          preferenceLines.push({ referralId: result.referralId, lines: [...result.lines] });
        }
        if (result.unavailableStock.length > 0) {
          unavailableStockByReferralId.set(result.referralId, result.unavailableStock);
        }
      }
    }

    pickListInformation.push(
      ...buildPickListInformation(group, sources, release.definition, unavailableStockByReferralId),
    );
  }

  return { preferenceLines, pickListInformation };
}
