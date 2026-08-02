# Scan-uploader pairing UI + minimal install story

A settings-page surface that pairs a laptop scan-uploader with a box the way
the mobile companion pairs: the UI mints a short-lived pairing code, the
uploader CLI redeems it for a scan token and writes its own config. Plus an
installation story that covers only "clone the repo, install the one
subdirectory" — so the uploader can be set up on a machine that never runs a
full callback-box dev environment.

**Job stories.**
- *When I've just unboxed a document scanner at my desk and want its output
  flowing into a box, I want the box's settings page to hand me a short
  command I paste into a terminal, so I can finish setup without hand-editing
  JSON, hand-placing token files, or reading a wire-contract doc.*
- *When a second household machine (or a rebuilt laptop) needs to upload
  scans, I want pairing it to be the same two minutes as the first machine,
  so adding capacity doesn't mean re-deriving the setup from old notes.*
- *When I look at the settings page months later, I want to see which
  uploaders exist and when each last uploaded, so I can revoke a machine I
  no longer own.*

## Stated preferences this plan trades against

- `docs/engineering-principles.md`: **#3 validate-at-boundaries** (the
  redeem route is unauthenticated by design — it must validate everything);
  **#4 resilient-and-never-silent** (a failed pair attempt prints why);
  **#5 failure paths visible in signatures** (CLI pair flow returns typed
  results, exits non-zero); **#6 right-sized defensiveness** (defense at the
  redeem boundary; interior reuses verified stores); **#8 one way to do each
  thing** (reuse `TokenStore`, the mobile pairing-ticket pattern, the
  existing `scanTokens` procedures, the settings-section component shape).
- `callback-box/CLAUDE.md`: raw-Fastify-vs-tRPC rule (the redeem route is an
  unauthenticated machine-to-machine POST — raw route, like
  `/api/pairing/redeem`); "don't add features beyond what the task
  requires"; "Keep source and docs generic — never hardcode personal names."
- `callback-box/code-style.md`: Result-vs-throw at the wire boundary; no
  default parameters; custom error classes.
- Precedents: mobile pairing (`src/core/mobile/pairing.ts`,
  `src/webapp/routes/pairing.ts`, `CompanionPairingSection.tsx`) — the
  densest preference here; the scan-upload wire contract
  (`docs/scan-upload-contract.md`); the installation-story plan's
  smoke-script verification pattern (`docker/smoke-dev-install.sh`).

## What already exists

Reuse throughout; the only net-new mechanism is the pair-redeem exchange.

- **Pairing-ticket machinery** — `src/core/mobile/pairing.ts:82-132`:
  `createMobilePairingTicket` (32-byte token, SHA-256 hash in an in-memory
  `Map`, 10-min TTL, plaintext returned once) and
  `redeemMobilePairingTicket` (hash lookup, single-use, expiry check).
  **Pattern reused, instance not** — scan pairing gets its own module
  (`src/core/scan/pairing.ts`) with its own pending map, for the same
  structural-separation reason `core/scan/tokens.ts:1-17` gives for the
  token stores: mobile auth code must never be able to resolve a scan
  credential, and vice versa.
- **Scan token store** — `src/core/scan/tokens.ts`: `createScanToken`
  (name-validated, duplicate-checked under the store lock, plaintext
  returned once, `tokens.ts:109-131`), `listScanTokens` (summaries with
  `lastUsedAt`, `tokens.ts:97-103`), `revokeScanToken`. **Reused as-is** —
  redeem calls `createScanToken`; the UI list/revoke calls the existing
  `scanTokens` tRPC procedures (`src/webapp/trpc/routers/scan-tokens.ts`).
- **Unauthenticated-redeem route precedent** — `src/webapp/routes/pairing.ts:20-39`
  (`POST /api/pairing/redeem`: zod body, 401 with a single generic message
  on any failure) and its two auth-wall allowances (`hub-server.ts`
  `isMobilePairingRedeem`; `server-box-scope.ts` `isPairingRedeemUrl`).
  **Pattern reused** for `POST /api/scan/pair`.
- **Scan route mounting + rate limit** — `src/webapp/routes/scan-upload.ts:226-298`
  registers the scan routes in a sibling scope outside the box auth hook,
  with `consumeScanRateLimit`. **Reused**: the pair route joins this scope
  (it is scan infrastructure with non-standard auth), sharing the rate
  limiter.
- **Settings section shape** — `src/frontend/src/components/settings/CompanionPairingSection.tsx`:
  `Card as="section"` + mutation-held one-time secret auto-cleared at
  `expiresAt` (lines 88-95), devices list + revoke with query invalidation.
  **Copied** as `ScanUploaderSection.tsx`; appended in `SettingsPage.tsx:27`
  next to the companion section.
- **Uploader CLI + config validation** — `scan-uploader/src/cli.ts`,
  `config.ts` (strict fail-closed validation), `wire-client.ts` (bearer +
  the two endpoints). **Extended** with a `pair` subcommand; config
  load/save logic reused for the write path.
- **Install verification precedent** — `callback-box/docker/smoke-dev-install.sh`
  (installation-story plan). **Pattern reused** for a
  `scan-uploader/smoke-install.sh` that proves the filtered install works
  from a clean clone.

## Prior art (external)

- **OAuth 2.0 Device Authorization Grant (RFC 8628)** — the named pattern
  for "constrained client redeems a short user-visible code for a long-lived
  credential." Our flow is the inverted-but-equivalent household version
  (code displayed where the user is authenticated, redeemed by the device);
  the load-bearing properties we take from it: short TTL, single use,
  rate-limited redemption, generic error responses.
  https://datatracker.ietf.org/doc/html/rfc8628
- **pnpm filtered install** — `pnpm install --filter <pkg>...` from the
  workspace root installs only the filtered packages and their workspace
  dependencies; pnpm documents that filtering still requires the workspace
  lockfile and runs from the root.
  https://pnpm.io/filtering — the smoke script (Track 4) is the executable
  verification that this actually skips `callback-box`'s heavy deps
  (notably `better-sqlite3`'s native build); if it doesn't, Track 4 falls
  back to documenting root install with `--ignore-scripts` or a committed
  single-file build. Treat as unverified until the smoke script passes.
- **QR-code pairing for CLI tools** — no additional search performed beyond
  the mobile precedent already in-repo; the uploader runs on the same
  machine as the browser, so QR adds nothing over copy-paste (see NOT in
  scope).

## Tracks / scope

Ordered by implementation dependency. Track 4 is independent of 2-3 but
lands last so the UI instructions it feeds are final.

### Track 1 — Pair-redeem exchange (server)

- **What:** `src/core/scan/pairing.ts` (ticket mint + redeem, mirroring
  `core/mobile/pairing.ts`), a `scanTokens.createPairingTicket` owner-only
  tRPC mutation, and `POST /<slug>/api/scan/pair` (raw route in the scan
  sibling scope) that redeems `{ pairingToken, name }` →
  `{ boxSlug, name, token }` by calling `createScanToken`.
- **Why:** today the plaintext scan token itself must be copied out of a
  tRPC response and hand-placed in a file. The pairing shape moves the
  long-lived secret out of human hands entirely — only a 10-minute
  single-use code travels through the clipboard (principle #6: defense
  where the exposure is).
- **Direction / shape:**
  - Ticket: `createScanPairingTicket(boxRoot, { ttlMs? })` →
    `{ token, expiresAt }`; in-memory pending map, hash-keyed, single-use,
    `DEFAULT_TTL = 10 min` — same constants discipline as
    `pairing.ts:6-8`.
  - Redeem body (zod): `{ pairingToken: string.min(1), name: string
    .regex(SCAN_TOKEN_NAME_PATTERN) }`. The uploader defaults `name` to a
    sanitized hostname; `DuplicateScanTokenNameError` maps to `409` with
    the name in the message so the CLI can retry with a suffix.
  - All other failures: `401 { error: "Pairing code is invalid or
    expired." }` — one generic message, like `routes/pairing.ts:29-31`.
  - Hub + box-scope allowances: `isScanPairUrl` (exact path, POST only)
    added beside the existing scan-route allowance in `hub-server.ts` and
    the scan sibling scope in `server-box-scope.ts`; the route shares
    `consumeScanRateLimit`.
  - Wire contract: new section in `docs/scan-upload-contract.md`; both
    sides carry `// WIRE CONTRACT (scan-upload)` comments per the existing
    convention (`scan-uploader/README.md:40-41`).
- **First chunk:** `core/scan/pairing.ts` + its doctest
  (`test/core/scan-pairing.doctest.md`: mint/redeem happy path, expiry,
  reuse, wrong-box, duplicate-name propagation).

### Track 2 — Uploader `pair` subcommand (client)

- **What:** `node dist/scan-uploader.mjs pair <server-url-with-box> --code
  <pairing-code> [--folder <path>] [--disposition keep|archive|trash]
  [--name <token-name>] [--config <path>]`.
- **Why:** the CLI writing its own config is what makes the settings page's
  one-line command sufficient — no JSON hand-editing (the first job story).
- **Direction:**
  - Redeems the code at `POST <server>/api/scan/pair`.
  - Writes the token to `~/.scan-tokens/<box>.token` (0600, directory
    created) and appends/updates the target in the config file (default
    `./scan-uploader.json`, created if absent) using the existing strict
    config shapes. An existing target for the same box+folder is updated in
    place; a conflicting one (same box, different folder) is appended with
    both left visible.
  - Missing `--folder`: the target is written with a `"folder": "FILL-ME-IN"`
    placeholder ONLY if interactive prompt is declined — default behavior is
    an interactive prompt (stdin TTY) for folder + disposition. Non-TTY with
    missing flags fails closed with the exact flags to pass.
  - Verifies immediately: `POST /api/scan/check` with `[]` hashes using the
    new token; prints `paired: <name> -> <box> (server verified)` and the
    ScanSnap profile checklist (from README) as next steps.
  - Duplicate-name `409`: retries once with `-2` suffix, then errors.
- **First chunk:** the pair flow against `test/fake-scan-server.ts`
  extended with the pair endpoint (`test/pair.doctest.md`: happy path,
  expired code, duplicate name retry, non-TTY fail-closed, config
  update-vs-append).

### Track 3 — Settings UI section

- **What:** `src/frontend/src/components/settings/ScanUploaderSection.tsx`,
  appended to `SettingsPage.tsx` after the companion section.
- **Why:** the third job story — visibility and revocation — plus the
  entry point that mints codes.
- **Direction:**
  - "Pair a scan uploader" button → `scanTokens.createPairingTicket`
    mutation → renders the full paste-ready command with the code and the
    box URL prefilled, expiry countdown, auto-clear at `expiresAt`
    (state-only secret, exactly `CompanionPairingSection.tsx:88-95`).
  - Above it, collapsed-by-default "first-time setup" block: the three-line
    install story from Track 4 (clone, filtered install, build), so the
    settings page is self-sufficient for a new machine.
  - Uploaders list via `scanTokens.list` (`name`, `createdAt`,
    `lastUsedAt`, revoked badge) with revoke buttons →
    `scanTokens.revoke`, invalidating the list — same shape as
    `DeviceRow`.
- **First chunk:** the section with list + revoke (procedures exist
  today); the pairing button lands with Track 1's tRPC mutation.

### Track 4 — Minimal install story

- **What:** document and verify: `git clone <repo>` →
  `pnpm install --filter scan-uploader...` (from root) → `pnpm --filter
  scan-uploader build` → `node scan-uploader/dist/scan-uploader.mjs pair …`.
  A `scan-uploader/smoke-install.sh` proves it from a clean clone (fresh
  temp dir, no reuse of the dev store); README gains a "Setup" section
  ordered install → pair → ScanSnap profile; `docs/plans/installation-story.md`
  gets a pointer sentence (it currently covers only full-box installs).
- **Why:** the uploader targets machines that will never run a box;
  today's README assumes a working monorepo dev environment
  (`scan-uploader/README.md:105-113`).
- **Direction:** no npm publish, no committed `dist/` (gitignored today,
  stays that way); the filtered install is the story. If the smoke script
  shows the filter still triggers heavy native builds, fall back per Prior
  art. Node version: reuse the root's pinned-Node enforcement from the
  installation-story plan rather than a second mechanism.
- **First chunk:** `smoke-install.sh` run green locally; README rewrite in
  the same commit.

## Subplans

None. The one candidate — making scan-uploader an npm-publishable package —
is explicitly out of scope (below), not deferred design.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Pairing code redeemed twice (replay) | planned (scan-pairing doctest) | single-use map deletion, mirrors `pairing.ts:118-119` | clear (401) |
| Code expires while user walks to terminal | planned (doctest) | TTL check at redeem; UI countdown + auto-clear | clear (401; UI shows expiry) |
| Redeem with valid code but name already taken | planned (both sides) | 409 with name; CLI auto-suffix once | clear |
| Hub forwards pair route to wrong surface / other scan-token paths | planned (hub gate doctest extension) | `isScanPairUrl` exact-match, POST-only, beside the existing two-route allowance | clear (401 at hub) |
| Brute-forcing pairing codes at the unauthenticated route | existing pattern | 32-byte token space + `consumeScanRateLimit` shared with PUT | clear (429) |
| Box process restarts between mint and redeem (in-memory map lost) | planned (doctest documents behavior) | code simply invalid; UI mints a fresh one | clear (401) — accepted, same as mobile |
| CLI writes token file but config write fails mid-pair | planned (pair doctest) | write token file last, after config write succeeds; on any failure print both paths + state | clear |
| Token file created world-readable | planned (pair doctest asserts mode) | explicit 0600 + parent dir create | clear |
| `pair` run twice for the same box | planned (doctest) | update-in-place semantics; second token minted server-side — CLI prints reminder to revoke the old name | clear |
| Filtered install silently pulls heavy native deps | smoke script | fall-back documented (Prior art) | clear (script fails loud) |

**Critical gap:** none identified. The in-memory pending map's restart loss
is accepted and documented, matching the mobile precedent.

## Agent-flow / user-flow edge cases

This surface is boxholder-facing infrastructure; the agent-flow list adapts:

- **Wrong URL pasted (another box's slug)** — ADDRESSED: the pairing map is
  per-`boxRoot` (mirrors `pairing.ts:114` boxRoot check); redeem against
  the wrong box 401s.
- **Stale ref / revoked token still in config** — ADDRESSED: uploader runs
  get 401; the run prints the target name and exits non-zero
  (`scan-uploader/README.md:83-87` behavior extends to auth failures).
  Re-pair overwrites.
- **Two pairings racing (two machines, one code)** — ADDRESSED: single-use;
  the loser 401s and mints a new code.
- **Hand-edit drift in scan-uploader.json** — ADDRESSED: existing strict
  config validation fails closed naming the field (`config.ts` precedent,
  README:72-74); `pair` refuses to modify a config it cannot parse rather
  than clobbering it.
- **Fabricated free-form value** — token `name` is the only free text;
  pattern-constrained (`SCAN_TOKEN_NAME_PATTERN`) and defaulted to
  hostname; it travels into provenance as `scan-upload/<name>`
  (`tokens.ts:25-30`), so the CLI prints the chosen name at pair time.
- **Validation error UX** — ADDRESSED: redeem failures are one generic
  401 message by design (no oracle); all CLI-side failures name the flag
  or file to fix.
- **Partial migration / transition state** — N/A: purely additive; the
  manual mint-via-tRPC path keeps working (the UI list shows tokens from
  either path).

## NOT in scope

- **npm-publishing scan-uploader** — the installation-story plan already
  deferred npm publish for the whole repo; the filtered-install story is
  sufficient for the current audience (the boxholder's own machines).
- **QR code for the uploader** — the browser and the terminal are on the
  same machine; copy-paste beats camera round-trip. Revisit only if a
  headless scanning appliance appears.
- **Windows support for `pair`'s file placement / `trash` disposition** —
  uploader already documents `trash` as macOS-only (README:69-70); pair
  inherits the same posture.
- **Automatic token rotation / expiry for scan tokens** — long-lived
  revocable tokens match the mobile-device precedent; rotation is a
  box-wide credential-policy question, not an uploader one.
- **Uploader auto-update** — out of scope; re-run the three install lines.
- **A generic "pairing framework" unifying mobile + scan pairing** — two
  parallel small modules are deliberate (structural credential separation,
  `tokens.ts:1-17`); unify only if a third pairing surface appears.

## Open design questions

- Should the UI command embed the code in a URL
  (`… pair "https://…/estate#<code>"`) instead of a `--code` flag? Lean:
  flag — explicit, greppable in shell history is acceptable because the
  code is dead within 10 minutes and single-use.
- Should `pair` optionally install a launchd/cron sweep entry? Lean: no —
  print the crontab line as a suggestion; writing user crontabs is beyond
  right-sized (#6).

## Knowledge audits

Skip, with rationale: this plan adds no agent-facing vocabulary — no tags,
card shapes, or conventions an in-box agent must recall. The wire contract
is machine-facing (covered by doctests + the contract doc's paired
comments); the UI is human-facing. If a box agent ever needs to explain
scanner setup to the boxholder, the settings page itself is the durable
reference (doc-altitude preference: obscure operational features get
reference docs, not prompt surface).

## Implementation order

1. **Chunk 1 (Track 1):** `core/scan/pairing.ts` + doctest.
2. **Chunk 2 (Track 1):** redeem route + hub/box-scope allowances +
   `createPairingTicket` tRPC + contract-doc section; hub-gate doctest
   extension.
3. **Chunk 3 (Track 2):** CLI `pair` + fake-server pair endpoint +
   `test/pair.doctest.md`.
4. **Chunk 4 (Track 3):** `ScanUploaderSection.tsx` (list/revoke + pairing
   button + embedded install text).
5. **Chunk 5 (Track 4):** `smoke-install.sh` + README Setup rewrite +
   installation-story pointer.

Chunks 1→2→3 are strictly ordered; 4 needs 2; 5 needs 3 (its README text
documents `pair`).

## Rollout shape

- **Test posture:** each chunk's doctest named above is its done-when;
  failure-modes rows map to doctest examples. Full `pnpm typecheck` /
  `lint` / `test` per commit. The smoke script is run (not just written)
  before the plan completes — per the run-what-you-author rule.
- **Knowledge audits:** none (rationale above).
- **Migration:** none — additive. Existing hand-minted tokens and configs
  keep working unchanged.
- The plan ships as one unit on a worktree branch; merge to main is the
  boxholder's call.
