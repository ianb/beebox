# OpenCode as a third box engine

*2026-08-25, v1.18.23. Scored against the contract the Codex engine met —
`beebox/docs/implemented-plans/codex-box-engine.md` (its capability-probe table and
tracks). Evidence is from source; no live probe was run. Paths are inside the OpenCode
repo unless prefixed `beebox/`.*

## The July blockers, re-checked

| 2026-07-18 blocker | Today |
|---|---|
| Caller-chosen session id refused (#2159) | Issue closed "completed" 2026-04-12, but only the internal `createNext` takes `id?` (`packages/opencode/src/session/session.ts`); the HTTP `Session.CreateInput` and both generated SDKs (`packages/sdk/js/src/gen/types.gen.ts`, v1 and v2) have no `id`. **Still a blocker.** |
| In-flight resume across restart (#19023) | Still closed not-planned; run coordinator is in-memory only (`packages/core/src/session/run-coordinator.ts`). |
| SQLite migration data loss (#34445) | **Still open.** HEAD commit on 2026-08-25 is a migration-history recovery fix; 38 migrations, five from a June session-model rework. |
| Image push (#20802) | Scoped to custom OpenAI-compatible providers; first-party path works by schema (`FilePartInput`, data: URLs). |
| Subscription OAuth only via community plugins | ChatGPT Plus/Pro OAuth is now first-party with a headless device flow (`packages/core/src/plugin/provider/openai.ts`). Claude Pro/Max OAuth is still absent from the repo — community plugin only. |

## Scorecard

| Capability | Grade | Evidence |
|---|---|---|
| Session identity (caller-coined) | missing | above; breaks `coinedSessionId` (`beebox/src/core/chat/session/reserve.ts`) the same way Codex does |
| Resume after restart | works | history re-read from SQLite each loop iteration (`session/prompt.ts`) |
| Typed streaming events | works | `packages/schema/src/session-event.ts`; turn end = `session.status` idle |
| Tools + structured final output | works, v1 API only | `OutputFormatJsonSchema` injected as a required synthetic tool (`prompt.ts`) — coexists with tools by construction; absent from the v2 `session.prompt` |
| Local image input | works (unverified live) | `FilePartInput {type:"file", mime, url}` |
| Per-turn FS sandbox | missing | no seatbelt/bwrap/landlock anywhere; only a path-prefix check raising an `external_directory` ask |
| Interrupt | works | `POST /session/:id/abort`; fiber interrupt, 250 ms grace |
| Token accounting | works, better than Codex | per-message tokens incl. cache read/write **and USD `cost`** (`packages/schema/src/session-message.ts`) |
| Post-tool hook that feeds back same turn | **works — the standout** | `tool.execute.after` in an in-process plugin; a throw becomes a tool error the model sees. `permission.ask` can deny with a message. |
| maxTurns | partial | per-agent `steps` config, not per request |
| maxBudgetUsd | missing | cost reported, never enforced |

## beebox-specific needs

- **Headless surface:** `@opencode-ai/sdk` spawns `opencode serve` and gives a typed
  OpenAPI client. Cleaner than the hand-written JSON-RPC-over-stdio Codex wrapper. ACP
  exists but is a stdio bridge over the same HTTP API; the Codex plan already rejected ACP.
- **Instructions/skills:** reads `CLAUDE.md` (walk-up, plus `~/.claude/CLAUDE.md`) and
  `.claude/skills/**/SKILL.md` natively (`session/instruction.ts`, `skill/index.ts`), so
  the Codex plan's Track 4 symlink generation is unnecessary. Gaps carry over: no `@file`
  include expansion, no glob-scoped `.claude/rules/` tier (the generated rule-skills
  workaround applies). System prompt is append-only via a per-request `system` field.
- **Transcript reading:** `GET /session/:id/message` returns a part union richer than
  Codex `thread/read` (tool states, compaction, subtask, patch). Storage is one **global**
  SQLite DB (`~/.local/share/opencode/opencode.db`, `OPENCODE_DB` override) — read via
  the API, never the file.
- **Unattended:** `permission: "allow"` or `OPENCODE_PERMISSION` env JSON. Design against:
  `Permission.Service.ask` awaits a `Deferred` with **no timeout** — an unanswered ask
  hangs the turn. A host must allow-all *and* auto-answer `permission.asked` events.
- **Auth:** `~/.local/share/opencode/auth.json`, injectable via `OPENCODE_AUTH_CONTENT`.
  Claude subscription = community plugin (ToS-exposed, per the July finding). Zen (their
  metered gateway) is a first-party paid path — a third vendor relationship.
- **Footprint/stability:** single binary, fine. No stated API-stability policy; v1 and
  v2 HTTP/SDK/event surfaces ship simultaneously, and an adapter today straddles both
  (structured output on v1, durable session events on v2).

## Size relative to the Codex adapter

Codex adapter: ~1,700 LOC + ~480 LOC doctests. Reused unchanged: engine selection
(`agentEngine` becomes a three-value union), pinned-engine history rows, unavailability
and wait machinery, `load-history.ts` dispatch shape. Dropped: Track 5's usage ledger
(cost comes over the API) and Track 4's symlinks. New: a supervised long-lived
`opencode serve` per box with a per-box `OPENCODE_DB`; a host-side session-id map;
a `beebox-opencode` plugin doing `tool.execute.after → bbx validate --hook`
(better than the Codex wrapper-validation fallback). **Roughly the same size, ±20%.**

## Disposition: later

Not because the adapter is hard — because the three things it would rest on are the
least settled parts of OpenCode: session identity at the API boundary, storage
durability, and unattended safety by absence rather than policy. Re-open when the
triggers in `issues/watch/2026-08-25-opencode-third-engine-triggers.md` fire. What
OpenCode would buy over Codex: same-turn validator feedback, USD cost, richer
transcripts, ChatGPT-subscription auth without our own wrapper.
