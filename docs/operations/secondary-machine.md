# Working on the secondary machine

You are reading this because `secondary.local` exists in this repository's root. That empty,
gitignored file is created by the project directory's bootstrap on the charity's **secondary
machine**, the one kept for emergency fixes when Pete is unavailable. On Pete's own machine there is
no marker, and none of this applies: there, a push is just a push.

**These rules override `CLAUDE.md` on pulling, pushing, building and deploying.** Everything else in
`CLAUDE.md` still applies. The rules shared with the server are in `../secondary.md`, in the project
directory; this file is what is different for the client.

## Before starting work

- **Fetch and compare with GitHub before changing anything.** Pete's machine will normally have moved
  on since this one was last used. If this repository or `../foodbankserver` is behind its default
  branch, say so and pull first. The default branches differ — `master` here, `main` for the server —
  so read each from GitHub (`git ls-remote --symref origin HEAD`) rather than assuming.
- **If a pull would conflict with local changes, stop and ask the person.** Never resolve it by
  discarding either side.

## Pushing

**"Push" means the project's push command, never `git push`.** That command runs this repository's
`npm run check` and the server's full checks, pushes the client and the server together, and records
the tested pair on this machine. A deploy from this machine refuses any pair it did not record.

- **Never run `git push` here**, never push this repository without the server, and never force a
  push.
- **Commit as usual**, with `npm run check` passing first. Committing is local and changes nothing
  anyone else sees.
- **To push, run `../push`** from this repository (it is `push` in the project directory). It
  refuses on uncommitted changes or if either repository is behind GitHub, then runs both full checks
  before pushing, which takes several minutes.

## While a deploy is waiting

**Run `../deploy status` before changing anything.** If a deploy is waiting for the night, do not
commit, pull or switch branch in this repository or the server until it has run: the deploy checks
that both still match what was approved, and stands down if either has changed. Building and
testing are safe — the client was uploaded to Cloudflare during preparation, so the deploy does not
use this repository's `dist/`.

## Deploying

**Deploying is the person's job, through the project's deploy command**, described in
`../deploy-spec.md`. From a session here:

- Never run `npm run deploy` or `npm run deploy:uat`, or `wrangler deploy` by any route.
- Never migrate a database, here or in the server.
- Never ask for, read or store the charity's Cloudflare token or the Resend key.
