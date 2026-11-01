import type { FuelHelpList } from './queries';
import { formatCalendarDate } from '../../lib/london-time';
import { householdCompositionTotals } from '../referrals/household-composition';
import { referralFormDefinition } from '../referrals/referral-form-config';
import { needsOptionSources, optionsFor } from '../referrals/referral-form-definition';
import type {
  FormQuestion,
  KeyFieldName,
  OptionSources,
  ReferralFormDefinition,
} from '../referrals/referral-form-definition';

type FuelHelpHousehold = FuelHelpList['households'][number];

export interface FuelColumn {
  readonly key: string;
  readonly label: string;
  readonly question?: Exclude<FormQuestion, { type: 'information' }>;
  readonly fixedField?: FuelHelpKeyField;
  readonly householdCompositionTotal?: keyof NonNullable<
    ReturnType<typeof householdCompositionTotals>
  >;
}

// This old generated household-composition flag can be present in a historic
// release, but the Fuel list now receives the three totals directly from the
// composition instead. It must never become a duplicate Fuel column again.
const LEGACY_FUEL_PENSION_KEY = 'FuelPension';

const HOUSEHOLD_COMPOSITION_TOTAL_COLUMNS = [
  { key: 'under18', label: '<18' },
  { key: 'over18', label: '18+' },
  { key: 'statePensionAge', label: 'State Pension age+' },
] as const;

/** The only fixed fields the Fuel endpoint can return. `reasonId` is never sent. */
const FUEL_HELP_KEY_FIELDS = [
  'referrerName',
  'referrerEmail',
  'referrerOrganisation',
  'referrerPhone',
  'refereeFirstName',
  'refereeSurname',
  'refereeDateOfBirth',
  'refereeAddress',
  'refereePostcode',
  'refereePhone',
] as const satisfies readonly KeyFieldName[];

type FuelHelpKeyField = (typeof FUEL_HELP_KEY_FIELDS)[number];

const FUEL_HELP_FIELD_LABELS: Record<FuelHelpKeyField, string> = {
  referrerName: "Referrer's name",
  referrerEmail: "Referrer's email address",
  referrerOrganisation: "Referrer's organisation",
  referrerPhone: "Referrer's contact number",
  refereeFirstName: "Client's first name",
  refereeSurname: "Client's surname",
  refereeDateOfBirth: "Client's date of birth",
  refereeAddress: 'First line of address',
  refereePostcode: "Client's postcode",
  refereePhone: "Client's contact number",
};

/** Formats the optional fixed fields exactly as the endpoint carried them. */
const KEY_FIELD_READERS: Record<
  FuelHelpKeyField,
  (household: FuelHelpHousehold) => string | null | undefined
> = {
  referrerName: (household) => household.referrerName,
  referrerEmail: (household) => household.referrerEmail,
  referrerOrganisation: (household) => household.referrerOrganisation,
  referrerPhone: (household) => household.referrerPhone,
  refereeFirstName: (household) => household.refereeFirstName,
  refereeSurname: (household) => household.refereeSurname,
  // A calendar date, so formatted in UTC — see `formatCalendarDate`. The fuel
  // team gets it to tell two households of the same name apart, which is also
  // why it is a date and never an age.
  refereeDateOfBirth: (household) =>
    household.refereeDateOfBirth == null
      ? household.refereeDateOfBirth
      : formatCalendarDate(household.refereeDateOfBirth),
  refereeAddress: (household) => household.refereeAddress,
  refereePostcode: (household) => household.refereePostcode,
  refereePhone: (household) => household.refereePhone,
};

function isFuelHelpKeyField(field: KeyFieldName): field is FuelHelpKeyField {
  return FUEL_HELP_KEY_FIELDS.includes(field as FuelHelpKeyField);
}

/**
 * The referral form owns which personal details the fuel team is permitted to
 * see. Keeping the selection here derived from its marker means a released
 * fuel question appears in this copy-to-Excel list without a second list of
 * keys drifting out of date.
 *
 * The endpoint has already applied the per-referral-form marker to its fixed
 * fields. A fixed column belongs in the shared table only when at least one
 * returned row actually carries that key; reapplying today's marker would hide
 * fields a historical referral is allowed to provide.
 */
export function fuelColumns(
  definition: ReferralFormDefinition = referralFormDefinition,
  households: readonly FuelHelpHousehold[] = [],
): FuelColumn[] {
  const configuredColumns = definition.pages.flatMap((page) =>
    page.questions.flatMap<FuelColumn>((question): FuelColumn[] => {
      if (question.type === 'information') return [];
      // Household composition is a fixed generated answer rather than a
      // questionnaire-selected Fuel detail, so it is always represented by
      // its three Fuel totals.
      if (question.type === 'householdComposition') {
        return HOUSEHOLD_COMPOSITION_TOTAL_COLUMNS.map((total) => ({
          key: `${question.key}:${total.key}`,
          label: total.label,
          question,
          householdCompositionTotal: total.key,
        }));
      }
      if (question.type === 'keyField') {
        if (
          !isFuelHelpKeyField(question.field) ||
          !households.some((household) => Object.hasOwn(household, question.field))
        )
          return [];
        return [{ key: question.key, label: question.label, question, fixedField: question.field }];
      }
      if (question.key === LEGACY_FUEL_PENSION_KEY || question.forFuelTeam !== true) return [];
      return [{ key: question.key, label: question.label, question }];
    }),
  );

  const configuredFixedFields = new Set(
    configuredColumns.flatMap((column) =>
      column.fixedField === undefined ? [] : [column.fixedField],
    ),
  );
  const historicFixedColumns = FUEL_HELP_KEY_FIELDS.flatMap((field): FuelColumn[] => {
    if (
      configuredFixedFields.has(field) ||
      !households.some((household) => Object.hasOwn(household, field))
    )
      return [];
    return [{ key: field, label: FUEL_HELP_FIELD_LABELS[field], fixedField: field }];
  });

  return [...configuredColumns, ...historicFixedColumns];
}

/** Whether any column's answer was chosen from a server lookup, and so needs one fetching. */
export function fuelColumnsNeedOptionSources(columns: readonly FuelColumn[]): boolean {
  return needsOptionSources(
    columns.flatMap((column) => (column.question === undefined ? [] : [column.question])),
  );
}

/**
 * Formats one configured fuel column without exposing answers that lack the
 * marker.
 *
 * `sources` carries the maintained lookups: a question choosing from one stored
 * the option's id, and this list is copied into a spreadsheet and worked from.
 */
export function fuelColumnValue(
  column: FuelColumn,
  household: FuelHelpHousehold,
  sources: OptionSources,
): string {
  if (column.householdCompositionTotal !== undefined) {
    const totals = householdCompositionTotals(household.answers);
    return totals === null ? 'Not answered' : String(totals[column.householdCompositionTotal]);
  }

  if (column.fixedField !== undefined) {
    return KEY_FIELD_READERS[column.fixedField](household) ?? 'Not provided';
  }

  if (column.question === undefined) return 'Not answered';
  const answer = household.answers[column.key];
  if (column.question.type === 'choice' && column.question.optionsFrom !== undefined) {
    return optionText(optionsFor(column.question, sources), answer);
  }
  return answerText(answer);
}

/** A stored option as the words the charity gave it — see `listener-sheet.logic.ts`. */
function optionText(
  options: readonly { readonly value: string; readonly label: string }[],
  answer: unknown,
): string {
  const stored = typeof answer === 'string' ? [answer] : answer;
  if (!Array.isArray(stored)) return 'Not answered';

  const chosen = stored.filter(
    (entry: unknown): entry is string => typeof entry === 'string' && entry.trim() !== '',
  );
  if (chosen.length === 0) return 'Not answered';

  return chosen
    .map((entry) => options.find((option) => option.value === entry)?.label ?? 'No longer listed')
    .join(', ');
}

function answerText(answer: unknown): string {
  if (typeof answer === 'string') return answer.trim() === '' ? 'Not answered' : answer;
  if (Array.isArray(answer) && answer.every((item) => typeof item === 'string')) {
    return answer.length === 0 ? 'Not answered' : answer.join(', ');
  }
  if (typeof answer === 'number') return String(answer);
  return 'Not answered';
}
