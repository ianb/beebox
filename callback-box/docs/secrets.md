# Secrets: the machine-level store

Connector credentials live in ONE file per machine —
`~/.config/cb/secrets.json` (override `$CB_SECRETS_FILE`), mode 0600, outside
every box tree — with a per-box grant deciding who may resolve what. Design and
rationale: [`plans/secret-custody.md`](plans/secret-custody.md). This page is
the operational reference for what exists today.

Built so far (the plan's thin slice): the store, the resolver, `cb secrets`,
and Mistral migrated end-to-end. The loopback `secrets.resolve` endpoint, the
admin Secrets section, the chat capture widget, the probe/format registry, and
the remaining connectors are later chunks.

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
refusal?}`, values never logged. It is best-effort by declaration: a log that
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
var. The fallbacks are removed in a later chunk.
