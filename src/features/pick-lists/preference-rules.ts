import * as z from 'zod';
import rawConfig from './preference-rules.config.json';
import { allQuestions, type DynamicQuestion } from '../referrals/referral-form-definition';
import { referralFormDefinition } from '../referrals/referral-form-config';
import type { Referral } from '../referrals/queries';
import type { StockItem } from '../stock/queries';

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
  });

const configSchema = z.object({ rules: z.array(ruleSchema) });
export type PreferenceRule = z.infer<typeof ruleSchema>;
export const preferenceRuleConfig = configSchema.parse(rawConfig);

export interface PreferenceRuleHealth {
  readonly errors: readonly string[];
}

/** Validates static questionnaire references and environment-specific stock names. */
export function validatePreferenceRules(stockItems: readonly StockItem[]): PreferenceRuleHealth {
  const preferences = new Map(
    allQuestions(referralFormDefinition)
      .filter(
        (question): question is DynamicQuestion =>
          question.type !== 'keyField' && question.preference,
      )
      .map((question) => [question.key, question]),
  );
  const activeByName = new Map(
    stockItems.filter((item) => item.isActive).map((item) => [item.name, item]),
  );
  const errors: string[] = [];
  for (const rule of preferenceRuleConfig.rules) {
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
      if (line.stock !== '$selectedAnswer' && !activeByName.has(line.stock)) {
        errors.push(`Rule ${rule.when.key}: active stock item ${line.stock} does not exist.`);
      }
    }
  }
  return { errors };
}

export function resolvePreferenceLines(
  referrals: readonly Referral[],
  stockItems: readonly StockItem[],
): { referralId: string; lines: { stockItemId: string; quantity: number }[] }[] {
  const health = validatePreferenceRules(stockItems);
  if (health.errors.length > 0)
    throw new Error(`Preference rule configuration is invalid: ${health.errors.join(' ')}`);
  const activeByName = new Map(
    stockItems.filter((item) => item.isActive).map((item) => [item.name, item]),
  );
  return referrals.flatMap((referral) => {
    const lines = new Map<string, number>();
    for (const rule of preferenceRuleConfig.rules) {
      for (const selectedAnswer of selectedAnswers(referral.answers[rule.when.key])) {
        if (rule.when.hasAnswer !== undefined && selectedAnswer !== rule.when.hasAnswer) continue;
        const outcome = firstOutcome(rule, referral);
        if (outcome === undefined) continue;
        for (const line of outcome.set) {
          const item = activeByName.get(
            line.stock === '$selectedAnswer' ? selectedAnswer : line.stock,
          );
          if (item === undefined) continue;
          const oldQuantity = lines.get(item.id);
          lines.set(
            item.id,
            oldQuantity === -1 || line.quantity === -1
              ? -1
              : Math.max(oldQuantity ?? 0, line.quantity),
          );
        }
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
