import * as z from 'zod';
import rawConfig from './preference-rules.config.json';
import {
  allQuestions,
  type DynamicQuestion,
  type ReferralFormDefinition,
} from '../referrals/referral-form-definition';
import { referralFormDefinition } from '../referrals/referral-form-config';
import type { Referral } from '../referrals/queries';
import type { StockItem } from '../stock/queries';
import { normaliseStockItemName } from '../stock/stock.logic';

const stockSchema = z.union([z.string().min(1), z.literal('$selectedAnswer')]);
const lineSchema = z.object({
  stock: stockSchema,
  quantity: z.union([z.literal(-1), z.number().int().min(1).max(10)]),
});
const outcomeSchema = z.object({ set: z.array(lineSchema).min(1) });
const ruleSchema = z
  .object({
    when: z.object({ key: z.string().min(1), hasAnswer: z.string().min(1).optional() }),
    cases: z
      .array(
        z.object({
          familySize: z.object({
            people: z.enum(['adults', 'children', 'total']),
            atLeast: z.number().int().min(0),
          }),
          set: z.array(lineSchema).min(1),
        }),
      )
      .optional(),
    otherwise: outcomeSchema.optional(),
  })
  .superRefine((rule, context) => {
    if (rule.cases === undefined && rule.otherwise === undefined) {
      context.addIssue({ code: 'custom', message: 'A rule needs cases and/or otherwise.' });
    }
    if (rule.cases !== undefined && rule.otherwise === undefined) {
      context.addIssue({ code: 'custom', message: 'Rules with cases need otherwise.' });
    }
    if (rule.when.hasAnswer === '$selectedAnswer') {
      context.addIssue({
        code: 'custom',
        path: ['when', 'hasAnswer'],
        message: '$selectedAnswer may only be used as a stock item.',
      });
    }
  });

const configSchema = z.object({ rules: z.array(ruleSchema) });
export type PreferenceRule = z.infer<typeof ruleSchema>;

/** Parses generated rule JSON before it is allowed into the running client. */
export function parsePreferenceRuleConfig(value: unknown): {
  readonly rules: readonly PreferenceRule[];
} {
  return configSchema.parse(value);
}

export const preferenceRuleConfig = parsePreferenceRuleConfig(rawConfig);

export interface PreferenceRuleHealth {
  readonly errors: readonly string[];
}

/** Validates questionnaire references and environment-specific stock names. */
export function validatePreferenceRules(
  stockItems: readonly StockItem[],
  rules: readonly PreferenceRule[] = preferenceRuleConfig.rules,
  definition: ReferralFormDefinition = referralFormDefinition,
): PreferenceRuleHealth {
  const preferences = new Map(
    allQuestions(definition)
      .filter(
        (question): question is DynamicQuestion =>
          question.type !== 'keyField' && question.type !== 'information' && question.preference,
      )
      .map((question) => [question.key, question]),
  );
  const activeByName = activeStockItemsByName(stockItems);
  const remainingOptions = new Map<string, readonly string[]>();
  const errors: string[] = [];
  for (const rule of rules) {
    const question = preferences.get(rule.when.key);
    if (question === undefined) {
      errors.push(`Rule ${rule.when.key}: the preference question does not exist.`);
      continue;
    }
    if (
      rule.when.hasAnswer !== undefined &&
      question.type === 'choice' &&
      !question.options.some((option) => option.value === rule.when.hasAnswer)
    ) {
      errors.push(`Rule ${rule.when.key}: ${rule.when.hasAnswer} is not an offered answer.`);
    }
    for (const line of ruleLines(rule)) {
      if (line.stock === '$selectedAnswer') {
        if (question.type !== 'choice') {
          errors.push(`Rule ${rule.when.key}: $selectedAnswer needs a choice preference question.`);
          continue;
        }
        const options =
          remainingOptions.get(question.key) ?? question.options.map((option) => option.value);
        remainingOptions.set(question.key, options);
        const unavailable = options.filter(
          (answer) => activeByName.get(normaliseStockItemName(answer))?.length !== 1,
        );
        if (unavailable.length > 0)
          errors.push(
            `Rule ${rule.when.key}: $selectedAnswer cannot resolve active stock items for ${unavailable.join(', ')}.`,
          );
      } else if (activeByName.get(normaliseStockItemName(line.stock))?.length !== 1) {
        errors.push(
          `Rule ${rule.when.key}: active stock item ${line.stock} does not exist uniquely.`,
        );
      }
    }
    if (question.type === 'choice') {
      const options =
        remainingOptions.get(question.key) ?? question.options.map((option) => option.value);
      remainingOptions.set(
        question.key,
        rule.when.hasAnswer === undefined
          ? []
          : options.filter((answer) => answer !== rule.when.hasAnswer),
      );
    }
  }
  // A rule can use $selectedAnswer in both a Case and its Otherwise outcome.
  // The configuration fault belongs to the rule/question pair, not each line,
  // and duplicate messages would also make React list keys collide.
  return { errors: [...new Set(errors)] };
}

export function resolvePreferenceLines(
  referrals: readonly Pick<Referral, 'id' | 'adults' | 'children' | 'answers'>[],
  stockItems: readonly StockItem[],
  rules: readonly PreferenceRule[] = preferenceRuleConfig.rules,
  definition: ReferralFormDefinition = referralFormDefinition,
): { referralId: string; lines: { stockItemId: string; quantity: number }[] }[] {
  const health = validatePreferenceRules(stockItems, rules, definition);
  if (health.errors.length > 0)
    throw new Error(`Preference rule configuration is invalid: ${health.errors.join(' ')}`);
  const activeByName = activeStockItemsByName(stockItems);
  return referrals.flatMap((referral) => {
    const lines = new Map<string, number>();
    const remainingAnswers = new Map<string, string[]>();
    for (const rule of rules) {
      const answers = remainingAnswers.get(rule.when.key) ?? [
        ...selectedAnswers(referral.answers[rule.when.key]),
      ];
      remainingAnswers.set(rule.when.key, answers);
      for (const selectedAnswer of [...answers]) {
        if (rule.when.hasAnswer !== undefined && selectedAnswer !== rule.when.hasAnswer) continue;
        const outcome = firstOutcome(rule, referral);
        if (outcome === undefined) continue;
        for (const line of outcome.set) {
          const item = activeByName.get(
            normaliseStockItemName(line.stock === '$selectedAnswer' ? selectedAnswer : line.stock),
          )?.[0];
          if (item === undefined) continue;
          const oldQuantity = lines.get(item.id);
          lines.set(
            item.id,
            oldQuantity === -1 || line.quantity === -1 ? -1 : (oldQuantity ?? 0) + line.quantity,
          );
        }
        // Rules are deliberately ordered. Once one has dealt with this answer,
        // later rules for the same preference see only the unanswered choices.
        remainingAnswers.set(
          rule.when.key,
          answers.filter((answer) => answer !== selectedAnswer),
        );
      }
    }
    return lines.size === 0
      ? []
      : [
          {
            referralId: referral.id,
            lines: [...lines].map(([stockItemId, quantity]) => ({ stockItemId, quantity })),
          },
        ];
  });
}

function selectedAnswers(value: unknown): readonly string[] {
  if (typeof value === 'string') return value === '' ? [] : [value];
  return Array.isArray(value)
    ? value.filter((answer): answer is string => typeof answer === 'string')
    : [];
}

function firstOutcome(rule: PreferenceRule, referral: Pick<Referral, 'adults' | 'children'>) {
  const total = referral.adults + referral.children;
  const match = rule.cases?.find(({ familySize }) => {
    const value =
      familySize.people === 'adults'
        ? referral.adults
        : familySize.people === 'children'
          ? referral.children
          : total;
    return value >= familySize.atLeast;
  });
  return match ?? rule.otherwise;
}

function ruleLines(rule: PreferenceRule) {
  return [...(rule.cases?.flatMap((entry) => entry.set) ?? []), ...(rule.otherwise?.set ?? [])];
}

/** Same case-insensitive, trimmed comparison used by stock maintenance. */
function activeStockItemsByName(
  stockItems: readonly StockItem[],
): Map<string, readonly StockItem[]> {
  const byName = new Map<string, StockItem[]>();
  for (const item of stockItems) {
    if (!item.isActive) continue;
    const key = normaliseStockItemName(item.name);
    const matches = byName.get(key);
    if (matches === undefined) byName.set(key, [item]);
    else matches.push(item);
  }
  return byName;
}
