# Release process

**Status: agreed design, not yet built.** Pete has settled how the commands work (see
[Settled by Pete](#settled-by-pete)). What remains is arranged at set-up (see the
[Set-up checklist](#set-up-checklist)). The server repository has been asked the same question, and
the commands themselves will live there, so its plan has to agree with this one.

## What we want

- **Normally, Pete develops and releases from his own machine.**
- **A charity-owned laptop is the emergency secondary.** If Pete is unavailable, a developer can
  use it to change the code with AI, test it and push it. A deployer can use it to release to
  **UAT** or **production** without AI, by following a short documented series of commands.

The commands for both are kept in the server repository (see [Settled by Pete](#settled-by-pete)),
so either machine does the same thing in the same way. Nothing depends on personal scripts kept
outside the repositories.

The existing personal **test** environment (Pete's own Cloudflare account) is out of scope. It will
probably be dropped once the system is stable.

## The problem with today's release path

- **Releasing depends on personal scripts.** The commands that actually release live on Pete's
  machine, outside the repositories. They hold the release order, the account settings, the
  build-time values for each environment and the checks made after a deploy. Nobody else can run
  them.
- **Nothing ties a release to a tested pair.** The client and server are released together. Nothing
  records which client commit was tested against which server commit.

## The proposal

### Two rules

1. **The client and server are pushed together, and only after both have passed their tests
   together.** What is on GitHub is always a pair that was tested as a pair.
2. **A release is exactly what is on GitHub.** The release command refuses to run if either local
   repository has uncommitted changes, commits that have not been pushed, or is behind GitHub. What
   is released is never something that exists only on one machine.

### Pushing

One push command pushes both repositories whenever either has anything unpushed. It:

1. **Refuses if either repository has uncommitted changes.** The tests run on the files on disk, so
   anything uncommitted would be tested but not pushed.
2. **Fetches from GitHub and refuses if either repository is behind.** If the other machine has
   pushed since the last pull, the pair on this machine is not the pair that would land on GitHub.
   Pull first, then push.
3. **Runs both repositories' full checks** (in this repository, `npm run check`), **whichever one
   changed.** The client's check is what compares the client against the server's API contract, so a
   server-only change that breaks the client is caught only if the client's check runs too. If
   either fails, nothing is pushed.
4. **Pushes both, and writes the tested pair to a local record** — a gitignored file on that
   machine, naming the client and server commits it tested and pushed.
5. **Says plainly if only one push succeeded.** Git cannot push two repositories as a single step. If
   the second is rejected, GitHub briefly holds a pair that was never tested together. The command
   reports that clearly, and the release command refuses that pair because it does not match the
   record.

**When there is nothing to push, the same command still runs both checks and writes the record.**
That is how a machine records a pair someone else pushed. The emergency laptop does this after
pulling Pete's latest work: pull, run the push command, then release.

An ordinary `git push` is not intercepted. Using the push command is the process. A plain push skips
the tests and writes no record, so the release command will refuse whatever it pushed until the push
command has been run on that pair.

### Releasing

One command, naming the environment (UAT or production), kept in the repository and documented in
plain steps. It:

1. **Fetches from GitHub and confirms both repositories match it exactly**: no local changes, nothing
   unpushed, nothing newer on GitHub that has not been pulled. Otherwise it stops and says why.
2. **Confirms the pair matches this machine's record.** The commits on GitHub must be the ones the
   push command last tested on this machine. A half-finished push, a plain `git push`, or someone
   else's push that this machine has not tested is refused, with a message saying to run the push
   command first. The release command does not run the tests again itself.
3. **Shows what it is about to release** — the environment, both commits and the changes since the
   last release — and asks for confirmation. For production it also says whether this exact pair has
   already been released to UAT.
4. **Applies the server's database migrations**, deploys the server, then deploys the client, with
   each environment's build settings (the bot-check key, the sign-in mode, the Google sign-in client)
   written in the command rather than remembered.
5. **Verifies the result**: the deployed commits are the ones checked, the server reports healthy,
   the client loads, and a public API request works through the client.
6. **Records the release** by pushing a tag naming the environment and date to both repositories.
   That tag is the record of which client and server versions went out together, and it lets a
   production release confirm that its pair passed UAT first.

### The emergency laptop

- **Both repositories are cloned side by side** (`foodbankclient` and `foodbankserver`), with the
  versions of Node and the other tools the repositories require. Setting it up is documented in the
  repository, so it can be rebuilt if it is lost.
- **A marker identifies it as the secondary machine.** This is a small file outside both
  repositories, written once at set-up. On this machine, work starts by pulling both repositories,
  because Pete's machine will normally have moved on since it was last used. The marker is a guard
  against mistakes, not a security control.
- **The charity's Cloudflare API token is kept in the laptop's keychain**, never in a file or a
  repository. Pete's machine holds its own. Each can be withdrawn without affecting the other.
- **The developer signs in to a charity Claude account** when they need AI. The deployer never needs
  it.

### What this proves, and what it does not

- **The record shows that the push command passed both checks on the pair being released**, on the
  machine doing the release. It is a local file, so it is evidence that the process was followed, not
  proof. It does not prove the checks are good, either. A missing test is still missing.
- **Whoever can sign in to a machine holding the credential can release, or change the commands.**
  The guarantee is only as strong as the control over those machines and accounts.
- **Database migrations cannot be rolled back.** Reverting a Worker to an earlier version is quick.
  Reversing a migration that has already run against the database is not. The deployer needs to know
  that before confirming a production release.
- **The server and client are deployed one after the other.** For a short time the old client runs
  against the new server. Pete has accepted that this can briefly break things for anyone using the
  system during a release, so releases should be made at quiet times. Anyone affected reloads the
  page.
- **Some checks only a person can do.** The items in
  [`docs/operations/deploy-verification.md`](../operations/deploy-verification.md) stay manual. The
  deployer needs to know which of them apply to a given release.

## Set-up checklist

None of these block the design. They are arranged with the charity when the laptop is set up.

1. **The laptop** — who looks after it, who can sign in, and disk encryption, since it holds a
   credential that can change the live system.
2. **The Cloudflare credentials** — a token for the charity's account on Pete's machine and on the
   laptop, with only the permissions a release needs, and who can issue a new one.
3. **The Claude account** — a charity account for AI on the laptop. AI is never pointed at UAT or
   production data; development uses local, made-up data only.
4. **Who may release** — to UAT and to production when Pete is unavailable.
5. **GitHub access** — the laptop's own access to push to both repositories, not dependent on
   reaching Pete.
6. **The external sign-ups** — an owner at the charity for the production Turnstile widget and the
   Google sign-in client.

## Settled by Pete

- **The commands live in the server repository.** The release starts with the server's migrations and
  deploy, and the server owns the shared domain. This repository's documentation points to them.
- **The tested pair is a gitignored local record**, written by the push command, including when there
  is nothing to push. The release command refuses a pair that does not match it.
- **The release command does not re-run the tests.** It trusts this machine's record.
- **An ordinary `git push` is not intercepted.** There is no pre-push hook. Using the push command is
  the process, and the record check at release catches a push that skipped it.
- **No backward-compatibility rule between releases.** A brief break while the server is ahead of the
  client is accepted. Releases are made at quiet times.

## Needed in this repository whatever the charity decides

These do not depend on the decisions above. They are listed here so they are not lost. None of them
has been done.

- **`.claude/settings.local.json` is committed.** It is meant to be one person's file, and it grants
  broad command permissions that the laptop would inherit without anyone knowing. Untrack it and
  commit a short, deliberate `.claude/settings.json` instead.
- **The default build target deploys the test configuration.** A build without `CLOUDFLARE_ENV`
  binds to `foodbank-server`. Run against the charity's account, it would create a stray Worker. When
  test is dropped, the default should be one that cannot deploy anywhere.
- **`npm run deploy` and `npm run deploy:uat` do not set the build-time values** (Turnstile sitekey,
  sign-in mode, Google client id). Run as they are, they ship a build with no bot check and the wrong
  sign-in screen. The release command replaces them, and they should then be removed so there is one
  way to release.
- **There is no `.env.example`** for setting up the laptop. The README's note on the local service
  binding names `api-test`, but `wrangler.jsonc` binds `foodbank-server`, which will send someone the
  wrong way.
- **Loose working files are committed at the root:** `For Jessica.rtf`, `referral details.txt`,
  `Referral questions.csv` and `outputs/`. They are internal notes and correspondence, and they
  belong in the charity's shared storage, not the repository.
