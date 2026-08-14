# Automatic preference picking — agreed design

The charity has chosen Option 2: bounded, client-evaluated rules with
item-level attention. The rules remain client configuration; the server
receives their resolved stock-item lines when it creates a parcel.

## Aim

Some referral preferences name a single stock item and can save a team leader
from repeatedly finding that item in the parcel editor. Other preferences,
particularly free text and choices that need judgement, must remain visible
for a team leader to consider.

## Option 1 — direct automatic matches

The referral form remains client-owned configuration. A choice preference may
declare `autoPicking: true`. Each selected answer to that question must be the
exact name of one active stock item. The configured answer is the connection;
there is no second mapping file and the server does not load the form JSON.

The client validates the shipped configuration against the live stock-item
list in each environment. Zero matches or more than one match is a visible
configuration error and is never silently applied. Exact matching is
deliberate: a renamed stock item must be repaired in the configuration rather
than guessed at by normalisation.

This is intentionally only suitable for straightforward, quantity-one
preferences. It has no conditions or family-size calculation.

## Option 2 — bounded ordered rules

If the charity has clear, repeatable rules that depend on household facts, the
same client configuration could instead carry a deliberately bounded rule. It
is not a general expression language: a rule has one preference trigger, an
ordered list of cases, and an `otherwise` result. `otherwise` is always
present and `cases` is always present, even when it is empty. A rule never has
a direct `set`, so there is only one shape to remember.

```json
{
  "when": { "key": "Toiletries" },
  "cases": [
    {
      "familySize": { "people": "total", "atLeast": 4 },
      "set": [{ "stock": "$selectedAnswer", "quantity": 2 }]
    }
  ],
  "otherwise": {
    "set": [{ "stock": "$selectedAnswer", "quantity": 1 }]
  }
}
```

`$selectedAnswer` means that the rule runs once for every selected answer to
the preference and uses that answer as the stock-item name. It removes the
need to repeat mappings for a multi-select question whose choices all have the
same stock-item names. For the example above, a household of four or more
gets quantity 2 of each selected toiletry; every other household gets quantity
1 of each.

Cases are evaluated in written order and the **first matching case wins**. An
empty `cases` array therefore means that `otherwise` always applies. The only
secondary condition is `familySize`: its `people` value is one of `adults`,
`children` or `total`, and its `atLeast` value is a whole number. `total` is
adults plus children. These are the operational household counts, not the four
age-band answers on the referral: `children` is ages 4–11; `adults` is ages
12–17 plus 18+; and infants aged 0–3 are ignored. There are no generic
comparisons or arbitrary filter keys. No nesting, arithmetic, negation,
substitutions or rule-to-rule references are permitted.

Rules themselves also run in written order. Every rule that handles a selected
answer consumes that answer, so later rules for the same question only see the
answers not already handled. Put a specific rule — such as a household's
large/small laundry-powder choice — before a broad `$selectedAnswer` rule.
Every positive output is additive: two selected answers that each set one pack
of Wipes result in two packs. **Needs team-leader attention** remains dominant
over any positive quantity for that item.

The collected fixed-field keys are `infants`, `children4To11`,
`teenagers12To17` and `adults18Plus`. Every band is collected with zero when
empty; the client derives the operational values above before model-parcel
lookup and rule evaluation.

### Charity-maintained authoring workbook

Option 2 may be maintained in a Google Sheets workbook rather than by asking
the charity to edit JSON. Its Apps Script validates the bounded picking rules
and generates the client rule configuration. The generated file, rather than
the spreadsheet, is committed and promoted through development and test as
normal. The Rules and Questionnaire tabs are usable. Their Apps Script
validates the charity-maintained rows and writes reviewed JSON to a separate
generated tab; only that generated JSON enters the normal client review and
release path.

The **Questionnaire** tab has one row per answer option, with the page, stable
question key, displayed question, type, required/preference flags, displayed
answer text and stable stored answer. The **Rules** tab has one row per item in
a `set`: blank inherited condition cells mean the same rule, case and
family-size condition as the row above. A new `Case` or `Otherwise` cell starts
a new outcome block. Stock item and quantity are never inherited.

Quantity is a dropdown of whole numbers 1–10 plus **Needs team-leader
attention**. The latter generates `quantity: -1` for the named stock item and
therefore represents item-level attention; it does not allow a `-1` quantity
to be configured directly. The generator must reject a first-row inheritance,
an incomplete case, a conditional `Otherwise`, a missing stock item or
quantity, and any value outside the bounded grammar. Before producing JSON it
shows the fully expanded rules, so inherited cells and the first-match order
can be checked.

The workbook must keep question keys and stored answer values distinct from
their displayed wording. Changing wording is safe; changing either stable
identifier is a deliberate compatibility change that requires the generated
configuration, rules and historic-answer interpretation to be reviewed.

The generated configuration remains subject to the admin-only browser
environment check. That check verifies the current questionnaire keys and
stored answers and the active stock item names in the target environment; a
spreadsheet alone cannot prove that its output matches development or test.
If that check fails while a team lead opens a session, the client does not send
a pick-list-generation request or describe the problem as a lost connection:
it identifies the rules that an administrator needs to fix.

### Illustrative examples for the charity

These examples show what the configuration can express; they are not proposed
food-bank policy.

**1. Every selected household item gets one.** There is no family-size rule,
but the uniform empty `cases` array makes the fallback unambiguous.

```json
{
  "when": { "key": "Household" },
  "cases": [],
  "otherwise": {
    "set": [{ "stock": "$selectedAnswer", "quantity": 1 }]
  }
}
```

**2. A rule based on adults.** This illustrative tea-and-coffee rule is active
only when Both was selected; four or more adults receive the higher quantity.

```json
{
  "when": { "key": "Tea/Coffee", "hasAnswer": "Both" },
  "cases": [
    {
      "familySize": { "people": "adults", "atLeast": 4 },
      "set": [
        { "stock": "Tea", "quantity": 2 },
        { "stock": "Coffee", "quantity": 2 }
      ]
    }
  ],
  "otherwise": {
    "set": [
      { "stock": "Tea", "quantity": 1 },
      { "stock": "Coffee", "quantity": 1 }
    ]
  }
}
```

**3. A rule based on children.** This shows the same selected-answer shortcut
with a different household count.

```json
{
  "when": { "key": "Nappies" },
  "cases": [
    {
      "familySize": { "people": "children", "atLeast": 3 },
      "set": [{ "stock": "$selectedAnswer", "quantity": 2 }]
    }
  ],
  "otherwise": {
    "set": [{ "stock": "$selectedAnswer", "quantity": 1 }]
  }
}
```

**4. A rule based on the whole household.** This is the original toiletries
example: every selected item receives quantity 2 for four or more people and
quantity 1 otherwise.

```json
{
  "when": { "key": "Toiletries" },
  "cases": [
    {
      "familySize": { "people": "total", "atLeast": 4 },
      "set": [{ "stock": "$selectedAnswer", "quantity": 2 }]
    }
  ],
  "otherwise": {
    "set": [{ "stock": "$selectedAnswer", "quantity": 1 }]
  }
}
```

An admin-only rule-health check would validate the client configuration
against the current environment. It rejects unknown keys, an invalid
`familySize.people` value, a non-integer `atLeast`, unavailable answer values,
stock names with zero or multiple active matches, missing `otherwise` clauses,
and conflicting writes to the same stock item. A preference that needs facts
the referral does not collect remains **Needs attention**, rather than
inventing a value.

### Item-level needs attention

The charity chose item-level attention. A rule can name a stock item with
quantity **Needs team-leader attention**: the item is relevant, but a team
leader must decide its quantity or remove it.

## Applying either option

The client evaluates the selected option before pick-list generation, using the
referral facts and the active stock-item list it already fetches for the parcel
editor. Exact stock-name matches are resolved there to stock-item IDs: there
are no per-item server lookups.

The generation request carries the client-evaluated preference lines, keyed by
referral ID. The server continues to choose the referral, household size and
model parcel itself, then atomically merges those preference lines when it
creates a new parcel. A later reconciliation call never changes an existing
parcel, so the parcel's existence replaces the earlier proposed
`autoPreferencesAppliedAt` flag and no second add-after-generation step is
needed.

The merge must ensure at least the requested quantity rather than blindly add
to a model quantity. The server validates that the referral belongs to the
session, each stock item is active, quantities are whole and positive, and no
stock item appears twice for one referral. The client validator catches rule
conflicts before that point.

The generated parcel retains an item-level attention line at quantity `-1`.
It is not a quantity to print or issue. The parcel editor renders it as
**Needs attention** rather than as a negative number; the team leader replaces
it with a positive quantity or removes it with quantity 0. This uses the line
itself as the durable prompt, so no source/provenance field or
browser-persisted task list is necessary.

No parcel with a `-1` line may be marked reviewed. Printing is also available
only after every parcel in the pick list is reviewed, so an unresolved item can
reach neither paper nor stock. If the charity instead chooses answer-level
attention, it cannot be represented by a stock-item quantity and needs a
separate rendered preference prompt.

Configuration changes do not silently alter an existing parcel. A charity
decision would be needed before any one-off reapplication to existing parcels.

## Deliberate limits

Both options use exact active stock-item-name matches and leave the server
unaware of the client JSON. Option 2 allows only the constrained cases above;
it does not add family composition facts that are not collected, substitutions,
quantities derived from a model parcel, or a general rule language. Those all
require separate charity requirements.
