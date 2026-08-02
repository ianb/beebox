# Scan-uploader setup UI + minimal install story

A settings-page surface for scan uploaders — mint a token (shown once), see
every uploader with honest last-activity, revoke — plus a `configure`
subcommand that takes the pasted token and writes the uploader's own config,
and an installation story that covers only "clone the repo, install the one
subdirectory."

**Revised 2026-08-01 after a Codex cross-model review**
(`scan-uploader-pairing.review.md`): the original unauthenticated
pairing-code protocol (new redeem route, hub exemption, dedicated limiter)
is dropped by boxholder decision — the existing owner-only mint plus a
paste-once `configure` command covers the job with zero new server surface.
The pairing protocol moved to NOT in scope with its revisit trigger.

**Job stories.**
- *When I've just unboxed a document scanner at my desk and want its output
  flowing into a box, I want the box's settings page to hand me a token and
  a short command I paste into a terminal, so I can finish setup without
  hand-editing JSON or hand-placing token files.*
- *When a second household machine (or a rebuilt laptop) needs to upload
  scans, I want setting it up to be the same two minutes as the first
  machine, so adding capacity doesn't mean re-deriving the setup from old
  notes.*
- *When I look at the settings page months later, I want to see which
  uploaders exist and when each was last active, so I can revoke a machine
  I no longer own.*

## Stated preferences this plan trades against

- `docs/engineering-principles.md`: **#3 validate-at-boundaries** (the
  `configure` command validates the pasted token's use before declaring
  success; the config writer validates what it writes); **#4
  resilient-and-never-silent** (every setup failure names the flag, file,
  or field); **#5 failure paths visible in signatures**; **#6 right-sized
  defensiveness** (no new server attack surface at all — the strongest form
  of the principle); **#8 one way to do each thing** (reuse the existing
  `scanTokens` tRPC procedures and the settings-section component shape;
  do NOT build a second credential-exchange protocol).
- `callback-box/CLAUDE.md`: "don't add features beyond what the task
  requires" (the dropped pairing protocol is this rule applied); "Keep
  source and docs generic — never hardcode personal names."
- `callback-box/code-style.md`: Result-vs-throw at boundaries; no default
  parameters; custom error classes (`ConfigError` precedent,
  `scan-uploader/src/errors.ts`).
- Precedents: `CompanionPairingSection.tsx` (one-time secret held in
  component state, auto-cleared); the scan-upload wire contract
  (`docs/scan-upload-contract.md`); the installation-story plan's
  smoke-script verification pattern (`docker/smoke-dev-install.sh`).

## What already exists

- **Token mint/list/revoke** — `src/webapp/trpc/routers/scan-tokens.ts`:
  `create` (owner-only, returns plaintext once — doc comment lines 12-17:
  "`create` is the ONLY place its plaintext ever exists"), `list`
  (summaries incl. `lastUsedAt`), `revoke`. **Reused as-is; zero server
  changes in this plan.**
- **`lastUsedAt` semantics** — `core/token-store.ts:209-223`: stamped by
  `verify` on every authenticated request, i.e. it means "last request,"
  not "last upload." **Reused with honest labeling** (see Track A; Codex
  finding 5).
- **One-time-secret UI pattern** — `CompanionPairingSection.tsx:88-95`
  (mutation-held state, `setTimeout` auto-clear) and its `DeviceRow`
  list/revoke shape. **Copied** as `ScanUploaderSection.tsx`; the copy adds
  clipboard-write rejection handling the original lacks
  (`CompanionPairingSection.tsx:102`; Codex finding 8).
- **Settings page structure** — `SettingsPage.tsx:27`: sections are stacked
  self-contained components. **Extended** with the new section.
- **Uploader config validation (read side)** — `scan-uploader/src/config.ts:37-140`:
  strict fail-closed *reader*; ENOENT is an error; unknown keys are
  accepted and preserved nowhere because nothing writes. **There is no
  writer** — the plan treats the config writer as net-new design (Codex
  finding 6), not reuse.
- **Wire client + empty-check** — `scan-uploader/src/wire-client.ts` (bearer,
  runtime response validation at line 52); `docs/scan-upload-contract.md:62`
  permits an empty `check`. **Reused** for `configure`'s verification call.
- **Install verification precedent** — `callback-box/docker/smoke-dev-install.sh`.
  **Pattern reused** for `scan-uploader/smoke-install.sh`.

## Prior art (external)

- **OAuth 2.0 Device Authorization Grant (RFC 8628)** — the named pattern
  for code-based device pairing. Recorded as the shape the NOT-in-scope
  pairing protocol would take if its threat model ever becomes real.
  https://datatracker.ietf.org/doc/html/rfc8628
- **pnpm filtered install** — `pnpm install --filter <pkg>...` from the
  workspace root installs the filtered package plus its workspace deps
  (https://pnpm.io/filtering). Unverified claim until
  `smoke-install.sh` passes: that this skips `callback-box`'s heavy native
  builds (`better-sqlite3`). The workspace devDeps
  (`@ianbicking/personal-vibe-check`, `agent-doctest` —
  `scan-uploader/package.json`) are expected to come along; they are small
  and build-free. Fallback if the filter disappoints: root install with
  `--ignore-scripts`, documented, or revisiting distribution (NOT in
  scope).
- **Reading a secret from stdin without echo** — Node has no built-in
  no-echo prompt; the standard approach is `readline` with the output
  stream muted, or accepting piped stdin. No dependency will be added;
  piped-or-muted-readline is small enough to hand-roll (matches the
  package's zero-runtime-deps stance, `scan-uploader/README.md:5`).

## Tracks / scope

### Track A — Settings UI section

- **What:** `src/frontend/src/components/settings/ScanUploaderSection.tsx`,
  appended to `SettingsPage.tsx` after the companion section.
- **Why:** minting today requires calling tRPC by hand; there is no
  visibility or revocation surface at all.
- **Direction:**
  - "New uploader token" flow: a name field (client-validated against
    `SCAN_TOKEN_NAME_PATTERN`, defaulted to e.g. `uploader-<date>`) →
    `scanTokens.create` → the token rendered once in a copy block, held
    only in component state and auto-cleared (companion pattern), with the
    paste-ready command beneath it:
    `node dist/scan-uploader.mjs configure https://<host>/<box> --name <name>`
    (the token itself is NOT embedded in the command — it goes via stdin;
    the copy button copies only the token).
  - Clipboard writes handle rejection: on `navigator.clipboard.writeText`
    failure, show "copy failed — select the text manually" instead of
    silently appearing to succeed.
  - Uploaders list via `scanTokens.list`: name, created, revoked badge,
    and `lastUsedAt` labeled **"last request"** — not "last upload" —
    because `TokenStore.verify` stamps it on any authenticated call
    (`token-store.ts:209-223`). A true "last upload" column is deferred
    (NOT in scope) until the server tracks successful PUTs per token.
  - Revoke buttons → `scanTokens.revoke` + list invalidation.
  - Collapsed "first-time setup on a new machine" block containing the
    Track C install story verbatim, so the settings page is
    self-sufficient.
- **First chunk:** the whole section — all three procedures exist today.
  Done-when: section renders, mints, lists with honest labels, revokes;
  frontend lint/typecheck clean; exercised via `bin/browse` against the
  dev box.

### Track B — Uploader `configure` subcommand

- **What:** `node dist/scan-uploader.mjs configure <server-url-with-box>
  --folder <path> [--disposition keep|archive|trash] [--name <token-name>]
  [--config <path>]`; the token arrives on stdin (piped, or prompted
  without echo on a TTY).
- **Why:** the CLI writing its own config is what makes the settings page's
  command sufficient — no JSON hand-editing (first job story).
- **Direction:**
  - Parses `<server-url-with-box>` locally into `serverUrl` + `box` slug;
    the slug is validated against a conservative local pattern before it
    becomes a filename — the token file path
    `~/.scan-tokens/<box>.token` derives only from this locally-validated
    value, never from any server response (Codex finding 4's class,
    eliminated at the root since no server response carries a path
    component at all in this design).
  - **Config writer is net-new, designed here** (Codex finding 6):
    read the existing file as raw JSON (or start from `{ "targets": [] }`
    on ENOENT — the one place ENOENT is legal); refuse to touch a file
    that fails a raw-shape parse ("configure refuses to modify a config it
    cannot parse"); modify the raw `targets` array in place so unknown
    keys anywhere in the document survive; write atomically (temp file +
    rename, the `token-store.ts:225-261` discipline, minus fsync
    ceremony); then run the existing strict reader over the result as a
    post-write assertion. Update-in-place when a target with the same
    `box` + `serverUrl` exists; append otherwise.
  - Token file written 0600, parent dir created 0700; written only after
    the config write succeeds, so a half-configured state is always
    "config points at a token file that doesn't exist yet" — which the
    next run reports by name.
  - Missing `--folder` on a TTY: interactive prompt. Non-TTY with missing
    flags: fail closed naming the exact flags. No placeholder values are
    ever written (the reader can't reject `"FILL-ME-IN"`, so it must never
    exist — Codex finding 6's validation-gap corollary).
  - Verification: one `POST /api/scan/check` with `[]` using the new
    token (legal per `scan-upload-contract.md:62`); prints
    `configured: <name> -> <box> (server verified)` plus the ScanSnap
    checklist as next steps. Failure prints the server's status and leaves
    the written files in place with both paths named.
- **First chunk:** the configure flow + `test/configure.doctest.md`
  against `test/fake-scan-server.ts`: happy path, unknown-key
  preservation, unparseable-config refusal, update-vs-append, 0600
  assertion, non-TTY fail-closed, bad-token verification failure.

### Track C — Minimal install story

- **What:** document and verify: `git clone <repo>` →
  `pnpm install --filter scan-uploader...` (from root) →
  `pnpm --filter scan-uploader build` →
  `node scan-uploader/dist/scan-uploader.mjs configure …`.
  `scan-uploader/smoke-install.sh` proves the sequence from a clean clone
  in a temp dir (fresh store; asserts `better-sqlite3` was NOT built);
  README gains a "Setup" section ordered install → configure → ScanSnap
  profile; `docs/plans/installation-story.md` gets a pointer sentence.
- **Why:** the uploader targets machines that never run a box; today's
  README assumes a working monorepo dev environment (README:105-113).
- **Direction:** no npm publish, no committed `dist/`. This is
  acknowledged as a source-checkout story, not a true end-user install
  (Codex finding 7) — accepted by boxholder decision 2026-08-01; the
  distribution alternatives are recorded in NOT in scope with triggers.
- **First chunk:** `smoke-install.sh` green locally; README rewrite in the
  same commit.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Pasted token is wrong/truncated | planned (configure doctest) | verification `check` fails; files left in place, status printed | clear |
| Config exists but is unparseable JSON | planned (doctest) | configure refuses to modify; names the file | clear |
| Config writer drops unknown keys | planned (doctest asserts preservation) | raw-JSON in-place edit, post-write strict-read assertion | clear (test-guarded) |
| Crash between config write and token-file write | planned (doctest simulates) | ordering guarantees the gap state is "missing token file", reported by name on next run | clear |
| Token file world-readable | planned (doctest asserts mode) | explicit 0600 + 0700 dir | clear |
| Box slug with path tricks becomes a filename | planned (doctest) | local slug pattern validation before any filesystem use | clear |
| Clipboard write rejected in UI | manual (browse pass) | explicit failure message replaces silent no-op | clear |
| "last request" misread as "last upload" | n/a (labeling) | honest label + tooltip; true last-upload deferred | clear |
| Filtered install pulls heavy native builds | smoke script asserts | documented fallback (root install `--ignore-scripts`) | clear (script fails loud) |
| Token minted but never configured (abandoned) | n/a | visible in list as never-used; revoke | clear |

**Critical gap:** none identified.

## Agent-flow / user-flow edge cases

Boxholder-facing infrastructure; the list adapts:

- **Wrong URL pasted (another box's slug)** — ADDRESSED: verification
  `check` runs against the entered URL with the new token; a token minted
  on box A used against box B 401s and configure reports it.
- **Stale ref / revoked token still in config** — ADDRESSED: uploader runs
  401, print target name, exit non-zero; re-run `configure` to replace.
- **Two machines configured with one token** — works (shared credential)
  but muddies revocation; the settings block says "one token per machine"
  and the list's names make drift visible. ADDRESSED by convention, not
  mechanism — accepted.
- **Hand-edit drift in scan-uploader.json** — ADDRESSED: strict reader
  fails closed naming the field; configure refuses unparseable files.
- **Fabricated free-form value** — token `name` is pattern-constrained
  and travels into provenance as `scan-upload/<name>` (`tokens.ts:25-30`);
  both UI and CLI display the chosen name.
- **Validation error UX** — ADDRESSED: every failure names the flag,
  file, or field (Track B direction).
- **Partial migration / transition state** — N/A: purely additive;
  hand-minted tokens and hand-written configs keep working.

## NOT in scope

- **The unauthenticated pairing-code protocol** (short-lived code redeemed
  by the CLI for the token; RFC 8628 shape) — dropped by boxholder
  decision 2026-08-01 after Codex review: it required a new
  unauthenticated route, a hub auth-wall exemption, a dedicated rate
  limiter, and claim/rollback semantics for duplicate names, all to keep
  a revocable token out of one clipboard transit. Revisit trigger: a
  pairing target appears that isn't the same machine as the browser
  (headless appliance), or the threat model elevates clipboard/shoulder
  exposure.
- **Serving the built `scan-uploader.mjs` from the box / npm publish** —
  distribution stays "clone + filtered install" by boxholder decision
  2026-08-01. Revisit trigger: a non-developer needs to run an uploader.
- **True "last upload" tracking** — needs a per-token stamp written only
  by successful PUTs, a server change; the honest "last request" label
  covers the revocation job today.
- **Windows support / `trash` on non-macOS** — inherits the uploader's
  existing posture (README:69-70).
- **Uploader auto-update** — re-run the three install lines.
- **Interactive full-wizard UX (auto-detecting scan folders, launchd
  install)** — print the crontab suggestion; don't write user crontabs
  (#6 right-sized defensiveness).

## Open design questions

None — the two that existed (command-embedded code vs flag; launchd
install) died with the pairing protocol or moved to NOT in scope.

## Knowledge audits

Skip, with rationale: no agent-facing vocabulary is introduced — no tags,
card shapes, or conventions an in-box agent must recall. The settings page
itself is the durable human-facing reference (doc-altitude preference).

## Implementation order

1. **Chunk 1 (Track B):** `configure` subcommand + config writer +
   `test/configure.doctest.md`.
2. **Chunk 2 (Track A):** `ScanUploaderSection.tsx` (mint/list/revoke +
   embedded instructions), exercised via `bin/browse`.
3. **Chunk 3 (Track C):** `smoke-install.sh` + README Setup rewrite +
   installation-story pointer.

Chunk 2 references chunk 1's command syntax; chunk 3 documents both.
No server-side chunks exist.

## Rollout shape

- **Test posture:** chunk 1's doctest is the plan's spine (every
  failure-modes row above with "planned" maps to a doctest example);
  chunk 2 is verified by a browse pass (frontend sections have no doctest
  tier); chunk 3's smoke script is run, not just written, before the plan
  completes.
- **Knowledge audits:** none (rationale above).
- **Migration:** none — additive; existing tokens and configs unchanged.
- Ships as one unit on a worktree branch; merge to main is the
  boxholder's call.
