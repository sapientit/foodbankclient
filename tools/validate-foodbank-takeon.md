# Validate a Foodbank take-on

`validate-foodbank-takeon` is a local Node command for a substantial initial
load or configuration change. It is not part of the browser application and it
does not make the Google workbook live configuration.

Load stock and model parcels into the chosen development or test system first
using `load-foodbank-stock`. The validator then reads the reviewed JSON directly
from `Generated Questionnaire JSON!A2` and `Generated Rules JSON!A2`:

```sh
node tools/validate-foodbank-takeon.mjs \
  --base-url http://127.0.0.1:8787 \
  --email pete@x.com \
  --spreadsheet-id AUTHORING_WORKBOOK_ID \
  --google-client-id GOOGLE_DESKTOP_OAUTH_CLIENT_ID
```

Each direct read prints a Google sign-in address. Open it in a browser,
sign in with an account that can read the authoring workbook, and approve the
read-only Sheets request. The token remains only in the running command; it is
not written to disk. The command signs in through the existing development/test
API login and reads the catalogue through `GET /api/v1/stock/items`. It checks
the proposed questionnaire and rules together, frozen answer-key compatibility,
preference keys and offered answers, and that every fixed or `$selectedAnswer`
stock name resolves to exactly one active item. `$dummy` is the one reserved
stock value: it consumes a controlling answer without adding a parcel line, so
it deliberately has no stock lookup, though it still needs a normal quantity.
The command reports all detected configuration problems and changes no files by
default.

The Desktop OAuth client secret is required by Google's token endpoint, but is
not stored by the validator. Supply it only for the command being run:

```sh
GOOGLE_SHEETS_CLIENT_SECRET=YOUR_DESKTOP_CLIENT_SECRET \
  node tools/validate-foodbank-takeon.mjs [the arguments above]
```

If Google rejects the final token exchange, the command reports its HTTP status
and bounded OAuth error description, but never the authorisation code, token or
client secret.

## One-time Google setup

In the charity's Google Cloud project, enable the Google Sheets API and create
a **Desktop app** OAuth client. Use its client ID above; do not download,
commit, or supply a client secret. The command uses a temporary localhost
callback and PKCE, requests only
`https://www.googleapis.com/auth/spreadsheets.readonly`, and never requests an
offline/refresh token. The chosen Google account must already have access to
the authoring workbook.

The spreadsheet ID is the long identifier between `/d/` and `/edit` in the
workbook URL. It is not the deployment's referral-extract spreadsheet unless
that is deliberately the same workbook.

For an offline fallback, pass both reviewed files instead:

```sh
node tools/validate-foodbank-takeon.mjs \
  --base-url http://127.0.0.1:8787 \
  --email pete@x.com \
  --questionnaire /path/to/reviewed-questionnaire.json \
  --rules /path/to/reviewed-rules.json
```

After reviewing the clean result, add `--write` to replace the questionnaire,
frozen answer-key ledger and preference-rules configuration as one guarded
local operation. Formatting and both focused configuration tests run after the
write; failure restores all three files.

The development login route is deliberately unavailable in production. Do not
use this command against a live system until a separately agreed short-lived
administrator-token mode exists. Review the resulting diff, run `npm run
check`, test the release environment, and deploy normally.
