# Secrets: the machine-level store

Connector credentials live in ONE file per machine —
`~/.config/cb/secrets.json` (override `$CB_SECRETS_FILE`), mode 0600, outside
every box tree — with a per-box grant deciding who may resolve what. Design and
rationale: [`plans/secret-custody.md`](plans/secret-custody.md). This page is
the operational reference for what exists today.

Built so far: the store, the resolver, `cb secrets`, and **every connector
reader** migrated (see "Secret names" below). The loopback `secrets.resolve`
endpoint, the admin Secrets section, the chat capture widget, the
probe/format registry, and the removal of the legacy file/env fallbacks are
later chunks.

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

## `cb secrets`

Plumbing for deploy scripts, the migration, agents, and emergencies — the
boxholder's surface is the admin page (a later chunk). Values are never printed
and never taken from argv.

| Command | What it does |
|---|---|
| `printf %s "$KEY" \| cb secrets set <name>` | Store or rotate a value (stdin, or a hidden prompt). A value in argument position is refused. |
| `cb secrets rm <name>` | Remove an entry; grants naming it become dangling grants. |
| `cb secrets declare <name> --note …` | Create an empty, ungranted slot — the **agent-facing** subcommand. |
| `cb secrets list` | Names + metadata across the machine, never values. |
| `cb secrets grant <box> <name> [--access server\|agent]` | Per-box opt-in; refuses for a `shareable: false` secret. |
| `cb secrets revoke <box> <name>` | Withdraw a grant. |
| `cb secrets status <box>` | One box's grants, empty slots, and dangling grants. |

`<box>` is a slug or a box root path. `set`/`rm`/`grant`/`revoke` refuse in an
agent session without `--agent-confirmed` (the `cb auth` pattern) — a speed bump
and an audit signal, not an authorization boundary. `declare` is exempt: an
agent naming a slot it needs can neither disclose nor empower anything.

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
