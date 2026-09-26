# Preference-rules Google Sheet

## Script files are separate

**Rules code and Referral Form code are different Apps Script files. Do not
combine them.** `Code.gs` owns the one shared menu and release workflow;
`questionnaire.gs` converts the Referral Form tab. Do not paste either file
into the other: they are separate script files in the same Apps Script project.

## Install

1. In the authoring workbook, open **Extensions → Apps Script**.
2. Replace the complete contents of the existing Rules script with `Code.gs`.
   Create (or replace) a separate script file named `questionnaire` with
   `questionnaire.gs`.
3. Save and reload the workbook. It has one **Foodbank configuration** menu:

   - **Validate configuration** checks both Rules and Referral Form, writes its
     result to `Configuration validation`, and does not overwrite generated JSON.
   - **Generate configuration release** first validates both tabs. If valid, it
     writes Rules JSON, then Questionnaire JSON, then `Generated Configuration
Release` with a generation ID, date/time, and hashes for both outputs.

   Both actions use a temporary sheet toast, not a dialog: an execution should
   finish normally rather than remain Paused waiting for a hidden alert.

4. Fill Rules rows from row 3 and maintain the Referral Form tab. The Rules
   headers are fixed; correct them to the names reported by validation rather
   than using a sheet-setup action.
5. Review `Generated Rules JSON` and `Generated Questionnaire JSON`. The future
   database uploader reads those two cells and the manifest together, shows the
   generation date for confirmation, and refuses a missing or mismatched
   manifest. It then validates the bundle against the target stock catalogue
   before upload.

There are deliberately no separate Rules or Questionnaire generation, copy, or
Rules-sheet setup actions. A configuration release is the only output that can
be imported, so its three generated artefacts always describe one validated
pair.

The combined validation or generation action can be assigned to an inserted
Google Sheets drawing if the charity wants visible buttons. Assign them to
`validateConfigurationRelease` and `generateConfigurationRelease`.

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
| Stock item        | Exact active stock-item name, `$selectedAnswer`, or `$dummy`; never inherited.                                         |
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
Use `$dummy` when an answer only enables later questions: it consumes that
answer without adding a parcel line. `$dummy` still requires a Quantity, using
the same values as every other Stock item row.

The generated result is structurally valid JSON only. The deployed client’s
administrator-only Preference rule check still validates keys, answer values,
and active stock names against the current environment. `$dummy` is the one
reserved Stock item value that deliberately has no active-stock match.

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
Yes for a question marked **Use for picking rules?**. **For Listener Sheet** is
column 14, immediately after **For Fuel Team**: enter **Yes** to include that
question on the sensitive listener sheet, or **No** or blank to leave it out.
For an existing workbook, add that column-14 heading before validating; the
generator deliberately refuses a sheet whose fixed headers do not match.

Validation checks the fixed headers, page numbering, unique question keys,
answer-format names, choice-selection limits, defaults, conditional keys and
the one-option-per-row rule. Choice-list selections may be `Choose one`,
`Choose N`, `Choose N-M`, or `Choose up to N`. A required `Choose up to N`
question means choose one to N; an optional one means zero to N. It translates the Sheet's friendly
formats into the client configuration schema, retains the `For Fuel Team` and
`For Listener Sheet` flags and the **Pick-list information** Yes marker,
and separates a blank-line help paragraph from the displayed question.
It deliberately flags incomplete data rather than guessing it: a choice list
without options, a comma-separated option cell, or a condition naming an
unknown key cannot be formatted.

The generated tab is the plain client JSON for the reviewed client import
workflow; it is not CSV. The delivery collection question must use the key
`Collection method`, and its conditional information and confirmation rows must
name that key. `isDelivery` is derived by the client and is never a
questionnaire key.
