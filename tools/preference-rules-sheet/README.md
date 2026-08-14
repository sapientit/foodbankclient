# Preference-rules Google Sheet

## Script files are separate

**Rules code and Referral Form code are different Apps Script files. Do not
combine them.** The existing Rules script stays in `Code.gs`; the Referral Form
script is `questionnaire.gs`. In the live workbook, add `questionnaire.gs` as
a separate script file and call `addQuestionnaireMenu_()` from the existing
Rules `onOpen()` function. Do not paste either file into the other: they are
separate script files in the same Apps Script project.

## Install

1. In the authoring workbook, open **Extensions → Apps Script**.
2. Keep the existing Rules source. Create a separate script file named
   `questionnaire` and paste in `questionnaire.gs`.
3. Add `addQuestionnaireMenu_();` to the existing Rules `onOpen()` function,
   save, then reload the workbook.
4. Choose **Foodbank rules → Set up Rules tab** once.
5. Fill Rules rows from row 3, then choose **Foodbank rules → Generate JSON**.
   Review the expanded result on `Generated Rules JSON` and copy it into
   `preference-rules.config.json` for the normal development/test release path.
6. For the referral form, choose **Foodbank questionnaire → Validate
   questionnaire**. Once it passes, choose **Foodbank questionnaire → Format as
   JSON**. Review the result on `Generated Questionnaire JSON` before using it
   as the client questionnaire source.

The menu action can be assigned to an inserted Google Sheets drawing if the
charity wants a visible **Generate JSON** button. Assign it to
`generateRulesJson`.

## Rules tab

Row 1 contains hidden, immutable keys used by the script. Row 2 has friendly
headings and may be renamed. Data begins on row 3.

| Heading           | Value                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Preference key    | Stored preference-question key. Repeat it to begin a new rule.                                                         |
| Answer (optional) | Stored answer that triggers the rule; blank means every selected answer. `$selectedAnswer` belongs only in Stock item. |
| Outcome           | `Case` or `Otherwise`; begin every outcome explicitly.                                                                 |
| People            | `Adults`, `Children`, or `Total` for a Case; blank for Otherwise.                                                      |
| At least          | Whole number zero or greater for a Case; blank for Otherwise.                                                          |
| Stock item        | Exact active stock-item name or `$selectedAnswer`; never inherited.                                                    |
| Quantity          | 1–10 or **Needs team-leader attention**; never inherited.                                                              |

Blank condition cells inherit the current rule and outcome only when adding a
second stock item to that outcome. The generator rejects a missing first rule,
ambiguous answer change, incomplete condition, missing item or quantity,
duplicate item in one outcome, a case after Otherwise, multiple Otherwise
outcomes, or a rule without Otherwise.

Rules run top-to-bottom. A rule consumes each answer it handles, so put a
specific answer rule before a broad `$selectedAnswer` rule for the same
Preference key. Quantities from separate handled answers are added together;
**Needs team-leader attention** overrides any positive quantity for that item.

The generated result is structurally valid JSON only. The deployed client’s
administrator-only Preference rule check still validates keys, answer values,
and active stock names against the current environment.

## Referral Form tab

The code that reads and validates this tab is **`questionnaire.gs`, not the
Rules source in `Code.gs`**. It is installed as a separate Apps Script file as
described above.

The script treats row 5 as the fixed headers and row 6 onwards as data. Each
choice option must be on its own row; blank question-detail cells inherit from
the preceding question. A `No Answer` row is different: it is display-only and
deliberately has a blank Question key, no answer option, default or selection,
and `Required` must be `No`.

The **Pick-list information** column belongs on this tab, because it marks a
referral question rather than a stock-selection rule. It is column 12,
immediately before **For Fuel Team**. Enter **Yes** to copy that question's
answer into the initial parcel note, **No** or blank otherwise; it may only be
Yes for a question marked **Use for picking rules?**.

Validation checks the fixed headers, page numbering, unique question keys,
answer-format names, choice-selection limits, defaults, conditional keys and
the one-option-per-row rule. A required `Choose up to N` question means choose
one to N; an optional one means zero to N. It translates the Sheet's friendly
formats into the client configuration schema, retains the `For Fuel Team` flag
and the **Pick-list information** Yes marker,
and separates a blank-line help paragraph from the displayed question.
It deliberately flags incomplete data rather than guessing it: a choice list
without options, a comma-separated option cell, or a condition naming an
unknown key cannot be formatted.

The generated tab is the plain client JSON to paste into
`src/features/referrals/referral-form.config.json`; it is not CSV. The delivery
collection question must use the key `Collection method`, and its conditional
information and confirmation rows must name that key. `isDelivery` is derived
by the client and is never a questionnaire key.
