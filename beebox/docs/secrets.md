# Secrets: the machine-level store

Connector credentials live in ONE file per machine —
`~/.config/beebox/secrets.json` (override `$BBX_SECRETS_FILE`), mode 0600, outside
every box tree — with a per-box grant deciding who may resolve what. Design and
rationale: [`plans/secret-custody.md`](implemented-plans/secret-custody.md). This page is
the operational reference for what exists today.

Built so far: the store, the resolver, `bbx secrets`, **every connector reader**
migrated (see "Secret names" below), the loopback resolve endpoint that box code
uses for `agent`-access grants, the probe + format registries, and the **admin
page's Secrets section** (this box's grants plus a machine-wide view). The
legacy in-box file and env-var fallbacks have since been removed (every
connector credential now resolves from the store only); the chat capture
widget remains a later chunk. The one exception is `GOOGLE_OAUTH_CLIENT_ID` /
`GOOGLE_OAUTH_CLIENT_SECRET`, which stay live env configuration for the fleet
login surface — see "Google client credentials" below.

## The shape

```jsonc
{
  "secrets": {
    "mistral": {
      "value": "…",              // absent for a DECLARED slot awaiting a value
      "note": "transcription",
      "updated": "2026-08-17T…",
      "verified": { "status": "ok", "at": "…" },   // set by a later chunk's probe
      "formatHint": "openai",
      "uses": ["morning-brief forecasts"],         // declared reasons, additive
      "purposes": ["transcription"],               // purpose labels real resolves passed
      "lastUsed": { "<box-slug>": "…" },           // stamped hourly at most
      "declaredBy": "<box-slug>",                   // which box asked for the slot
      "owningBox": "…", "shareable": false          // structurally per-box secrets
    }
  },
  "grants": { "<box-slug>": { "mistral": "server" } }
}
```

Adding a secret and granting it are separate acts: adding makes a name
*grantable* machine-wide and available to no box; granting is the per-box opt-in.
Grants are keyed by **box slug**, so worktree clones sharing a slug inherit
them. Sharing between boxes is a grant, never a file copy — rotation touches one
entry.

## Access levels

On the **grant**, not the secret — the same secret can be server-only for one box
and agent-resolvable for another:

- `server` (default, and all built-in connectors need only this) — resolved
  inside server processes; no interface discloses it to agent-context code.
- `agent` (includes server access) — box-local, agent-authored code may resolve
  the value at call time, and every resolve is logged.

## Secret names

A name is a flat identifier; per-box instances use `name/<box-slug>`. The
mapping below was the migration's contract — the migration script deduped
existing `_config/connectors/*.secret.json` files into exactly these names, so
**the store name matches the legacy file's basename wherever a file existed**.
The "legacy file" and "env fallback" columns are historical: both fallback
paths have been removed from every reader below, so the store is now the only
source. Google's OAuth client credentials are the one row with a real,
non-legacy env path — but only for a different surface than the store-backed
one in this table; see "Google client credentials" below.

| Name | Consumers | Former legacy file | Former env fallback |
|---|---|---|---|
| `mistral` | `core/mistral-key.ts`, `/api/adapters/mistral` | `mistral.secret.json` | `BBX_MISTRAL_API_KEY` |
| `deepgram` | `core/deepgram-key.ts` | `deepgram.secret.json` | `BBX_DEEPGRAM_API_KEY` + `BBX_DEEPGRAM_PROJECT` |
| `openai` | `core/search/embeddings-key.ts`, `/api/adapters/openai` | `openai.secret.json` | `BBX_OPENAI_API_KEY` |
| `openai-thinking` | chat TTS, Whisper, the realtime mint | — | `THINKING_OPENAI_API_KEY` |
| `gemini` | `core/gemini-key.ts` (audio questions, scan-import vision) | — | `GEMINI_KEY`, then `SKE_GEMINI_API_KEY` |
| `google-oauth-client-id` / `google-oauth-client-secret` | `connectors/google-auth.ts` `getBoxGoogleClientCreds` | — | — |
| `anthropic`, `replicate` | `/api/adapters/<name>` | `<name>.secret.json` | — |
| `openrouter` | `core/openrouter.ts` (the fallback route for embeddings, audio questions, Whisper HQ transcription, and the opt-in Gemini scan backend; the *only* route for the `mai` HQ services and the `gemini` TTS backend), `/api/adapters/openrouter` | — | — (new since custody; store-only from the start) |
| `telegram-bot/<box>` | `connectors/telegram-helpers.ts`, admin setup | `telegram.secret.json` | — |

**One deliberate reuse outside this table.** The dev repo's document-comment
surface transcribes spoken comments with `BBX_OPENAI_API_KEY` — the
`openai` (embeddings) variable above — rather than minting a third name
(`workstreams-app/src/server/transcribe-openai.ts`). That is a **boxholder
decision, 2026-08-22**, on the grounds that a dev-surface key on the developer's
own machine did not earn its own name.

It does **not** relax the box-side rule. `openai` and `openai-thinking` stay
distinct for boxes, for the reason `core/openai-thinking-key.ts` records: *"a
transcription key is not consent to pay for embeddings, and boxes may hold
different keys for each."* Nothing in a box reads `BBX_OPENAI_API_KEY` for
transcription; only the dev tooling does.
| `publish/<box>` | `publish/connector-secret.ts` | `publish.secret.json` | — |

`openai` and `openai-thinking` are two names for two keys on purpose: a
transcription key is not consent to pay for embeddings, and the split predates
the store. Google's *tokens* are NOT here — `google-token-store.ts` /
`BBX_GOOGLE_TOKENS_FILE` is untouched; only the OAuth app's client credentials
moved.

### Google client credentials: store, plus one real env exception

`connectors/google-auth.ts` splits the OAuth app's client credentials into two
functions with two different sources, because they serve two different
surfaces:

- `getBoxGoogleClientCreds(boxRoot)` — a **box's** Drive/Calendar/Gmail
  connectors. Resolves `google-oauth-client-id` / `google-oauth-client-secret`
  from the store only, at `server` access, the same as every other connector
  credential.
- `getLoginGoogleClientCreds()` — the **fleet login surface**, which
  authenticates before any box exists and so has no box root to resolve a
  store grant against. This one reads `GOOGLE_OAUTH_CLIENT_ID` /
  `GOOGLE_OAUTH_CLIENT_SECRET` from the environment, and that is real
  configuration for that surface, not a legacy fallback.

The last two are **single-box** entries: they carry `owningBox` +
`shareable: false` and are granted automatically by the flow that creates them
(telegram setup, `bbx pub setup --mint-connector-token`). A grant to any other
box is refused with an explanation — a Telegram bot token routes to one webhook
URL and an R2 token is scoped to one bucket, so sharing would break routing
rather than merely be unwise.

## Why a secret exists

A grant is a standing decision, and the question that comes back months later is
*what breaks if I revoke this?* `note` never answered it — one line written once
while pasting a key. **Uses** do, and they are **additive**: one key usually
earns its grant several times over (an OpenAI key does speech, Whisper, and the
realtime mint), so every source is a LIST and a new reason is appended, never a
replacement. Separating keys *by* purpose — one key per use — is a different
idea and is deliberately not built.

Three sources, shown apart rather than merged, because they are different
claims:

| Source | Where | Who writes it |
|---|---|---|
| **built-in** | `src/core/secrets/uses.ts` | The server. One list per name (or `family/` prefix), each line derived from an actual `resolveSecret` call site in the engine. An agent cannot add one — the probe-registry rule. |
| **declared** | `entry.uses` | The boxholder (admin page) or an agent (`bbx secrets declare --use`, `bbx secrets describe --add-use`). This is the ad-hoc half: a trick, a script, a box-local integration the engine knows nothing about. |
| **observed** | `entry.purposes` | Nobody — it accumulates from real resolves: the distinct `purpose` labels that were actually passed. |

Observed purposes are recorded on the same best-effort path as `lastUsed`
(`stampSecretUse`), with a different throttle on purpose: the timestamp is
stamped at most hourly, while a purpose label is written the FIRST time it is
seen and costs nothing after that. A trick that runs once at 12:05 would
otherwise never appear. The list is capped (16 labels); the access log keeps the
full history either way.

Observed is the source that can contradict the other two, which is why it is
shown separately in both the CLI and the admin page: a key nothing claims to use
but something resolves hourly is worth a look, and so is a declared reason that
never shows up as a resolve.

**A status probe is logged, but is not a use.** Reading a key to answer "is this
configured?" — what every API-key check in `runHealthChecks` does — resolves the
value without spending it, and passes `observe: false` to `resolveSecret`. The
two records then part company, deliberately:

- the **access log** keeps its `resolve` line, because a probe really did read
  the value and the log is attribution — omitting it would put a hole in the one
  record that answers "what touched this key";
- the entry's **`lastUsed` and `purposes` do not move**, because those answer "is
  this grant still earning its keep". A dashboard polling health every minute
  would otherwise pin a long-dead key's last-use to *now*, forever, and the one
  source that can contradict a declared reason would be reporting the monitoring,
  not the work.

The per-key readers (`core/mistral-key.ts` and its siblings) take the flag as an
argument rather than defaulting it, so each call site says which it is. Gemini's
reader takes its `purpose` the same way — that key has two genuinely different
spends (`gemini-vision` for scan import, `gemini-audio-question` for
`bbx chat ask-about-audio`), and one hardcoded label had the log claiming every
audio question was vision work.

```bash
bbx secrets declare weatherapi --note "…" --use "forecasts in the morning brief"
bbx secrets describe weatherapi --add-use "the umbrella reminder trick"
bbx secrets describe weatherapi --remove-use "the umbrella reminder trick" --agent-confirmed
```

Adding a use is **agent-facing and unguarded**, like `declare`: an agent that
teaches the box a new trick spending an already-granted key should append why,
and a reason can neither disclose a value nor widen an access level. Removing or
clearing carries the agent guard — deleting the line that justified a grant is
an edit a human has to be behind.

A reason is free prose (unlike a resolve `purpose`, which is a constrained
label), bounded only so the store and the admin page stay readable: one line,
200 characters, 12 declared reasons per entry.

## Multi-field credentials

**A secret value is an opaque string.** The store never learns a credential's
shape, which is what keeps one entry, one grant, and one rotation true for
every provider. A credential that is structurally several fields is stored as a
**JSON string** the consumer parses and validates with its own zod schema —
`deepgram` (`{apiKey, projectId}`), `telegram-bot/<box>`
(`{botToken, webhookSecret}`), `publish/<box>`
(`{accountId, bucket, apiToken}`).

A stored value that is not valid JSON, or does not match the consumer's shape,
degrades to **not configured** with one warning naming the secret
(`src/core/secrets/json-secret.ts`) — never a throw, since one bad entry must
not take down a box's server, and never a silent fall-through to a stale legacy
file, since the boxholder put something there deliberately and needs to see the
mistake.

## Resolving

```ts
const result = await resolveSecret({ boxRoot, name: "mistral", purpose: "transcription", access: "server" });
if (result.ok) use(result.value.value);   // result.value.suspect: last probe failed
else console.warn(result.error.message);  // relay-ready; result.error.kind is the condition
```

`purpose` is a short label — `^[a-z0-9][a-z0-9-]{0,39}$`, e.g. `transcription`,
`google-oauth`, `weather-trick`. It goes verbatim into the access log, so it is
constrained rather than free text: the loopback route answers `bad-request` for
a violation, and an in-process caller (our own code) trips an invariant.

Refusal kinds, each with a distinct remediation: `unknown-secret`, `empty-slot`,
`not-granted`, `agent-access-not-granted`, `dangling-grant`, `store-unreadable`
(`src/core/secrets/errors.ts`). Connectors degrade to their existing "not
configured" path on any of them — there is no fallback of any kind left to
fall through to. `src/core/secrets/legacy-fallback.ts` and
`refusalAllowsLegacyFallback`, which used to let an `unknown-secret` refusal
fall through to a legacy in-box file or env var during the migration's
transition window, have been deleted; a `not-granted` refusal from
`bbx secrets revoke` is now always final, with no legacy file or exported env
var left to keep a connector working behind it.

Every resolve and refusal appends a line to the access log —
`~/.config/beebox/secrets-log/YYYY-MM.jsonl`, `{ts, box, secret, purpose, event,
refusal?}`, values never logged. A third event, `mint`, records the
*operation* endpoints that spend a stored key without disclosing it
(`deepgramTempKey`, the OpenAI realtime client secret). Those stay deliberately
uncapped — the posture is logged-and-visible, not throttled. It is best-effort by declaration: a log that
cannot be written warns once and the resolve proceeds. Old segments are
deletable; `lastUsed` on the entry is the summary that survives them.

## Box code: `POST /api/secrets/resolve`

Code running *outside* a server process — a trick, a scheduled script, a
procedure step written by the box's agent — cannot call `resolveSecret`
in-process, so it asks its own box over the loopback API
(`src/webapp/routes/secrets.ts`). This is the only interface that discloses a
stored value to box code, and it resolves at `agent` access: the grant must say
`agent`, not `server`.

```bash
curl -sS -X POST "$BBX_SERVER_URL/$BBX_BOX_NAME/api/secrets/resolve" \
  -H "Authorization: Bearer $BBX_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"weatherapi","purpose":"forecast-trick"}'
# -> {"value":"…","suspect":false}
```

`suspect: true` means the entry's last probe or real use failed auth — the key
may be expired; use it, but say so if the call fails.

**It requires the agent auth source specifically.** The route calls
`verifyAgentBearer` itself and accepts nothing else: a session cookie, the hub's
identity header, a mobile device token, or the browse key all get 401, even on a
box served in open-access mode. That is why it is a raw Fastify route and not a
tRPC procedure — the tRPC context folds every credential into one `authed` flag
(`server-box-scope.ts`), so an `authedProcedure` would hand `agent`-granted
values to any browser session that can reach the box.

Refusals come back as `{ kind, message }` with the resolver's own kinds and
relay-ready messages (the point: the agent explains the exact condition and the
boxholder knows which action fixes it):

| Status | Kinds | Why that status |
|---|---|---|
| 401 | `not-agent-authenticated` | The credential was not this box's agent token. |
| 400 | `bad-request` | The body was not `{name, purpose}`, or `purpose` was not a short label. |
| 403 | `not-granted`, `agent-access-not-granted` | The secret exists; a boxholder decision stands between you and it. |
| 404 | `unknown-secret`, `empty-slot`, `dangling-grant` | There is no value to be had under that name — missing, empty, or stale. |
| 503 | `store-unreadable` | The machine's store could not be read; not the caller's to fix. |

**The convention for using one** (a `knows_directly` knowledge-audit item —
forgetting it is how a credential ends up committed):

1. `bbx secrets declare <name> --note "what it is, where to get it"` names the
   slot. The declaring box is recorded, so `bbx secrets status <box>` shows what
   it is still waiting on. An agent can declare; only the boxholder can supply a
   value or grant it (at `agent` access, for this endpoint to work).
2. Resolve it **at call time**, every time. Hold the value in a local variable
   for the length of the outbound request.
3. Never write it anywhere: not a card, not a config file, not an env var, not a
   log line, not the code. There is one copy, in the store, and rotation is
   supposed to touch only that copy.

## Verification: the probe and format registries

Two server-owned registries help the boxholder get a key in correctly, and both
are **advisory toward the value and authoritative about who decides**:

- **Format** (`src/core/secrets/format-registry.ts`) — per-name prefix/length
  heuristics behind the admin input's live hints. They **warn and never block**:
  provider formats drift, and a hard gate would brick key entry the day a prefix
  changes. An entry's `formatHint` may name a registry key; an agent may supply
  one.
- **Probe** (`src/core/secrets/probe-registry.ts`) — after a value is stored, one
  cheap harmless authenticated call decides `verified: ok | failed | unchecked`
  on the entry. `mistral`/`openai`/`openai-thinking`/`gemini`/`deepgram` use a
  models-or-projects listing; `telegram-bot/<box>` uses `getMe`; `publish/<box>`
  has none (an R2 check is neither free of side effects nor cheap) and stays
  `unchecked`, as does any name with no entry.

**Probe targets are server-owned and nothing else can name one.** An
agent-supplied probe URL would send the freshly-saved secret wherever the agent
pointed it — agents supply format hints, never probe targets. A `family/` probe
additionally requires the entry to carry `owningBox` + `shareable: false`, which
only the connector flow that owns the family sets: without that, an agent could
declare `telegram-bot/anything` and choose where a value the boxholder pasted
gets sent.

Only an auth rejection (401/403; 400 as well for Google, which answers a bad key
that way) records `failed`; a 500, a timeout, or DNS failure records `unchecked`
with a reason, so a provider outage never flags a working key as expired. A
`failed` verification is what makes a later `resolveSecret` return
`suspect: true`, and `markSecretVerificationFailed(name, reason)` is how a
consumer reports a real 401 — wired into the Mistral and Deepgram transcription
paths, which is stronger evidence than any probe.

A stored reason is assembled from the status code, fixed prose, and (for a
network failure) the error's *class* only — never a message, since fetch and
proxy errors quote the request URL and Telegram's probe URL contains the token.
A verdict is written back only if the entry's `updated` stamp still matches the
value that was probed, so a slow probe cannot land on a rotated key.

Probes run fire-and-forget after `set`/`setAndGrant`, and are awaited by the
admin page's save so the boxholder sees the verdict in the same interaction (one
request either way — an in-flight probe for the same value is joined, not
duplicated). Tests set `BBX_SECRET_PROBES=off`, which suppresses only the real
network path; an injected `fetch` still runs.

## The admin page

The owner-only **Secrets** section on any box's admin page is the boxholder's
surface (`src/frontend/src/components/admin/SecretsSection*.tsx`):

- **This box** — every granted name with its access level, verification badge,
  note, **what it is used for** (built-in, declared, and observed — see "Why a
  secret exists"), and last-used; set/rotate a value (masked input, soft format warnings);
  raise/lower access; revoke; supply values for slots the agent declared; revoke
  stale grants; grant an existing machine-level name (the picker hides names
  another box owns exclusively).
- **Machine-wide** (Decision 8) — every name on the machine, its grants across
  every box, `shareable` flags, uses, last-used, and removal. Reachable from any box's
  page, since the store is machine-level and there is no separate hub UI.

No procedure in `trpc/routers/secrets.ts` returns a value — not on a read, not
as an echo after a write, not in an error.

**It is the one router behind `authenticatedOwnerProcedure`** (`trpc/trpc.ts`),
the strict variant of the usual `ownerProcedure`. `ctx.isOwner` also passes an
**open-access** box — one whose boxholder opted out of the auth wall — and for
every other owner surface that is right, because those surfaces are box-scoped.
This store is machine-level, so one box served openly must not become a
management surface for its neighbours' credentials. A real signed-in owner
identity qualifies; open access does not, and the refusal says so:
`secrets management requires an authenticated owner session — open-access does
not qualify`. The consequence to know: on a box you run open (a dev box, a
deliberate opt-out), the admin Secrets section refuses — manage those secrets
from a box you sign in to, or with `bbx secrets`.

## `bbx secrets`

Plumbing for deploy scripts, the migration, agents, and emergencies — the
boxholder's surface is the admin page (a later chunk). Values are never printed
and never taken from argv.

| Command | What it does |
|---|---|
| `printf %s "$KEY" \| bbx secrets set <name>` | Store or rotate a value (stdin, or a hidden prompt). A value in argument position is refused. |
| `bbx secrets rm <name>` | Remove an entry; grants naming it become dangling grants. |
| `bbx secrets declare <name> --note …` | Create an empty, ungranted slot — the **agent-facing** subcommand. Records the declaring box (`declaredBy`) for `status`. |
| `bbx secrets describe <name> --add-use …` | Say why a secret exists — repeatable and additive. Agent-facing, scoped to the box's own grants and declared slots; `--remove-use`/`--clear-uses` need `--agent-confirmed`. |
| `bbx secrets list` | Names + metadata across the machine, never values. The machine-wide view, so it carries the agent refusal. |
| `bbx secrets grant <box> <name> [--access server\|agent]` | Per-box opt-in; refuses for a `shareable: false` secret. |
| `bbx secrets revoke <box> <name>` | Withdraw a grant. |
| `bbx secrets status <box>` | One box's grants, empty slots, and dangling grants. In an agent session, only the box the command runs in. |
| `bbx secrets copy-grants <from> <to>` | Give one box the same grants another holds — what `deploy/add-box.sh --secrets-from` runs. Access levels carry over; `shareable: false` entries are skipped and named. |
| `bbx secrets migrate [--root <dir>] [--dry-run]` | The one-time move of every box's legacy `_config/connectors/*.secret.json` into the store. |

`<box>` is a slug or a box root path. `set`/`rm`/`grant`/`revoke`/`copy-grants`,
`describe --remove-use`/`--clear-uses`,
`list`, and a non-dry-run `migrate` refuse in an
agent session without `--agent-confirmed` (the `bbx auth` pattern) — a speed bump
and an audit signal, not an authorization boundary. `declare` is exempt: an
agent naming a slot it needs can neither disclose nor empower anything.

An agent's view of the store is its OWN box: `list` is the machine's whole
inventory of names and grants, and `status` refuses in an agent session for any
box other than the one the command is standing in. Neither discloses a value —
what is withheld is the map of which credentials exist and who holds them.

`describe --add-use` is scoped the same way, for the same reason. It stays
unguarded for a name the box holds a grant on or declared itself, but in an
agent session any other name is refused — including one that does not exist, in
*exactly* the same words. An unguarded write that succeeded for a real name and
errored (`SecretNotFoundError`) for an invented one would enumerate the machine's
secrets one guess at a time, which is the map the paragraph above withholds. A
person at a terminal is unaffected, and `--agent-confirmed` carries it through
when the boxholder asked for the edit.

## Migrating a machine: `bbx secrets migrate`

One command per machine moves every box's legacy files into the store
(`src/core/secrets/migrate.ts`). It maps each filename to the store name its
**reader** asks for — the table above is the contract — dedupes identical values
across boxes into one entry with a grant per box, and writes every grant at
`server` access (raising one to `agent` is a boxholder decision, never a
migration's).

```bash
bbx secrets migrate --root /home/beebox/boxes --dry-run   # print the plan, write nothing
bbx secrets migrate --root /home/beebox/boxes --agent-confirmed
```

With no `--root` it migrates the machine's registered boxes
(`~/.config/beebox/boxes.json`). Four properties worth knowing before running it:

- **The original files stay.** `migrate` never deletes them — deleting a
  migrated box's stray files is a separate pass, and `bbx health` flags any it
  finds (see below). Readers no longer fall back to them at all: since the
  legacy-fallback removal, a box with no grant for a migrated name is a
  *refusal* regardless of whether a stray legacy file still sits on disk.
- **Existing store entries are never overwritten** — re-running is a no-op, and
  a key rotated in the store is not reverted to what a stale file holds.
- **A value already in the store wins its name**, and boxes that disagree with
  it are never granted it — a grant to a box holding a different key would
  silently switch that box onto another box's credential. Each other distinct
  value is parked as `<name>/<first-holder-slug>` (one entry per distinct value,
  so boxes that agree with each other still share one) with a printed CONFLICT
  line. With nothing stored yet, the alphabetically-first slug's value wins, so
  the choice is stable across runs. A parked entry is *not* what its reader
  looks up, and the contested name now EXISTS in the store — so a parked box
  gets `not-granted` and reads as not configured. Reconcile those boxes
  promptly: pick the key each should use and grant it.
- **Unrecognized files are reported, not imported.** `google.secret.json` and
  `gmail.secret.json` hold OAuth *tokens* (`google-token-store.ts` keeps them);
  a guessed store name would create an entry no reader asks for.

Nothing it prints is ever a value — names, slugs, and counts only.

Prod runs operator-side over `deploy/prod-ssh`, with the boxholder present; no
unattended prod mutation.

## Migrating a connector

Mistral is the template (`src/core/mistral-key.ts`): resolve from the store,
full stop — no fallback to a legacy in-tree `_config/connectors/<name>.secret.json`
or an env var. That fallback path (`refusalAllowsLegacyFallback`,
`src/core/secrets/legacy-fallback.ts`) existed only for the migration's
transition window and has since been deleted, along with the env-var
fallbacks it used to reach for `mistral`, `deepgram`, `openai`,
`openai-thinking`, and `gemini`. `bbx health` still flags any surviving
`_config/connectors/*.secret.json` as a warning (`legacy-secret-files`),
because a file that still exists is a live credential sitting in the agent's
own working directory even though nothing reads it anymore — delete it once
`bbx secrets migrate` has moved its value into the store.

Tests get an isolated store automatically: `makeTmpBox()` points
`BBX_SECRETS_FILE` at a throwaway file unless the test set one itself, so a
store-writing test can never mutate the developer's real
`~/.config/beebox/secrets.json`.

## Worktree boxes have their own store

The dev router points every worktree's box at
`~/.cache/beebox/secrets/<worktree>.json` (`BBX_SECRETS_FILE`, with
`BBX_SECRETS_STORE_ISOLATED=1` asserting it is throwaway; `main` keeps the
default path and never carries the assertion). A test box therefore never
reads or writes the boxholder's real keys, starts empty, and — because the
router asserted the store is isolated — its Secrets panel is reachable by
agent browsing on a box that opts in as owner, so the add-a-key flow can be
driven and verified rather than only read about. The override path alone
does not open the panel: `main` inherits `BBX_SECRETS_FILE` from the shell
or `.env` like any other variable, and an operator's override is still the
real store.

## Adding a key from a box's own page

From Admin → Secrets on a box, adding a key means "and use it here": the value
is stored and this box is granted it at `server` access in one locked write
(`setAndGrantSecret`), and the page says what the key now does. Granting is
the advanced case — one store, many boxes, a second box borrowing what the
first holds — and lives under *"Use a key another box already has"* at the
bottom of the tab, shown only when there is something to borrow. The
Machine-wide tab's add form stores without granting, for that deliberate case.

The names the engine recognises are offered as buttons, each with a
**guide** (`core/secrets/guide-registry.ts`): what the credential is, where a
person gets one, and what it looks like. What it is *used for* is not in the
guide — it is joined from `uses.ts`, so a new consumer of a key shows up on the
page without anyone editing prose twice. The registry is server-owned for the
same reason the probe registry is: it carries a URL the boxholder will click.
A name typed by hand that normalises to a known one (`OpenRouter`,
`openrouter.ai`) gets a suggestion, never a rewrite (`shared/secret-name-suggest.ts`).

## One key that stands in for several

`openrouter` is the only name here that is not a service's own credential. It
is a fallback: each model-backed service uses its own provider key when the box
has one, and reaches the same model through OpenRouter when it does not
(`core/openrouter.ts`). Granting it lights up semantic search, audio
questions, and the Whisper high-quality transcription pass without any further
configuration. It also unlocks two HQ transcription services that exist only
behind it — `mai` and `mai-diarized`, Microsoft's MAI-Transcribe-2, which the
box can reach no other way and which is its only speaker-labelling option that
does not need a Mistral key, and granting it changes nothing about a service that already has
its own key.

Scan-import is the one that still needs a second thing set. Its default vision
backend is Claude on the agent's own subscription auth, which needs no key at
all and is the better backend; an OpenRouter key must not quietly move scan
import off it. So `BBX_SCAN_VISION=gemini` still selects the Gemini backend, and
the OpenRouter key only decides how that backend is reached once selected.

It does not cover everything. Chat text-to-speech and the three realtime
dictation paths stay on their own providers — OpenRouter carries no OpenAI TTS
model and has no realtime protocol at all. Voxtral HQ transcription stays on
Mistral too: through OpenRouter that model answers in plain JSON only and cannot
diarize, so `hqService: voxtral` or `voxtral-diarized` still needs a `mistral`
key. A box that wants any of these needs `openai-thinking`, `mistral`, or
`deepgram` as before. `bbx health` prints a
`model-routes` line naming what each service is currently using.

## Picking a service the box cannot reach yet

`core/model-capabilities.ts` mirrors the dispatch logic above into a truth
table (`serviceCapabilities`): for every HQ transcription service and TTS
backend, whether the box currently holds a credential that reaches it, and
which secret(s) would fix it if not. The voice-menu pickers read this through
the owner-only `voice.capabilities` query and render an unreachable choice
disabled with its reason, rather than letting the boxholder select something
that will fail on every pass. Saving is never blocked on this, though — a key
may be granted later — so `setHqService` and `setBackend` still accept an
unusable choice and return a `warning` string (`unusableWarning`) alongside
the committed config, which the client surfaces instead of a bare success.
