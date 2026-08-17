---
title: "Secret custody: a hub-owned store with grants, access logging, and no agent disclosure"
status: draft
workstream: secret-custody
issues:
  - ../../../issues/features/2026-08-17-secret-custody-broker.md
  - ../../../issues/decisions/2026-03-15-per-box-secret-management.md
  - ../../../issues/bugs/2026-08-07-connector-secret-file-modes.md
  - ../../../issues/features/2026-07-19-write-only-secret-capture-in-chat.md
---

# Secret custody

This plan moves connector secrets out of every box's content tree into one
machine-level store owned by the server processes, with per-box grants, an
access log, and a `cb secrets` lifecycle (set, grant, revoke, rotate). It is a
design proposal for discussion — nothing here is built, and the threat-model
section needs the boxholder's sign-off before implementation starts.

The one-sentence thesis: **the codebase already uses secrets only in server
processes, so the missing piece is not a new disclosure protocol — it is
getting the secrets out of the places agents can trivially reach (the box
content tree and the agent's inherited env), plus grants, audit, and rotation
on the one copy that remains.**

## Threat model (previously unwritten — decide this first)

Three candidate adversaries, from the umbrella issue:

1. **A leaked repo or backup.** Largely handled: `*.secret.json` is gitignored
   (`docs/box-layout.md:160`). Residual exposure is backups of the box
   directory and of `/home/callback/.env`.
2. **Another user on the machine.** Minor on a single-operator server; file
   modes are the whole answer
   ([connector-secret-file-modes](../../../issues/bugs/2026-08-07-connector-secret-file-modes.md)).
3. **A compromised or prompt-injected box agent.** The recommended primary
   driver. The agent runs with `permissionMode: "bypassPermissions"`
   (`src/core/agent/run.ts:73`) as the same OS user as the hub, with `cwd`
   set to the box root (`src/core/agent/run.ts:71`) — the directory that
   contains `config/connectors/*.secret.json`.

**Recommendation: design for (3) as the driver, take (1) and incidental
leakage as secondary, and explicitly decline (root/hub compromise).** A
same-user agent that can execute arbitrary code can eventually obtain anything
the box can *use*; no store changes that. What custody buys against (3) is:

- **Removal of the trivial paths** — a secret is no longer a file in the
  agent's own working tree, nor a variable in its inherited environment.
  Reaching one becomes a deliberate out-of-tree act, which the containment
  control plane
  ([agent-containment-allowed-directories](../../../issues/features/2026-07-20-agent-containment-allowed-directories.md))
  can express as a deny rule using existing Claude Code config.
- **Blast-radius bounding** — a box only ever had grants to the secrets it
  needs, so one compromised box does not expose every box's credentials.
- **Attribution and rotation** — one copy per secret, an access log naming
  which box used what when, and rotation that touches one file.

What it does **not** buy, stated plainly so the design never implies
otherwise: prevention. The prior art is unanimous on this (Docker sandbox
credential injection, the `nono` credential-injection proxy, ssh-agent's own
docs): custody yields non-exfiltration-by-default, attribution, revocation,
and rate-limiting — a compromised agent that finds a path to the store, or
that misuses a granted operation, is detected-or-bounded, not stopped. The
hard wall is OS-user separation or containers, which is out of scope here
(see NOT in scope).

## Vault or broker? Both questions dissolve against this codebase

The umbrella issue frames a fork: a **vault** (hands out secrets, logs it) vs
a **broker** (performs the operation, never discloses). The codebase mapping
shows the fork mostly does not apply here, because of who asks:

- Every secret-using call site already runs in a **server process**, not in
  the agent: Mistral transcription (`src/core/transcription/voxtral.ts:53`,
  `src/webapp/routes/chat-audio-routes.ts:159`), Deepgram
  (`src/core/transcription/deepgram.ts:115`), Telegram webhook + sync
  (`src/webapp/routes/telegram.ts`, `src/connectors/telegram.ts`), Google
  connectors (`src/connectors/google-auth.ts:65-111`). No agent-invoked code
  path reads a connector secret today.
- Agents already have a no-disclosure channel for operations: the loopback
  API with `CB_AGENT_TOKEN` (`src/core/script-env.ts:141-145`) — an agent
  that needs a transcription asks its own box's HTTP API; the server process
  resolves the key.

So the design is: **a vault whose intended clients are server processes,
with no agent-facing disclosure interface.** The store's disclosure interface
is an in-process resolver call made by connector code on behalf of a box,
not an endpoint agents are given. This gets most of the broker's agent-facing
property at near-zero call-site churn, because the call sites are already on
the right side of the line.

**Stated precisely, because the claim is easy to overread:** "no interface"
is not "no access." The resolver is ordinary project code and the store is a
same-user 0600 file; an agent that executes arbitrary code can import the
resolver with a forged `boxRoot`, run `node -e 'fs.readFileSync(...)'` on
the store, or read `/proc/<pid>/environ` of same-user server processes. The
`--agent-confirmed` gate is explicitly a speed bump against accidental agent
mistakes, not an authorization boundary (`src/lib/agent-context.ts:5-17`).
What this design removes is the *trivial and incidental* paths (a file in
the agent's own cwd; inherited env); what makes out-of-tree access *denied*
rather than merely deliberate is the containment interlock (Track 4); and
what would make it *impossible* is OS-user separation, which is out of
scope. The plan claims hygiene, blast-radius bounding, attribution, and
rotation — not a wall.

**The operation surface is part of the custody question.** Agents (and the
frontend) already reach secret-*spending* operations through box-auth'd
endpoints, and two of them hand back derived credentials today:
`deepgramTempKey` (`src/webapp/trpc/routers/transcription.ts:38`) mints a
TTL'd usage-scoped Deepgram key — the derived-credential pattern, already
live — and the OpenAI realtime path mints client secrets; both are
`publicProcedure` behind box auth, with no rate limit and no audit, and
`setService`/`setHqService` mutations let any box-auth'd caller repoint
which backend future flows spend. A custody design that logs value
*resolution* but not these operation/minting endpoints audits the door and
ignores the window: Track 3 brings them under the same access-log `purpose`
posture (log each mint/spend with box + purpose), and their rate posture is
an open question (7) rather than silently unbounded.

The *full* broker shape — per-provider derived credentials, an egress proxy
that injects keys — remains the escalation path where it pays (see "Broker
escalations" below), and the
[google-auth-policy-proxy](../../../issues/features/2026-07-28-google-auth-policy-proxy.md)
issue is the maximal version of it for Google specifically. This plan is the
umbrella; that issue stays open as its own build.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` — validate-at-boundaries (grant checks at
  the resolver boundary), resilient-not-silent (missing secret degrades to
  the existing "not configured" path, loudly), types-are-structure (a named
  secret registry, not stringly-typed paths).
- `callback-box/CLAUDE.md`: "Never change credentials to unblock yourself"
  (the `--agent-confirmed` gate pattern in `src/lib/agent-context.ts` extends
  to the new CLI); "Read before writing"; reuse of `src/lib/` primitives
  (`writeFileAtomic`, `file-lock.ts`).
- Boxholder-recorded constraints: **no interactive permission dialogs** and
  **nothing that can't be expressed with existing config** (containment
  issue, 2026-07-20); **operational simplicity beats per-call cost** (memory:
  zero-extra-setup weighs heavily); **bias toward strict** (fail-closed
  grants); **stop over-engineering rare failures** (no gold-plating against
  root compromise).
- `code-style.md` — custom error classes, no default parameters, explicit
  return types.

## What already exists

Reused:

- **`writeFileAtomic` with `mode: 0o600`** (`src/lib/atomic-write.ts`) — the
  store's write primitive; already the pattern in
  `src/connectors/google-token-store.ts:203-206`.
- **`src/lib/file-lock.ts`** — cross-process lock for store mutations
  (hub, scheduler, and CLI can all touch it).
- **`TokenStore`** (`src/core/token-store.ts`) — the 0600 + atomic-replace +
  hashed-values pattern; the access-token side of this plan follows it. The
  secret store itself cannot hash (it must return plaintext to connectors),
  but the file discipline transfers.
- **The env allowlist pattern** (`src/hub/child-env.ts:42-93`,
  `CHILD_ENV_ALLOWLIST`) — the hub already refuses to spread its env into box
  children; this plan extends the same posture to `buildScriptEnv`.
- **The `--agent-confirmed` gate** (`src/lib/agent-context.ts`) — mutating
  `cb secrets` subcommands adopt it wholesale.
- **`GoogleAuthService`** (`src/services/google-auth.ts`) — the
  one-interface-many-impls seam that makes Google already the best-behaved
  secret consumer; the model for how connectors consume the resolver.
- **Machine-level precedent** — `~/.cb-auth.json` and `~/.cb-session-secret`
  already live outside every box tree; the store joins them rather than
  inventing a new location class.

Rebuilt/replaced:

- **Per-connector secret-file readers** (`src/core/mistral-key.ts:14-28`,
  `src/core/deepgram-key.ts`, the legacy branch of
  `src/connectors/google-token-store.ts:86-142`, telegram's loader): each
  currently opens `config/connectors/<name>.secret.json` under the box root
  itself. These become calls into one resolver, keeping their per-box file
  read only as a deprecated fallback during transition. Justification for
  rebuilding: six ad-hoc readers with three different fallback orders is the
  drift this plan exists to end (consolidate-over-blast-radius-fear).
- **`deploy/add-box.sh --secrets-from`** (file copy between boxes) — replaced
  by grants; the copy is the rotation hazard the umbrella issue names.

## Prior art (external) — research digest, 2026-08-17

Four research passes (broker family, OS stores, vault family,
encryption-at-rest + derived tokens), all against current documentation.
Full trails in the agent transcripts; the load-bearing findings:

- **The agent-sandbox credential-injection proxy is shipped prior art, not
  invention.** [Docker Sandboxes credentials](https://docs.docker.com/ai/sandboxes/security/credentials/)
  gives the sandboxed agent a sentinel value and injects the real key
  host-side; [nono](https://nono.sh/credential-injection) is the same shape
  standalone; [Envoy Gateway "Credential Injection"](https://gateway.envoyproxy.io/docs/tasks/security/credential-injection/)
  is the vendor-neutral name. All state the same limit: stops exfiltration,
  not misuse-through-the-proxy.
- **ssh-agent** ([smallstep explainer](https://smallstep.com/blog/ssh-agent-explained/))
  under local compromise is a signing oracle, not a wall — what survives is
  no-persistent-exfiltration, forced synchronicity, and a revocation choke
  point. Same honest framing applies here.
- **Vault/OpenBao is disqualified operationally, its vocabulary is not.**
  Seal-on-reboot vs unattended restart, plus a 3–4-month upgrade cadence,
  fails the single-operator constraint
  ([auto-unseal](https://developer.hashicorp.com/vault/tutorials/auto-unseal)
  just relocates secret-zero). Transferable ideas: audit devices that log
  **HMAC'd values, never plaintext**
  ([Vault audit](https://developer.hashicorp.com/vault/docs/audit)); narrow
  per-consumer policies; TTL'd grants; single-use tamper-evident handoffs
  (response wrapping).
- **systemd `LoadCredentialEncrypted=`**
  ([systemd credentials](https://systemd.io/CREDENTIALS/)) is cheap hygiene
  against incidental leakage (env dumps, `/proc/<pid>/environ`, backup
  sweeps of `.env`) and nothing more on a TPM-less VPS: with `--with-key=host`
  the key and ciphertext share a disk, and a same-user process reads the
  decrypted credential exactly as it reads `.env`. Verify TPM presence with
  `systemd-creds has-tpm2` before assuming better. Worth doing; not a
  boundary.
- **sops/age protects backups and repo leaks, not this threat.** Same-user
  key + ciphertext means encryption-at-rest is not a boundary against the
  agent ([age](https://github.com/FiloSottile/age)). Declined as a mechanism
  here; the store stays plaintext-0600 and says so.
- **Per-provider derived credentials are mostly available.** Cloudflare
  (scoped + TTL'd tokens), Mistral (scoped + expiring keys), Deepgram
  (`time_to_live_in_seconds`), Google (refresh→1h access tokens — already
  the ideal shape), Anthropic (workspace scoping; OIDC federation) all
  support hub-minted narrow credentials natively. OpenAI: scoping yes,
  native TTL no. **Telegram: nothing** — one bot token, all-powerful,
  revoke-only via BotFather; blast-radius reduction for Telegram requires
  the hub to proxy calls, full stop.
- **macOS Keychain** is prompt-bound and a dead end for headless agent use;
  fine to leave dev on the same file store.

## Tracks / scope

### Track 1 — stop the env spread (smallest, do first)

**What.** `buildScriptEnv` (`src/core/script-env.ts:92-158`) starts from a
full `{ ...process.env }` spread and strips four names. Convert it to an
allowlist in the `CHILD_ENV_ALLOWLIST` style — and the allowlist for *agent*
subprocesses excludes every connector credential
(`CALLBACK_MISTRAL_API_KEY`, `CALLBACK_DEEPGRAM_*`, `GEMINI_KEY`,
`SKE_GEMINI_API_KEY`, `THINKING_OPENAI_API_KEY`,
`GOOGLE_OAUTH_CLIENT_SECRET`).

**Why.** Today, a server configured with env-var credentials hands every one
of them to every agent subprocess as inherited environment — strictly worse
than the secret files, because the agent does not even need to read a file.
The strip-four-names comment block (`script-env.ts:106-127`) shows the
posture is already deny-by-name for hub secrets; connector keys were simply
never added.

**Scope of the claim:** this closes *inheritance into the agent's own env*,
nothing more. Hub-spawned `cb serve` children still legitimately carry
connector keys in their env (`child-env.ts:57-93` allowlists them), and a
same-user agent can read `/proc/<pid>/environ` on Linux. The endgame is that
Track 3 retires the env-var credential path entirely (readers resolve from
the store), at which point the connector entries come *out of the child-env
allowlist too* and no long-running process carries connector keys in env.
That removal is a named Track 3 chunk, not a side effect.

**Direction.** One allowlist constant, shared derivation with
`child-env.ts` where the entries overlap, plus a doctest asserting a
poisoned `process.env` does not reach the agent env.

**First implementation chunk.** The allowlist conversion + doctest. No open
questions inside it.

### Track 2 — the store: custody, grants, audit, lifecycle

**What.** A machine-level secret store owned by the server processes, outside
every box tree. Proposed location: `~/.config/cb/secrets.json` (or
`$CB_SECRETS_FILE`), 0600, `writeFileAtomic` + `file-lock.ts`. Shape (to be
settled in review):

```jsonc
{
  "secrets": {
    "mistral": { "value": "…", "updated": "2026-08-17T…", "note": "transcription" },
    "telegram-bot/<box>": { "value": "…", "updated": "…" }
  },
  "grants": {
    "<box-slug>": ["mistral", "deepgram", "telegram-bot/<box>"]
  }
}
```

- **Named secrets, one copy.** Sharing between boxes is a grant, not a file
  copy. Rotation updates one entry.
- **Grants are fail-closed.** A resolver call for an ungranted secret returns
  the same "not configured" answer the current missing-file path produces
  (`requirements.ts:46-56` shape) — the *per-secret* degradation matches
  today. Two honest differences from today: (a) current readers disagree
  about fallback order and strictness (mistral swallows a corrupt file and
  falls to env, `mistral-key.ts:22-26`; newer readers throw) — the resolver
  unifies this, which is a behavior change for the strict ones; (b) a
  corrupt *store file* is a machine-wide event — every grant on the machine
  reads as absent at once, a blast radius no per-box file has. Mitigation:
  `writeFileAtomic` + schema validation on every write makes on-disk
  corruption reachable only by hand-edit; on parse failure the resolver
  fails closed and `cb health` flags "secret store unreadable" on every box.
  Accepted as a documented trade, not gold-plated further
  (stop-over-engineering).
- **Access log.** Append-only JSONL beside the store: `{ts, box, secret,
  purpose}` where `purpose` is a short caller-supplied string
  ("transcription", "telegram-sync"). Values never logged; if a value must
  ever appear in diagnostics, HMAC it (Vault's audit-device rule). Surfaced
  in `cb health` / the admin page as "last used per secret per box" —
  pairing the log with a reader, so it is not theatre.
- **Lifecycle CLI.** `cb secrets set <name>` (value via stdin or prompt,
  never argv), `rm`, `list` (names + metadata only), `grant <box> <name>`,
  `revoke <box> <name>`, `status <box>` (what's granted vs what the box's
  schedules require — the `cb secrets` listing the 2026-03-15 issue asked
  for). Mutating subcommands require `--agent-confirmed` in agent sessions.
- **Resolver.** `resolveSecret(boxRoot, name, purpose)` in one module:
  grant-check → log → return value. Per-connector readers call it; the
  legacy per-box file remains a fallback (with a deprecation warning) for
  one transition window, then the fallback is removed and `cb health` flags
  stray `*.secret.json` files.

**Why.** This is the umbrella issue's four asks — holds, requires asking,
logs access, shares in limited ways — implemented with the smallest new
machinery: one file, one resolver, one CLI. "Requires asking" is satisfied at
the *box* granularity (grant-checked resolution by server code on behalf of a
box); agents cannot ask at all (see the vault-or-broker section).

**Vocabulary lock-ins.** Secret *names* are flat identifiers, per-box
instances use `name/<box>`; `grants` maps box slug → names. The `purpose`
string vocabulary stays freeform but short.

**First implementation chunk.** The store module (read/write/lock/schema) +
`cb secrets set/list/grant` + doctests, with no connector wired yet. No open
questions inside it.

### Track 3 — move the six locations onto the store

**What.** Rewire every secret consumer onto the resolver. "Six locations"
was the umbrella issue's storage inventory; the *reader* inventory is
larger and must be enumerated as Track 3's first act, not discovered
mid-migration. Known today: mistral (`src/core/mistral-key.ts`), deepgram
(`src/core/deepgram-key.ts` + the temp-key minting in
`trpc/routers/transcription.ts`), openai/thinking + realtime
(`routes/chat-audio-routes.ts`, `routes/api-adapters.ts`), embeddings
(`src/core/search/embeddings-key.ts`), telegram
(`connectors/telegram-helpers.ts`, `trpc/routers/admin.ts`), google legacy
branch (`CB_GOOGLE_TOKENS_FILE` stays; env client creds in
`connectors/google-auth.ts` move), publish
(`src/publish/connector-secret.ts` — which also *writes* a minted
Cloudflare token). Order: mistral first as template, then by surface size.
Update `deploy/add-box.sh`: `--secrets-from` becomes
"copy the grant list", not the files. Update `docs/adding-a-box.md`. New-box
provisioning becomes: `cb secrets status <box>` names what's missing;
granting is one command — resolving the 2026-03-15 decision issue.

**Why.** Six storage answers is the inventory problem; the store is only
real once the readers use it.

**First implementation chunk.** Mistral end-to-end (resolver + fallback +
doctest + `cb health` awareness), as the template for the rest.

### Track 4 — containment interlock (config only, no new engine)

**What.** With secrets out of the box tree, the containment control plane's
generated deny rules (per the containment issue: Claude Code `permissions`
config, no custom enforcement) can deny agent file-tool access outside the
box directory — which now *covers the store* without naming it. Document in
the security report: the Bash-indirection and symlink bypasses remain, as
accepted-and-documented expectations, per the boxholder's recorded scope
constraint.

**Why.** Custody and containment are two halves of one boundary: custody
moves every secret to one place outside the tree; containment makes
reaching outside the tree a denied act. Neither alone claims to be a wall;
together they are a legible, existing-config boundary — which is exactly
what the status quo lacks.

**First implementation chunk.** None here — this lands inside the
containment issue's own build; this plan only commits the placement that
makes it effective.

### Broker escalations (named, deliberately deferred)

Where the full never-discloses broker pays, per provider:

- **Telegram** — no scoping primitive exists, so the server must keep
  terminating the webhook and sync paths, and the token must never leave the
  store. That is *not* the current state: `telegramStatus` returns the raw
  `botToken` to the admin frontend (`src/webapp/trpc/routers/admin.ts:65,71`),
  and `telegramSetup` writes the secret file with no `mode: 0o600`
  (`admin.ts:92-98`). Track 3's telegram chunk redacts the status response
  (a deliberate admin-UI behavior change — show configured/username only),
  moves the write into the store, and makes disconnect revoke the grant.
- **Google** — already refresh→short-lived-access shaped; the
  [google-auth-policy-proxy](../../../issues/features/2026-07-28-google-auth-policy-proxy.md)
  issue (Nango Tier 1 + policy Tier 2) is the full build and stays open,
  subsumed under this umbrella as the Google-specific escalation.
- **Cloudflare / Mistral / Deepgram / Anthropic** — native scoped/TTL'd key
  minting exists if a box-held credential is ever genuinely needed; today
  none is, so minting machinery is not built.

## Could this be simpler?

Simplest plausible version: **fix the two file-mode bugs, chmod everything
0600, and stop.** That resolves the file-modes issue and nothing else: six
storage locations remain, sharing stays a file copy with no rotation story,
the agent's cwd still contains every secret, and the agent env still inherits
connector keys — 0600 is meaningless between same-user processes. Fails on
"a prompt-injected agent reads `config/connectors/*.secret.json` from its own
working directory," which is the recommended threat driver.

Next-simplest: **Track 1 + move files out of the tree, no store** (a
per-box secrets directory under `~/.config/cb/`). This gets the placement win
but keeps N copies of shared keys — rotation and sharing stay unsolved, which
are two of the four asks in the umbrella issue. The store's extra machinery
(one file, grants, log, CLI) is what those asks cost; each maps to a named
ask, none is speculative. Declined extras that would *not* pay: encryption at
rest (not a boundary here — research digest), a daemon or socket protocol
(the resolver is in-process; hub and CLI already share the file + lock
pattern), per-secret TTLs (no consumer needs them yet;
stop-over-engineering).

## Failure modes

> **Critical gap (status quo, closed by Track 1):** env-var-configured
> credentials silently enter every agent subprocess env via the
> `{ ...process.env }` spread. No test, no handling, silent. Track 1 is the
> fix; its doctest is the regression anchor.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Resolver asked for an ungranted secret | planned (doctest) | returns not-configured; connector degrades as today | clear — `cb health` names the missing grant |
| Store file missing/corrupt at read | planned | fail-closed: treat as no grants; warn once per process | clear (console.warn) |
| Concurrent store writes (CLI + admin route) | planned | `file-lock.ts` + atomic replace | clear |
| Access log unwritable (disk full) | planned | resolution proceeds; warn + `cb health` flags "audit currently broken" — the log is best-effort by declaration, availability wins; the claim in this plan is attribution, not tamper-proof audit | clear (warn + health) |
| Legacy per-box file and store disagree during transition | planned | store wins; fallback only when store has no entry; deprecation warning names the stray file | clear |
| Agent invokes `cb secrets set/grant` | exists-pattern (`agent-context.ts`) | refused without `--agent-confirmed` | clear |
| Box renamed/recloned (worktree clones) → grant key mismatch | no | **open question 2** | currently unhandled |
| Secret value passed via argv (leaks to `ps`) | planned | `set` reads stdin/prompt only; argv form rejected | clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — N/A at this stage; the chat capture widget
  (write-only-secret-capture) defines the target grammar when built; its
  allowlist is the store's name registry. DEFERRED to that issue, which this
  store unblocks.
- **Stale ref** — grants name secrets that may have been `rm`'d: resolver
  treats as ungranted (fail-closed); `cb secrets status` shows dangling
  grants. ADDRESSED (Track 2).
- **Two agents touching the same card** — store is not card data; concurrent
  mutation is the file-lock row above. ADDRESSED.
- **Hand-edit drift** — operator hand-edits `secrets.json`: schema-validated
  on load (`safeParse` at the boundary), fail-closed with a named error on
  invalid shape. ADDRESSED (Track 2).
- **Fabricated free-form value** — the `purpose` string is caller code, not
  LLM output; honest by construction. ADDRESSED.
- **Validation error UX** — an agent whose transcription fails sees the same
  "API key not configured" surface as today plus the grant name to relay to
  the boxholder. ADDRESSED (Track 3).
- **Partial migration / transition state** — store-wins-with-fallback,
  warning on fallback use, `cb health` flags stray files; removal of the
  fallback is a named later chunk. ADDRESSED (Track 3).

## NOT in scope

- **OS-user separation / containers per box** — the real wall; the
  box-user spec is `status: superseded`
  (`docs/unimplemented-plans/box-user-account-spec.md`) and reviving it is a
  separate decision. This plan is designed to compose with it, not replace it.
- **Encryption at rest for the store** — not a boundary against the driving
  threat (research digest); reconsider only as backup hygiene, where
  `LoadCredentialEncrypted=` for the store path is the cheap form.
- **Running Vault/OpenBao/Infisical/Nango for general secrets** — fails the
  unattended-restart and single-operator constraints; Nango remains scoped
  to the Google proxy issue only.
- **Per-provider derived-credential minting** — no current consumer;
  build when a box-held credential is genuinely needed.
- **An agent-facing "request a secret value" endpoint** — deliberately never;
  it is the property the design exists to remove.
- **The chat capture widget** — its own issue; this store is its
  prerequisite ("target" registry), not its implementation.
- **Egress-proxy credential injection for arbitrary agent HTTP** — the
  Docker/nono shape; revisit only if agent-side code ever legitimately needs
  to call a credentialed API directly.

## Open design questions

1. **Store granularity: one machine file vs per-box files under one
   directory.** Lean: one file + grants table (sharing and rotation are the
   point; per-box files re-create the copy problem for shared keys).
2. **Grant keying for clones and worktrees.** Worktree test boxes are clones
   of `test1`; should a clone inherit `test1`'s grants (lean: yes, keyed by
   box slug not path — this also fixes the "worktrees need secrets copied
   in" recurring annoyance), and does prod need path-keying to distinguish
   same-slug boxes? Needs the boxholder's read on how slugs collide in
   practice.
3. **Does the admin tRPC write path (telegram setup) write to the store or
   keep per-box placement for per-box secrets?** Lean: store, under
   `telegram-bot/<box>` naming — per-box *instance*, machine-level custody.
4. **`/home/callback/.env` endgame.** After Track 3, which env entries remain
   (VAPID? OAuth client id?) and does the remainder move to systemd
   credentials as hygiene? Lean: yes, as a final chore, honestly labeled.
5. **Threat-model sign-off** — the recommendation above is the planner's;
   the boxholder decides (`needs: [decision]` energy on the umbrella issue).
6. **Auth tier for backend-repointing mutations.** `setService`/`setHqService`
   are `publicProcedure` behind box auth
   (`trpc/routers/transcription.ts:23-34`); should repointing which backend
   spends credentials require owner auth instead? Lean: yes, cheap and
   strict.
7. **Rate posture for minting/spending endpoints.** `deepgramTempKey` and
   the realtime client-secret mints are unlimited today. Lean: a simple
   per-box per-hour cap surfaced in the access log — bounded misuse is the
   one thing a broker can actually promise; but the cap number is the
   boxholder's call.

## Knowledge audits

Agent-facing surface is deliberately small: agents interact with secrets only
by *absence* (a "not configured" message naming a grant). One audit is
warranted when Track 3 lands: a box agent asked "how do you get a Mistral key
configured for this box?" should answer "ask the boxholder to run `cb secrets
grant`" (or point at the admin surface), not "write
`config/connectors/mistral.secret.json`" — the old answer becomes actively
wrong. Deferred until the guidance text exists; noted here so it is a
decision, not an oversight.

## Implementation order

1. Track 1 (env allowlist) — independent, closes the critical gap.
2. Thin slice through Tracks 2+3: the minimal store (read/write/lock,
   `set`/`grant`/`list`) **and mistral end-to-end in the same chunk** —
   resolver, fallback, health, doctests. No second secret system exists
   without a real consumer; the slice proves the migration shape before the
   store grows audit/status polish.
3. Reader inventory (Track 3's enumeration), then the remaining consumers
   by surface size; telegram chunk includes the status-redaction and
   store-write changes; google env client creds; publish's minted-token
   write path.
4. `add-box.sh`/docs; child-env allowlist drops connector entries; env
   fallback removal; stray-file flagging; then the access-log surfacing and
   `cb secrets status` polish.
5. Track 4 rides the containment issue's build.
6. File-modes bug: superseded for connector secrets by the migration (files
   retired); telegram's writer is fixed by moving into the store.

## Rollout shape

- **Tests first as design tool**: doctests named per chunk above — env
  allowlist (poisoned-env), store module (grant-check, corrupt-file,
  concurrent-write via lock), resolver fallback ordering, `cb secrets` CLI
  (agent-context refusal). Filesystem tier (`makeTmpBox()` + a temp
  `CB_SECRETS_FILE`).
- **Migration**: agent-scripted, per-machine — enumerate existing
  `*.secret.json` across boxes, dedupe identical values into named entries,
  write grants, leave originals in place during the fallback window, then a
  removal pass. Prod migration is operator-run over `deploy/prod-ssh` with
  the boxholder present; no unattended prod mutation.
- **Done-when**: the Track 3 reader inventory is enumerated in the plan and
  every entry is checked off; `grep`ing a box tree for `*.secret.json` finds
  nothing AND `grep -rn "secret.json" src/` finds no box-tree readers
  outside the resolver + deprecation flagger; `cb secrets status <box>`
  accounts for every connector requirement; the access log shows real
  entries (resolutions *and* temp-key mints) from a wakeup cycle.
