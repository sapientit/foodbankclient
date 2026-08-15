import * as z from 'zod';
import rawConfig from './referral-form.config.json';
import {
  KEY_FIELD_NAMES,
  type ChoiceQuestion,
  type FormOption,
  type FormPage,
  type FormQuestion,
  type ReferralFormDefinition,
} from './referral-form-definition';
import { HOUSEHOLD_COMPONENTS_KEY } from './household-composition';

/**
 * Loads `referral-form.config.json` and checks it is a form.
 *
 * The JSON is the charity's questions in the shape `referral details.txt`
 * proposed — `questionKey`, `questionTitle`, `validation: { type: "CheckBox" |
 * "Number" | "String" }` — and this is the only place that shape is spoken. The
 * rest of the feature works on `ReferralFormDefinition`, so the wording of the
 * config file can change without a rewrite, and a typo in it fails here with a
 * sentence rather than three screens later with `undefined`.
 *
 * **It parses at module load and throws.** That looks harsh for a file a
 * referrer's browser downloads, but the config is static and shipped: if the
 * test below passes, this cannot fail in production, and the alternative — a
 * form that renders half its questions — is the failure that matters.
 *
 * The cross-checks under `.superRefine` are the ones a shape alone cannot make:
 * a default that is not one of the offered answers, a `enabledWhen` naming a
 * question that does not exist, two questions sharing a key. Each of those is a
 * form that renders and is quietly wrong.
 *
 * **Six questions in the shipped config offer a guessed list of answers** —
 * toiletries, household items, spread, nappy sizes, baby milk types, and the
 * tea/coffee row whose question mentions hot chocolate and whose answers do
 * not. `Referral questions.csv` gives their defaults but never their choices,
 * and what a food bank stocks is not something to invent quietly. Raised as
 * **Q20** in `../foodbankserver/OPEN-QUESTIONS.md`; only Pete closes it. The
 * keys are right, which is what matters — an option list can change between
 * releases and `describeAnswers` already renders a value no longer offered.
 */

const enabledWhenSchema = z.object({
  questionKey: z.string().min(1),
  hasAnswer: z.string().min(1),
});

const keyFieldQuestionSchema = z.object({
  questionNum: z.number().int().positive(),
  questionKey: z.string().min(1),
  questionTitle: z.string().min(1),
  keyField: z.enum(KEY_FIELD_NAMES),
  required: z.boolean(),
  helpText: z.string().min(1).optional(),
  enabledWhen: enabledWhenSchema.optional(),
  forFuelTeam: z.boolean().optional(),
  forListenerSheet: z.boolean().optional(),
});

const dynamicQuestionSchema = z.object({
  questionNum: z.number().int().positive(),
  questionKey: z.string().min(1),
  questionTitle: z.string().min(1),
  preference: z.boolean(),
  pickListInformation: z.literal('Yes').optional(),
  required: z.boolean(),
  helpText: z.string().min(1).optional(),
  enabledWhen: enabledWhenSchema.optional(),
  forFuelTeam: z.boolean().optional(),
  forListenerSheet: z.boolean().optional(),
  validation: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('String'),
      maxLength: z.number().int().positive(),
    }),
    z.object({
      type: z.literal('Number'),
      minimum: z.number().int().optional(),
      maximum: z.number().int().optional(),
    }),
    z.object({
      type: z.literal('CheckBox'),
      answerMin: z.number().int().min(0),
      answerMax: z.number().int().min(1),
      optionsFrom: z.literal('referralReasons').optional(),
      maxAnswerLength: z.number().int().positive().optional(),
    }),
    z.object({ type: z.literal('HouseholdComposition') }),
  ]),
  answers: z.array(z.string().min(1)).optional(),
  default: z.array(z.string().min(1)).optional(),
});

const informationQuestionSchema = z.object({
  questionNum: z.number().int().positive(),
  questionTitle: z.string().min(1),
  answerFormat: z.literal('No Answer'),
  enabledWhen: enabledWhenSchema.optional(),
});

const questionSchema = z.union([
  keyFieldQuestionSchema,
  dynamicQuestionSchema,
  informationQuestionSchema,
]);

const pageSchema = z.object({
  pageNum: z.number().int().positive(),
  pageTitle: z.string().min(1),
  questions: z.array(questionSchema).min(1),
});

const configShape = z.object({
  version: z.number().int().positive(),
  pages: z.array(pageSchema).min(1),
});

const configSchema = configShape.superRefine(checkTheWholeForm);
export const PICK_LIST_INFORMATION_MAX_LENGTH = 1200;

type RawConfig = z.infer<typeof configShape>;
type RawQuestion = z.infer<typeof questionSchema>;
type RawDynamicQuestion = z.infer<typeof dynamicQuestionSchema>;

function isRawKeyField(question: RawQuestion): question is z.infer<typeof keyFieldQuestionSchema> {
  return 'keyField' in question;
}

function isRawInformation(
  question: RawQuestion,
): question is z.infer<typeof informationQuestionSchema> {
  return 'answerFormat' in question;
}

function checkTheWholeForm(config: RawConfig, ctx: z.RefinementCtx) {
  const questions = config.pages.flatMap((page) => page.questions);
  const byKey = new Map(
    questions
      .filter(
        (question): question is Exclude<RawQuestion, z.infer<typeof informationQuestionSchema>> =>
          !isRawInformation(question),
      )
      .map((question) => [question.questionKey, question]),
  );

  const seen = new Set<string>();
  for (const question of questions) {
    if (isRawInformation(question)) {
      if (question.enabledWhen !== undefined)
        checkEnabledWhen(question.questionTitle, question.enabledWhen.questionKey, byKey, ctx);
      continue;
    }
    const at = question.questionKey;

    if (seen.has(at)) {
      ctx.addIssue({ code: 'custom', message: `Two questions share the key "${at}".` });
    }
    seen.add(at);

    if (question.enabledWhen !== undefined) {
      checkEnabledWhen(at, question.enabledWhen.questionKey, byKey, ctx);
    }

    if (isRawKeyField(question)) continue;
    checkDynamicQuestion(question, ctx);
  }

  const pickListInformationLength = questions.reduce(
    (total, question) => {
      if (isRawInformation(question) || isRawKeyField(question)) return total;
      if (question.pickListInformation === undefined) return total;
      return total + question.questionKey.length + 2 + maximumAnswerLength(question);
    },
    Math.max(
      0,
      questions.filter(
        (question) =>
          'pickListInformation' in question && question.pickListInformation !== undefined,
      ).length - 1,
    ),
  );
  if (pickListInformationLength > PICK_LIST_INFORMATION_MAX_LENGTH) {
    ctx.addIssue({
      code: 'custom',
      message: `Pick-list information can be at most ${String(PICK_LIST_INFORMATION_MAX_LENGTH)} characters.`,
    });
  }
}

function maximumAnswerLength(question: RawDynamicQuestion): number {
  if (question.validation.type === 'String') return question.validation.maxLength;
  if (question.validation.type === 'Number') return 20;
  if (question.validation.type === 'HouseholdComposition') return 0;
  if (question.validation.optionsFrom !== undefined)
    return question.validation.answerMax * (question.validation.maxAnswerLength ?? 0);
  const longest = Math.max(0, ...(question.answers ?? []).map((answer) => answer.length));
  return (
    question.validation.answerMax * longest + Math.max(0, question.validation.answerMax - 1) * 2
  );
}

/**
 * The condition must name a real question, and that question must not itself be
 * conditional. `isEnabled` in `referral-form.logic.ts` is deliberately one level
 * deep; this is what makes that safe rather than assumed, and it is also what
 * makes a cycle impossible to write.
 */
function checkEnabledWhen(
  at: string,
  enabledBy: string,
  byKey: ReadonlyMap<string, RawQuestion>,
  ctx: z.RefinementCtx,
) {
  const controller = byKey.get(enabledBy);

  if (controller === undefined) {
    ctx.addIssue({
      code: 'custom',
      message: `"${at}" is enabled by "${enabledBy}", which is not a question on this form.`,
    });
    return;
  }

  if (controller.enabledWhen !== undefined) {
    ctx.addIssue({
      code: 'custom',
      message: `"${at}" is enabled by "${enabledBy}", which is itself conditional. A question that enables another must always be answerable.`,
    });
  }
}

function checkDynamicQuestion(question: RawDynamicQuestion, ctx: z.RefinementCtx) {
  const at = question.questionKey;
  const { validation } = question;

  if (question.pickListInformation === 'Yes' && !question.preference) {
    ctx.addIssue({
      code: 'custom',
      message: `"${at}" is pick-list information, so it must be a preference question.`,
    });
  }

  if (validation.type === 'HouseholdComposition' && at !== HOUSEHOLD_COMPONENTS_KEY) {
    ctx.addIssue({
      code: 'custom',
      message: `The household-composition question key must be "${HOUSEHOLD_COMPONENTS_KEY}".`,
    });
  }

  if (validation.type !== 'CheckBox') {
    if (question.answers !== undefined || question.default !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `"${at}" is a ${validation.type} question, so it cannot offer answers to choose from.`,
      });
    }
    return;
  }

  if (validation.answerMax < validation.answerMin) {
    ctx.addIssue({
      code: 'custom',
      message: `"${at}" allows at most ${String(validation.answerMax)} answers but demands at least ${String(validation.answerMin)}.`,
    });
  }

  if (validation.optionsFrom !== undefined) {
    if (question.answers !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `"${at}" takes its answers from ${validation.optionsFrom}, so it cannot list them as well.`,
      });
    }
    if (validation.maxAnswerLength === undefined) {
      // Without a declared bound the guards cannot size a list that arrives at
      // runtime, and an unbounded field turns the 16KB check into a guess.
      ctx.addIssue({
        code: 'custom',
        message: `"${at}" takes its answers from ${validation.optionsFrom}, so it needs a maxAnswerLength.`,
      });
    }
    return;
  }

  const answers = question.answers ?? [];
  if (answers.length === 0) {
    ctx.addIssue({ code: 'custom', message: `"${at}" is a choice with nothing to choose from.` });
    return;
  }

  const offered = new Set(answers);
  for (const chosen of question.default ?? []) {
    if (!offered.has(chosen)) {
      ctx.addIssue({
        code: 'custom',
        message: `"${at}" defaults to "${chosen}", which is not one of its answers.`,
      });
    }
  }

  if ((question.default ?? []).length > validation.answerMax) {
    ctx.addIssue({
      code: 'custom',
      message: `"${at}" defaults to more answers than the ${String(validation.answerMax)} it allows.`,
    });
  }
}

function toPage(raw: z.infer<typeof pageSchema>): FormPage {
  return {
    pageNum: raw.pageNum,
    pageTitle: raw.pageTitle,
    questions: raw.questions.map(toQuestion),
  };
}

function toQuestion(raw: RawQuestion): FormQuestion {
  if (isRawInformation(raw)) {
    return {
      type: 'information',
      label: raw.questionTitle,
      ...(raw.enabledWhen === undefined ? {} : { enabledWhen: raw.enabledWhen }),
    };
  }
  const shared = {
    key: raw.questionKey,
    label: raw.questionTitle,
    required: raw.required,
    ...(raw.helpText === undefined ? {} : { helpText: raw.helpText }),
    ...(raw.enabledWhen === undefined ? {} : { enabledWhen: raw.enabledWhen }),
    ...(raw.forFuelTeam === undefined ? {} : { forFuelTeam: raw.forFuelTeam }),
    ...(raw.forListenerSheet === undefined ? {} : { forListenerSheet: raw.forListenerSheet }),
  };

  if (isRawKeyField(raw)) {
    return { ...shared, type: 'keyField', field: raw.keyField };
  }

  const base = {
    ...shared,
    preference: raw.preference,
    ...(raw.pickListInformation === undefined ? {} : { pickListInformation: true }),
  };

  switch (raw.validation.type) {
    case 'String':
      return { ...base, type: 'text', maxLength: raw.validation.maxLength };

    case 'Number':
      return {
        ...base,
        type: 'number',
        ...(raw.validation.minimum === undefined ? {} : { minimum: raw.validation.minimum }),
        ...(raw.validation.maximum === undefined ? {} : { maximum: raw.validation.maximum }),
      };

    case 'CheckBox':
      return toChoiceQuestion(base, raw.validation, raw);

    case 'HouseholdComposition':
      return { ...base, type: 'householdComposition' };
  }
}

function toChoiceQuestion(
  base: Omit<ChoiceQuestion, 'type' | 'answerMin' | 'answerMax' | 'options'>,
  validation: Extract<RawDynamicQuestion['validation'], { type: 'CheckBox' }>,
  raw: RawDynamicQuestion,
): ChoiceQuestion {
  return {
    ...base,
    type: 'choice',
    answerMin: validation.answerMin,
    answerMax: validation.answerMax,
    // Value and label are the same thing here: the config offers one string per
    // answer, and it is what gets stored. They are separate on `FormOption` so
    // a future list whose wording changes can keep its stored values.
    options: (raw.answers ?? []).map(toOption),
    ...(validation.optionsFrom === undefined ? {} : { optionsFrom: validation.optionsFrom }),
    ...(validation.maxAnswerLength === undefined
      ? {}
      : { maxAnswerLength: validation.maxAnswerLength }),
    ...(raw.default === undefined ? {} : { default: raw.default }),
  };
}

function toOption(answer: string): FormOption {
  return { value: answer, label: answer };
}

/**
 * Parses a config into the definition the rest of the feature works on, or
 * throws with what is wrong with it. Exported so a test can feed it a broken
 * config without breaking the real one.
 */
export function parseReferralFormConfig(config: unknown): ReferralFormDefinition {
  const parsed = configSchema.parse(config);
  return { version: parsed.version, pages: parsed.pages.map(toPage) };
}

/** The charity's questions. `referral-form.config.json` is the file to edit; releasing this client is how a change is published. */
export const referralFormDefinition: ReferralFormDefinition = parseReferralFormConfig(rawConfig);
