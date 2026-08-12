# Preference-rules Google Sheet

This is the Apps Script for the charity's **Rules** tab only. Questionnaire
generation is deliberately not included while its outstanding charity question
remains unresolved.

## Install

1. In the authoring workbook, open **Extensions → Apps Script**.
2. Replace the default source with `Code.gs`, save it, then reload the workbook.
3. Choose **Foodbank rules → Set up Rules tab** once.
4. Fill rows from row 3, then choose **Foodbank rules → Generate JSON**.
   Review the expanded result on `Generated Rules JSON` and copy it into
   `preference-rules.config.json` for the normal development/test release path.

The menu action can be assigned to an inserted Google Sheets drawing if the
charity wants a visible **Generate JSON** button. Assign it to
`generateRulesJson`.

## Rules tab

Row 1 contains hidden, immutable keys used by the script. Row 2 has friendly
headings and may be renamed. Data begins on row 3.

| Heading           | Value                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| Preference key    | Stored preference-question key. Repeat it to begin a new rule.           |
| Answer (optional) | Stored answer that triggers the rule; blank means every selected answer. |
| Outcome           | `Case` or `Otherwise`; begin every outcome explicitly.                   |
| People            | `Adults`, `Children`, or `Total` for a Case; blank for Otherwise.        |
| At least          | Whole number zero or greater for a Case; blank for Otherwise.            |
| Stock item        | Exact active stock-item name or `$selectedAnswer`; never inherited.      |
| Quantity          | 1–10 or **Needs team-leader attention**; never inherited.                |

Blank condition cells inherit the current rule and outcome only when adding a
second stock item to that outcome. The generator rejects a missing first rule,
ambiguous answer change, incomplete condition, missing item or quantity,
duplicate item in one outcome, a case after Otherwise, multiple Otherwise
outcomes, or a rule without Otherwise.

The generated result is structurally valid JSON only. The deployed client’s
administrator-only Preference rule check still validates keys, answer values,
and active stock names against the current environment.
