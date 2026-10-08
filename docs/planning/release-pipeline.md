# Release process

**Status: agreed design, not yet built.** Pete has settled how the commands work (see
[Settled by Pete](#settled-by-pete)). What remains is arranged at set-up (see the
[Set-up checklist](#set-up-checklist)), and in the open points of the deploy specification,
`deploy-spec.md` in the project repository. The server repository has been asked the same question, and the commands
themselves will live in a third repository that holds both (see
[The project directory](#the-project-directory)), so all three have to agree.

## What we want

- **Normally, Pete develops and releases from his own machine.**
- **A charity-owned laptop is the emergency secondary.** If Pete is unavailable, a developer can
  use it to change the code with AI, test it and push it. A deployer can use it to release to
  **UAT** or **production** without AI, by following a short documented series of commands.

The commands for both are kept in a small project repository that holds the client and server (see
[The project directory](#the-project-directory)), so either machine does the same thing in the same
way. Nothing depends on personal scripts kept
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

The same applies to the project repository that holds the commands: a release refuses to run if it has
uncommitted changes, unpushed commits or is behind GitHub, so a command edited on one machine never
runs a release nobody else has seen.

### The project directory

A third, small GitHub repository holds the push, release and bootstrap commands and a README. Nothing
else. The client and server stay separate repositories, cloned inside it:

```
foodbank/                  the project repository: commands, bootstrap, README
├── foodbankclient/        this repository, cloned here and ignored by the project repository
└── foodbankserver/        the server repository, cloned here and ignored by the project repository
```

- **Setting up a machine is two steps:** clone the project repository, then run its bootstrap
  command, which clones the client and server inside it and checks the tools they need.
- **The folders keep their names**, `foodbankclient` and `foodbankserver`. The client reaches the
  server as `../foodbankserver` (`npm run api:types`, `scripts/check-api-types.mjs`, and its docs), so
  with the same names nothing in either existing repository changes.
- **Plain clones, not git submodules.** Submodules are easy to get into a confusing state, and the
  deployer has no AI to untangle one. The tested pair stays a local record, as settled below.
- **AI sessions start inside `foodbankclient` or `foodbankserver`, never in the project directory.**
  Each repository's rules let it see the other only through its documentation; a session started in
  the parent would see both. The README says so.

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

**The deploy is now specified in `deploy-spec.md` in the project repository
(`https://github.com/sapientit/foodbank`), which is the source of truth for it** — the steps, the
overnight default, the emergency "deploy now", failure after migrating and what it never does. This
document keeps only the reasoning; where they disagree, the spec wins.

In outline: a person prepares a deploy in the evening (every check, the build, an approval), and by
default the same machine deploys it unattended after the server's 02:17 job and before 07:00,
emailing the result through Resend; a failure waits for a person at 07:00. In an emergency, the
person can choose to deploy now instead. A deploy with migrations records a D1 Time Travel bookmark
first. Overnight was chosen because about 0.3% of referrals arrive between 23:00 and midnight and
virtually none until 07:00, and nothing can detect a referral in flight.

### The emergency laptop

- **It is set up from the project repository** — clone it, run its bootstrap command — with the
  versions of Node and the other tools the repositories require. Setting it up is documented there,
  so it can be rebuilt if it is lost.
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
  Reversing a migration that has already run against the database is not: the only way back is a
  whole-database Time Travel restore to the bookmark (see "When a deploy fails after migrating" in
  `deploy-spec.md`).
- **The server and client are deployed one after the other.** For a short time the old client runs
  against the new server. Pete has accepted that this can briefly break things for anyone using the
  system during a release, which is one reason releases run overnight. Anyone affected reloads the
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
5. **GitHub access** — the laptop's own access to push to all three repositories, not dependent on
   reaching Pete, and which GitHub account owns the new project repository.
6. **The external sign-ups** — an owner at the charity for the production Turnstile widget and the
   Google sign-in client.
7. **The Resend account** — a food bank account with 2-Step Verification, the DNS records that
   verify `guildfordfoodbank.org` for sending (added by whoever controls that domain), a sending-only
   API key in the keychain of each machine that releases, the list of who receives the result, and
   the charity's sign-off for a new third party.

## Settled by Pete

- **The commands live in a project repository that holds the client and server** (2026-10-08,
  replacing the earlier decision to keep them in the server repository). It is cloned as the parent
  directory, with the two existing repositories cloned inside it under their current names. This
  repository's documentation points to it.
- **The tested pair is a gitignored local record**, written by the push command, including when there
  is nothing to push. The release command refuses a pair that does not match it.
- **The release command does not re-run the tests.** It trusts this machine's record.
- **An ordinary `git push` is not intercepted.** There is no pre-push hook. Using the push command is
  the process, and the record check at release catches a push that skipped it.
- **No backward-compatibility rule between releases.** A brief break while the server is ahead of the
  client is accepted, because releases run overnight.
- **Releases run automatically overnight, between midnight and 07:00** (2026-10-08). About 0.3% of
  referrals arrive between 23:00 and midnight and virtually none until 07:00, and nothing can detect a
  referral in flight, so the window is the protection.
- **A release with migrations records a Time Travel bookmark first**, and stops if it cannot
  (2026-10-08). That bookmark is the restore point if the release fails after migrating.
- **A release has an evening part and an overnight part, on the same machine** (2026-10-08). The
  evening part runs every check with someone online and ends in an approval. The machine is then left
  running overnight to deploy and email whether it succeeded or failed.
- **A failure overnight waits for 07:00** (2026-10-08). The design has to make failure rare enough
  for that; the command does not repair itself, and a person deals with the failure email at 07:00.
- **The deploy starts after the 02:17 nightly job** (2026-10-08), so a release never overlaps session
  materialisation or the purges.
- **The evening part builds both repositories** (2026-10-08), and the overnight part deploys those
  files without building.
- **Result emails are sent through Resend** (2026-10-08), from an address on the food bank's own
  domain, by a single HTTPS request with an API key kept in the keychain. Its free plan (3,000 a month,
  100 a day) is far beyond what releases need, and it pauses rather than bills when exceeded. Chosen
  over Gmail because a Resend key can only send: it opens no mailbox, needs no sign-in page and does
  not depend on anyone's personal Google account. The emails carry no personal data.
- **The first production migration is run by hand and watched** (2026-10-08), outside the automated
  release, as the server's `production.md` requires. The automated release takes over after it.

## Open points

The deploy's open points now live in `deploy-spec.md` in the project repository, with the spec they
belong to.

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
- **There is no `.env.example`** for setting up the laptop. (The README's wrong service-binding name,
  listed here before, was fixed on 2026-10-08.)
- **Loose working files are committed at the root:** `For Jessica.rtf`, `referral details.txt`,
  `Referral questions.csv` and `outputs/`. They are internal notes and correspondence, and they
  belong in the charity's shared storage, not the repository.
