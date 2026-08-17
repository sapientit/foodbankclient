import { Fragment, useId, useState } from 'react';
import { londonToday } from '../../../lib/london-time';
import type {
  ChoiceQuestion,
  FormOption,
  FormQuestion,
  KeyFieldQuestion,
  NumberQuestion,
  TextQuestion,
} from '../referral-form-definition';
import {
  canSelectMore,
  choiceInstruction,
  isNoneSelected,
  offersNone,
  selectNone,
  toggleChoice,
  type AnswerValue,
} from '../referral-form.logic';
import { keyFieldSpec, YES, type KeyFieldControl } from '../referral-key-fields';
import {
  HOUSEHOLD_AGE_BANDS,
  HOUSEHOLD_GENDERS,
  emptyHouseholdComposition,
  isHouseholdComposition,
  type HouseholdAgeBand,
  type HouseholdGender,
} from '../household-composition';
import type { HouseholdCompositionQuestion } from '../referral-form-definition';
import { applyFormVariables, type FormVariables } from '../delivery-window.logic';
import { describeSession } from '../referral-lookups';
import type { PublicSession, ReferralReason } from '../queries';
import styles from './referral-question-field.module.css';

/**
 * One question on the referral form, whatever kind it is.
 *
 * Every control here is driven by `referral-form.config.json` — there is no
 * hand-written field on the public form and there must not be one, because a
 * question that renders from somewhere other than the config is a question the
 * validation and the submission split do not know about.
 *
 * **The rules it renders are not its own.** How many answers a choice takes,
 * whether "None" is offered, whether the question is greyed out — all of it
 * comes from `referral-form.logic.ts`, so a test can prove the behaviour
 * without a DOM and this file stays a rendering of it.
 */

export interface QuestionLookups {
  readonly sessions: readonly PublicSession[];
  readonly referralReasons: readonly ReferralReason[];
  readonly organisations: readonly string[];
}

interface FieldProps {
  readonly question: FormQuestion;
  readonly value: AnswerValue;
  readonly error: string | undefined;
  readonly enabled: boolean;
  readonly lookups: QuestionLookups;
  readonly onChange: (value: AnswerValue) => void;
  /**
   * That the referrer has finished with this control, for the one caller that
   * needs it: the referrer check holds "we do not recognise that address" until
   * the address has been left, because until then it is a verdict on something
   * half-typed. Only wired to the single-line inputs, which is where the
   * question that uses it lives.
   */
  readonly onBlur?: () => void;
  /**
   * Values for the variables a question's text may name — today only
   * `$deliveryTime`, resolved from the session the referrer has chosen. Absent
   * where the caller has no session to resolve against, which hides any
   * question that needs one rather than printing the token.
   */
  readonly variables?: FormVariables;
}

export function ReferralQuestionField(props: FieldProps) {
  const { question, error, enabled, variables } = props;
  const fieldId = useId();
  const errorId = useId();
  const helpId = useId();

  // An informational row is useful only when its condition applies. Unlike a
  // response control it has nothing meaningful to grey out while waiting.
  if (question.type === 'information' && !enabled) return null;

  // Resolved before anything renders, because an unresolved variable means the
  // row says nothing yet — the referrer has not chosen a session — and a line
  // reading "$deliveryTime" teaches them the form is broken.
  const informationSegments =
    question.type === 'information' ? applyFormVariables(question.label, variables ?? {}) : null;
  if (question.type === 'information' && informationSegments === null) return null;

  const describedBy = [
    question.type === 'information' || question.helpText === undefined ? null : helpId,
    error === undefined ? null : errorId,
  ]
    .filter((id) => id !== null)
    .join(' ');

  const shared = {
    ...props,
    fieldId,
    describedBy: describedBy === '' ? undefined : describedBy,
  };

  return (
    <div className={styles.field} data-disabled={enabled ? undefined : 'true'}>
      {question.type === 'choice' ? (
        <ChoiceField {...shared} question={question} />
      ) : question.type === 'householdComposition' ? (
        <HouseholdCompositionField {...shared} question={question} />
      ) : question.type === 'information' ? (
        <p className={styles.information}>
          {informationSegments?.map((segment, index) =>
            segment.emphasis ? (
              <strong key={index}>{segment.text}</strong>
            ) : (
              <Fragment key={index}>{segment.text}</Fragment>
            ),
          )}
        </p>
      ) : (
        <>
          <label className={styles.label} htmlFor={fieldId}>
            {question.label}
            {question.required && <span className={styles.required}> (required)</span>}
          </label>
          <SingleControl {...shared} />
        </>
      )}

      {question.type !== 'information' && question.helpText !== undefined && (
        <p className={styles.help} id={helpId}>
          {question.helpText}
        </p>
      )}

      {error !== undefined && (
        <p className={styles.error} id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface ControlProps extends FieldProps {
  readonly fieldId: string;
  readonly describedBy: string | undefined;
}

function SingleControl(props: ControlProps) {
  switch (props.question.type) {
    case 'keyField':
      return <KeyFieldControlField {...props} question={props.question} />;
    case 'text':
      return <TextControl {...props} question={props.question} />;
    case 'number':
      return <NumberControl {...props} question={props.question} />;
    case 'choice':
    case 'householdComposition':
    case 'information':
      // Handled above — a choice is a fieldset, not a labelled control.
      return null;
  }
}

function HouseholdCompositionField(
  props: ControlProps & { question: HouseholdCompositionQuestion },
) {
  const composition = isHouseholdComposition(props.value)
    ? props.value
    : emptyHouseholdComposition();

  const change = (band: HouseholdAgeBand, gender: HouseholdGender, value: string) => {
    const count = /^\d+$/.test(value) ? Number(value) : 0;
    const row = HOUSEHOLD_GENDERS.reduce<Partial<Record<HouseholdGender, number>>>(
      (updated, candidate) => {
        const nextCount = candidate.key === gender ? count : composition[band]?.[candidate.key];
        if (nextCount !== undefined && nextCount > 0) updated[candidate.key] = nextCount;
        return updated;
      },
      {},
    );
    const next = HOUSEHOLD_AGE_BANDS.reduce<
      Partial<Record<HouseholdAgeBand, Partial<Record<HouseholdGender, number>>>>
    >((updated, candidate) => {
      const nextRow = candidate.key === band ? row : composition[candidate.key];
      if (nextRow !== undefined && Object.keys(nextRow).length > 0)
        updated[candidate.key] = nextRow;
      return updated;
    }, {});
    props.onChange(next);
  };

  return (
    <fieldset className={styles.grid} disabled={!props.enabled}>
      <legend className={styles.legend}>
        {props.question.label}
        {props.question.required && <span className={styles.required}> (required)</span>}
      </legend>
      <table>
        <thead>
          <tr>
            <th scope="col">Age</th>
            {HOUSEHOLD_GENDERS.map((gender) => (
              <th key={gender.key} scope="col">
                {gender.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HOUSEHOLD_AGE_BANDS.map((band) => (
            <tr key={band.key}>
              <th scope="row">{band.label}</th>
              {HOUSEHOLD_GENDERS.map((gender) => {
                const id = `${props.fieldId}-${band.key}-${gender.key}`;
                return (
                  <td key={gender.key}>
                    <label className={styles.visuallyHidden} htmlFor={id}>
                      {band.label}, {gender.label}
                    </label>
                    <input
                      aria-describedby={props.describedBy}
                      aria-invalid={props.error === undefined ? undefined : true}
                      className={styles.gridInput}
                      id={id}
                      inputMode="numeric"
                      min="0"
                      onChange={(event) => {
                        change(band.key, gender.key, event.target.value);
                      }}
                      type="text"
                      value={composition[band.key]?.[gender.key] ?? ''}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </fieldset>
  );
}

function KeyFieldControlField(props: ControlProps & { question: KeyFieldQuestion }) {
  const { control } = keyFieldSpec(props.question.field);

  switch (control.kind) {
    case 'lookup':
      return <LookupControl {...props} source={control.source} />;
    case 'lookupOrOther':
      return <OrganisationControl {...props} maxLength={control.maxLength} />;
    case 'yesNo':
      return <YesNoControl {...props} />;
    case 'longText':
      return <PlainInput {...props} control={control} multiline />;
    // Everything else is a single-line input differing only in its keyboard,
    // its autocomplete hint and its length bound — all of which `PlainInput`
    // reads off the control.
    case 'text':
    case 'email':
    case 'phone':
    case 'date':
    case 'postcode':
    case 'count':
      return <PlainInput {...props} control={control} />;
  }
}

const INPUT_TYPES: Readonly<Record<string, string>> = {
  email: 'email',
  phone: 'tel',
  date: 'date',
  count: 'text',
};

const AUTOCOMPLETE: Readonly<Record<string, string>> = {
  email: 'email',
  phone: 'tel',
  postcode: 'postal-code',
};

function PlainInput({
  control,
  multiline = false,
  ...props
}: ControlProps & { control: KeyFieldControl; multiline?: boolean }) {
  const text = typeof props.value === 'string' ? props.value : '';
  const shared = {
    'aria-describedby': props.describedBy,
    'aria-invalid': props.error === undefined ? undefined : (true as const),
    disabled: !props.enabled,
    id: props.fieldId,
    onBlur: props.onBlur,
    onChange: (event: { target: { value: string } }) => {
      props.onChange(event.target.value);
    },
    value: text,
  };

  if (multiline) {
    return (
      <textarea
        {...shared}
        className={styles.textarea}
        maxLength={'maxLength' in control ? control.maxLength : undefined}
        rows={2}
      />
    );
  }

  return (
    <input
      {...shared}
      autoComplete={AUTOCOMPLETE[control.kind]}
      className={styles.input}
      // `count` is a text input on purpose: `<input type="number">` cannot tell
      // an empty box from a lone minus sign, and on a phone it offers a spinner
      // nobody wants. `inputMode` still brings up the numeric keypad.
      inputMode={control.kind === 'count' ? 'numeric' : undefined}
      // A date of birth cannot be in the future, and saying so in the picker is
      // cheaper for everyone than saying so in an error message.
      max={control.kind === 'date' ? londonToday() : undefined}
      maxLength={'maxLength' in control ? control.maxLength : undefined}
      type={INPUT_TYPES[control.kind] ?? 'text'}
    />
  );
}

/**
 * A single tick, holding the string `Yes` rather than a boolean, so it reads
 * the same as every other "Choose 0 or 1 (yes)" row in the CSV and
 * `keyFieldValue` has one place to turn it into the column's boolean.
 */
function YesNoControl(props: ControlProps) {
  return (
    <input
      aria-describedby={props.describedBy}
      checked={props.value === YES}
      className={styles.checkbox}
      disabled={!props.enabled}
      id={props.fieldId}
      onChange={(event) => {
        props.onChange(event.target.checked ? YES : '');
      }}
      type="checkbox"
    />
  );
}

function LookupControl(props: ControlProps & { source: 'sessions' | 'referralReasons' }) {
  const options =
    props.source === 'sessions'
      ? // `describeSession`, not a format string spelled here: the confirmation
        // screen shows the chosen session back and must show the same words.
        props.lookups.sessions.map((session) => ({
          value: session.id,
          label: describeSession(session),
        }))
      : props.lookups.referralReasons.map((reason) => ({ value: reason.id, label: reason.label }));

  return (
    <select
      aria-describedby={props.describedBy}
      aria-invalid={props.error === undefined ? undefined : true}
      className={styles.select}
      disabled={!props.enabled}
      id={props.fieldId}
      onChange={(event) => {
        props.onChange(event.target.value);
      }}
      value={typeof props.value === 'string' ? props.value : ''}
    >
      <option value="">Choose one</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

const NOT_LISTED = '__not-listed__';

/**
 * The organisation: a list, plus a way out for one that is not on it.
 *
 * `Referral questions.csv` asks this twice — a dropdown and a free-text box,
 * "either this or the previous one" — because a Google Form cannot offer both
 * in one question. Here it is one question writing one column, which is what
 * stops there being two ways for it to end up empty.
 *
 * "Not listed" is local state rather than a value, because choosing it and not
 * yet typing is indistinguishable from having chosen nothing if all you have is
 * the answer.
 */
function OrganisationControl(props: ControlProps & { maxLength: number }) {
  const text = typeof props.value === 'string' ? props.value : '';
  const { organisations } = props.lookups;
  const [notListed, setNotListed] = useState(text !== '' && !organisations.includes(text));
  const otherId = useId();

  return (
    <>
      <select
        aria-describedby={props.describedBy}
        aria-invalid={props.error === undefined ? undefined : true}
        className={styles.select}
        disabled={!props.enabled}
        id={props.fieldId}
        onChange={(event) => {
          const chosen = event.target.value;
          setNotListed(chosen === NOT_LISTED);
          props.onChange(chosen === NOT_LISTED ? '' : chosen);
        }}
        value={notListed ? NOT_LISTED : text}
      >
        <option value="">Choose one</option>
        {organisations.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        <option value={NOT_LISTED}>My organisation is not listed</option>
      </select>

      {notListed && (
        <>
          <label className={styles.label} htmlFor={otherId}>
            What is the name of your organisation?
          </label>
          <input
            aria-describedby={props.describedBy}
            aria-invalid={props.error === undefined ? undefined : true}
            className={styles.input}
            disabled={!props.enabled}
            id={otherId}
            maxLength={props.maxLength}
            onChange={(event) => {
              props.onChange(event.target.value);
            }}
            type="text"
            value={text}
          />
        </>
      )}
    </>
  );
}

function TextControl(props: ControlProps & { question: TextQuestion }) {
  const text = typeof props.value === 'string' ? props.value : '';
  const long = props.question.maxLength > 200;

  const shared = {
    'aria-describedby': props.describedBy,
    'aria-invalid': props.error === undefined ? undefined : (true as const),
    disabled: !props.enabled,
    id: props.fieldId,
    maxLength: props.question.maxLength,
    onChange: (event: { target: { value: string } }) => {
      props.onChange(event.target.value);
    },
    value: text,
  };

  return long ? (
    <textarea {...shared} className={styles.textarea} rows={3} />
  ) : (
    <input {...shared} className={styles.input} type="text" />
  );
}

function NumberControl(props: ControlProps & { question: NumberQuestion }) {
  return (
    <input
      aria-describedby={props.describedBy}
      aria-invalid={props.error === undefined ? undefined : true}
      className={styles.number}
      disabled={!props.enabled}
      id={props.fieldId}
      // Text, not `type="number"` — see `PlainInput`.
      inputMode="numeric"
      onChange={(event) => {
        props.onChange(event.target.value);
      }}
      type="text"
      value={typeof props.value === 'string' ? props.value : ''}
    />
  );
}

/**
 * A set of tick boxes with a floor and a ceiling, and the generated "None".
 *
 * A `<fieldset>` with a `<legend>`, not a label: a screen reader announcing
 * "Toiletries, choose up to three" once before the boxes is the difference
 * between a group somebody understands and eight unexplained ticks.
 *
 * Boxes past the ceiling are `disabled` rather than silently refusing, so the
 * limit is visible before somebody clicks and nothing happens.
 */
function ChoiceField(props: ControlProps & { question: ChoiceQuestion }) {
  const { question, enabled, error } = props;
  const selected: readonly string[] =
    typeof props.value === 'string' || isHouseholdComposition(props.value) ? [] : props.value;

  const options: readonly FormOption[] =
    question.optionsFrom === 'referralReasons'
      ? props.lookups.referralReasons.map((reason) => ({ value: reason.id, label: reason.label }))
      : question.options;

  const full = !canSelectMore(question, selected);

  if (question.answerMax === 1) {
    const selectedValue = selected[0] ?? '';
    return (
      <fieldset aria-describedby={props.describedBy} className={styles.group}>
        <legend className={styles.legend}>
          {question.label}
          {question.required && <span className={styles.required}> (required)</span>}
        </legend>
        <select
          aria-label={question.label}
          aria-invalid={error === undefined ? undefined : true}
          className={styles.select}
          disabled={!enabled}
          onChange={(event) => {
            props.onChange(event.target.value === '' ? [] : [event.target.value]);
          }}
          value={selectedValue}
        >
          <option value="">{question.answerMin === 1 ? '-- choose --' : 'None'}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </fieldset>
    );
  }

  const instruction = choiceInstruction(question);

  return (
    <fieldset aria-describedby={props.describedBy} className={styles.group}>
      <legend className={styles.legend}>
        {question.label}
        {question.required && <span className={styles.required}> (required)</span>}
      </legend>
      {instruction !== null && <p className={styles.instruction}>{instruction}</p>}

      {options.map((option) => {
        const checked = selected.includes(option.value);
        return (
          <label className={styles.choice} key={option.value}>
            <input
              aria-invalid={error === undefined ? undefined : true}
              checked={checked}
              disabled={!enabled || (full && !checked)}
              onChange={() => {
                props.onChange(toggleChoice(question, selected, option.value));
              }}
              type="checkbox"
            />
            {option.label}
          </label>
        );
      })}

      {offersNone(question) && (
        <label className={styles.choice}>
          <input
            checked={isNoneSelected(selected)}
            disabled={!enabled}
            onChange={() => {
              props.onChange(selectNone());
            }}
            type="checkbox"
          />
          None
        </label>
      )}
    </fieldset>
  );
}
