# Prepare anonymised legacy referrals

`prepare-anonymised-referrals.mjs` converts the timestamped rows in a legacy
Google Forms CSV into a system-independent current-form scenario file.
It replaces every identifier with artificial test data and reports mappings by
source **column and row number only**. It never prints source cell values.

```sh
node tools/prepare-anonymised-referrals.mjs \
  --file /Users/petebennett/Downloads/sampledata.csv \
  > /private/tmp/prepared-referrals.json
```

The command is deliberately preparation-only. It creates no record in a Foodbank
system, and contains no session ID or reason ID because those are environment
lookups for the second step. Do not submit this JSON to `POST
/api/v1/public/referrals`: that endpoint is a non-idempotent, rate-limited
public form endpoint and deployed dev/test environments use Turnstile. The
second step needs a privileged, dev/test-only server ingestion route.

The converter maps only structured values where there is a current equivalent.
It omits obsolete questions and all legacy free text, including dietary,
additional-information, and query columns, because they can contain sensitive
or identifying information. It also omits a legacy explanatory/default sentence
rather than mistaking it for a household preference. An entry under
`report.unresolved` means the source held a structured value but the converter
could not safely choose a current equivalent.

Do not commit either the source CSV or the prepared JSON. The latter has no
identifiers, but it remains an operational test scenario; keep it in a protected
temporary location and inspect `report` before supplying it to the dev/test
loader.

When the server's dev/test-only import endpoint is deployed, load the reviewed
file with `load-anonymised-referrals --dev|--test --session-id UUID --source
FILE --email ADMIN_EMAIL`. It refuses any environment other than dev/test.
