# Secrets: the machine-level store

Connector credentials live in ONE file per machine —
`~/.config/cb/secrets.json` (override `$CB_SECRETS_FILE`), mode 0600, outside
every box tree — with a per-box grant deciding who may resolve what. Design and
rationale: [`plans/secret-custody.md`](plans/secret-custody.md). This page is
the operational reference for what exists today.

Built so far: the store, the resolver, `cb secrets`, **every connector reader**
migrated (see "Secret names" below), the loopback resolve endpoint that box code
uses for `agent`-access grants, the probe + format registries, and the **admin
page's Secrets section** (this box's grants plus a machine-wide view). The chat
capture widget and the removal of the legacy file/env fallbacks are later
chunks.

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
mapping below is the migration's contract — the migration script dedupes
existing `config/connectors/*.secret.json` files into exactly these names, so
**the store name matches the legacy file's basename wherever a file existed**.

| Name | Consumers | Legacy file | Env fallback |
|---|---|---|---|
| `mistral` | `core/mistral-key.ts`, `/api/adapters/mistral` | `mistral.secret.json` | `CALLBACK_MISTRAL_API_KEY` |
| `deepgram` | `core/deepgram-key.ts` | `deepgram.secret.json` | `CALLBACK_DEEPGRAM_API_KEY` + `CALLBACK_DEEPGRAM_PROJECT` |
| `openai` | `core/search/embeddings-key.ts`, `/api/adapters/openai` | `openai.secret.json` | `CALLBACK_OPENAI_API_KEY` |
| `openai-thinking` | chat TTS, Whisper, the realtime mint | — | `THINKING_OPENAI_API_KEY` |
| `gemini` | `core/gemini-key.ts` (audio questions, scan-import vision) | — | `GEMINI_KEY`, then `SKE_GEMINI_API_KEY` |
| `google-oauth-client-id` / `google-oauth-client-secret` | `connectors/google-auth.ts` | — | `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` |
| `anthropic`, `replicate` | `/api/adapters/<name>` | `<name>.secret.json` | — |
| `telegram-bot/<box>` | `connectors/telegram-helpers.ts`, admin setup | `telegram.secret.json` | — |
| `publish/<box>` | `publish/connector-secret.ts` | `publish.secret.json` | — |

`openai` and `openai-thinking` are two names for two keys on purpose: a
transcription key is not consent to pay for embeddings, and the split predates
the store. Google's *tokens* are NOT here — `google-token-store.ts` /
`CB_GOOGLE_TOKENS_FILE` is untouched; only the OAuth app's client credentials
moved.

The last two are **single-box** entries: they carry `owningBox` +
`shareable: false` and are granted automatically by the flow that creates them
(telegram setup, `cb pub setup --mint-connector-token`). A grant to any other
box is refused with an explanation — a Telegram bot token routes to one webhook
URL and an R2 token is scoped to one bucket, so sharing would break routing
rather than merely be unwise.

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

Refusal kinds, each with a distinct remediation: `unknown-secret`, `empty-slot`,
`not-granted`, `agent-access-not-granted`, `dangling-grant`, `store-unreadable`
(`src/core/secrets/errors.ts`). Connectors degrade to their existing "not
configured" path on any of them.

Every resolve and refusal appends a line to the access log —
`~/.config/cb/secrets-log/YYYY-MM.jsonl`, `{ts, box, secret, purpose, event,
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
curl -sS -X POST "$CB_SERVER_URL/$CB_BOX_NAME/api/secrets/resolve" \
  -H "Authorization: Bearer $CB_AGENT_TOKEN" \
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
| 400 | `bad-request` | The body was not `{name, purpose}`. |
| 403 | `not-granted`, `agent-access-not-granted` | The secret exists; a boxholder decision stands between you and it. |
| 404 | `unknown-secret`, `empty-slot`, `dangling-grant` | There is no value to be had under that name — missing, empty, or stale. |
| 503 | `store-unreadable` | The machine's store could not be read; not the caller's to fix. |

**The convention for using one** (a `knows_directly` knowledge-audit item —
forgetting it is how a credential ends up committed):

1. `cb secrets declare <name> --note "what it is, where to get it"` names the
   slot. The declaring box is recorded, so `cb secrets status <box>` shows what
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
duplicated). Tests set `CB_SECRET_PROBES=off`, which suppresses only the real
network path; an injected `fetch` still runs.

## The admin page

The owner-only **Secrets** section on any box's admin page is the boxholder's
surface (`src/frontend/src/components/admin/SecretsSection*.tsx`):

- **This box** — every granted name with its access level, verification badge,
  note and last-used; set/rotate a value (masked input, soft format warnings);
  raise/lower access; revoke; supply values for slots the agent declared; revoke
  stale grants; grant an existing machine-level name (the picker hides names
  another box owns exclusively).
- **Machine-wide** (Decision 8) — every name on the machine, its grants across
  every box, `shareable` flags, last-used, and removal. Reachable from any box's
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
from a box you sign in to, or with `cb secrets`.

## `cb secrets`

Plumbing for deploy scripts, the migration, agents, and emergencies — the
boxholder's surface is the admin page (a later chunk). Values are never printed
and never taken from argv.

| Command | What it does |
|---|---|
| `printf %s "$KEY" \| cb secrets set <name>` | Store or rotate a value (stdin, or a hidden prompt). A value in argument position is refused. |
| `cb secrets rm <name>` | Remove an entry; grants naming it become dangling grants. |
| `cb secrets declare <name> --note …` | Create an empty, ungranted slot — the **agent-facing** subcommand. Records the declaring box (`declaredBy`) for `status`. |
| `cb secrets list` | Names + metadata across the machine, never values. |
| `cb secrets grant <box> <name> [--access server\|agent]` | Per-box opt-in; refuses for a `shareable: false` secret. |
| `cb secrets revoke <box> <name>` | Withdraw a grant. |
| `cb secrets status <box>` | One box's grants, empty slots, and dangling grants. |
| `cb secrets copy-grants <from> <to>` | Give one box the same grants another holds — what `deploy/add-box.sh --secrets-from` runs. Access levels carry over; `shareable: false` entries are skipped and named. |
| `cb secrets migrate [--root <dir>] [--dry-run]` | The one-time move of every box's legacy `config/connectors/*.secret.json` into the store. |

`<box>` is a slug or a box root path. `set`/`rm`/`grant`/`revoke`/`copy-grants`
and a non-dry-run `migrate` refuse in an
agent session without `--agent-confirmed` (the `cb auth` pattern) — a speed bump
and an audit signal, not an authorization boundary. `declare` is exempt: an
agent naming a slot it needs can neither disclose nor empower anything.

## Migrating a machine: `cb secrets migrate`

One command per machine moves every box's legacy files into the store
(`src/core/secrets/migrate.ts`). It maps each filename to the store name its
**reader** asks for — the table above is the contract — dedupes identical values
across boxes into one entry with a grant per box, and writes every grant at
`server` access (raising one to `agent` is a boxholder decision, never a
migration's).

```bash
cb secrets migrate --root /home/callback/boxes --dry-run   # print the plan, write nothing
cb secrets migrate --root /home/callback/boxes --agent-confirmed
```

With no `--root` it migrates the machine's registered boxes
(`~/.config/cb/boxes.json`). Four properties worth knowing before running it:

- **The original files stay.** Every reader still falls back to them, so a
  mis-migrated box keeps working; deleting them is a separate later pass.
- **Existing store entries are never overwritten** — re-running is a no-op, and
  a key rotated in the store is not reverted to what a stale file holds.
- **Boxes that disagree** about a shared name (two different Mistral keys) do
  not collapse: the alphabetically-first slug keeps the plain name and each
  other box's value is parked as `<name>/<slug>` with a printed CONFLICT line.
  A parked entry is *not* what its reader looks up — that box keeps running on
  its legacy file until the boxholder reconciles it.
- **Unrecognized files are reported, not imported.** `google.secret.json` and
  `gmail.secret.json` hold OAuth *tokens* (`google-token-store.ts` keeps them);
  a guessed store name would create an entry no reader asks for.

Nothing it prints is ever a value — names, slugs, and counts only.

Prod runs operator-side over `deploy/prod-ssh`, with the boxholder present; no
unattended prod mutation.

## Migrating a connector

Mistral is the template (`src/core/mistral-key.ts`): resolve from the store
first, fall back to the legacy in-tree `config/connectors/<name>.secret.json`
with a once-per-process deprecation warning naming the stray file, then the env
var. The fallbacks are removed in a later chunk; until then `cb health` flags
any surviving `config/connectors/*.secret.json` as a warning
(`legacy-secret-files`), because a file that still exists is a live credential
in the agent's own working directory.

Tests get an isolated store automatically: `makeTmpBox()` points
`CB_SECRETS_FILE` at a throwaway file unless the test set one itself, so a
store-writing test can never mutate the developer's real
`~/.config/cb/secrets.json`.
