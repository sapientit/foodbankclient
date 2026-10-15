# October 2026 session and composition changes — server handoff

This document specifies the server-owned work behind the agreed client changes. It is a handoff for `../foodbankserver`; it does not authorise client implementation by itself.

## 1. Household composition: infants 0–2, children 3–11

### Settled behaviour

- The `Household Components` dynamic answer changes its first two age-band keys from `0-4` and `5-11` to `0-2` and `3-11`.
- For a new referral, counts in the `3-11` band contribute to the submitted fixed `children` count. Ages `0-2` do not.
- Existing referrals are deliberately not migrated or recalculated. None are live, and historic answers remain interpretable under their own configuration release.

### Server work

1. Amend `INITIAL_SPEC1.txt` to state the new five bands: `0-2`, `3-11`, `12-17`, `18 to State Pension age`, and `State Pension age or over`.
2. Preserve the existing boundary: the server stores `Household Components` verbatim and validates only the submitted `adults` and `children` numbers. It must not derive a count from either the old or new band labels.
3. No schema migration, data migration, or API field change is required for this item.

### Configuration-workbook action for the charity

None. The authoring workbook only identifies this control as the fixed `HouseholdComposition` validation type; it does not define the five displayed bands or their JSON keys. The client owns those fixed bands and now emits `0-2` and `3-11` for new referrals. Do not alter the `Household Components` question key or create/publish a configuration release for this change.

## 2. Run-sheet operational columns

The Run sheet now needs two compact operational values: the pick-list administrator note and whether the household is a delivery. It must no longer receive the referral `answers` map merely to extract the `Other` answer.

### Change `GET /api/v1/sessions/{sessionId}/referral-details`

For each `ReferralDetailsHousehold`, add these required nullable/derived fields:

```yaml
picklistAdmin:
  type: [string, 'null']
  maxLength: 80
  description: >-
    The referral's current administrator note for the picker. It is supplied to
    a team lead only on this operational Run-sheet response and must never
    contain the reason for referral.
isDelivery:
  type: boolean
  description: >-
    Derived from collectionMethod: true only where collectionMethod is
    delivery. The Run sheet uses it as a compact delivery marker.
```

Remove `answers` and `formId` from this response and its required list. They are no longer needed once `Other` stops appearing on the Run sheet, and removing them narrows a team-lead payload which otherwise exposes every dynamic referral answer.

Retain the endpoint's existing household inclusion and ordering: current booked households only, including deliveries; cancelled and rejected referrals excluded; ordered by surname then first name.

### Related server specification/API updates

1. Update `INITIAL_SPEC1.txt` and `API.md` so that the Client List and Run sheet show the pick-list administrator note instead of the referrer's `Other` answer.
2. Update the existing `Referral.picklistAdmin` description that currently excludes the referral-details/Run-sheet response.
3. Keep `Parcel.picklistAdmin` unchanged. It already supports the Client List and is deliberately current rather than snapshotted.
4. Do not send the reason for referral, review comment, administrator notes, date of birth, parcel contents, referrer email, or arbitrary `answers` on this endpoint.

### Required server tests

- Team-lead and administrator callers receive the current `picklistAdmin` and derived `isDelivery`.
- A caller receives neither `answers` nor `formId` from the Run-sheet endpoint.
- A changed `picklistAdmin` is reflected on the next read without regenerating a pick list.
- A delivery returns `isDelivery: true`; collection and referrer collection return `false`.
- Existing role and exclusion boundaries remain intact.

## 3. New team-lead session model-summary screen

Add a narrow, read-only endpoint for the new Run-a-session sub-screen. The server, not the client, performs the current household-grid lookup: the grid and model-parcel maintenance remain administrator-only.

### Proposed route

`GET /api/v1/sessions/{sessionId}/model-summary`

Available to `team_lead` and `administrator` only. It returns the current households holding a place on the session, with only:

```yaml
sessionId: uuid
households:
  - pickNumber: integer | null
    modelParcelName: string | null
    refereeFirstName: string | null
    refereeSurname: string | null
    adults: integer
    children: integer
```

`modelParcelName` is resolved from the _current_ household grid for the row's fixed `adults` and `children` values on every request. It is not persisted on a referral or parcel, and the response must not include the grid, model-parcel contents, stock lines, preferences, addresses, phone numbers, dates of birth, referral reasons, or answers.

`pickNumber` is nullable because a session can have booked households before pick lists have been prepared. The client displays a blank/placeholder for that state and can still show the current model lookup.

### Missing current grid mapping

If the current household grid lacks a mapping for a household in the session, return that household with `modelParcelName: null`; do not substitute an old parcel model or invent a name. This lets the client show that the current lookup is incomplete while still providing the rest of the operational list. This condition is intentionally distinct from pick-list generation, which continues to refuse a generation when no model is configured.

### Server specification/API updates

1. Amend `INITIAL_SPEC1.txt`'s team-lead/model-parcel boundary: team leads still cannot browse or amend the grid or model parcels, but may receive the resolved current model name in this one session-scoped operational response.
2. Document that changing the grid changes the next model-summary read, even where a parcel was created under an earlier grid. This is the requested behaviour and is not a historical parcel record.
3. Add the route and schema to `openapi.yaml` and `API.md`; mark any remaining unsettled response semantics with `x-assumed` until confirmed.

### Required server tests

- Team lead can read the narrow response; an unauthorised role is refused.
- A grid edit changes the next read's model name without rewriting referrals or parcels.
- A household without a pick list returns a null pick number, not a fabricated number.
- A missing current mapping yields a null model name and leaks no grid/model contents.
- Cancelled and rejected referrals are absent.

## 4. Stock-take paging and leave protection

No server API or database change is required. `POST /api/v1/stock/take` already saves independently resumable pages and is idempotent for a repeated page save. The client will use that existing guarantee to save changed counts before page navigation. Browser close/reload cannot reliably await a network mutation, so the client must use the browser leave warning for that case.

## Compatibility and delivery order

1. Publish the Run-sheet and model-summary OpenAPI changes first, with server tests.
2. Regenerate the client schema from the updated OpenAPI document; do not hand-edit `src/api/schema.d.ts`.
3. Deliver the client routes/screens and behaviour against the generated contract.
4. Make the workbook/release change only when the client that understands the new age-band keys is deployed to the target environment.
