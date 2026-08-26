# What OpenCode offers a layer above the harness

*2026-08-25, v1.18.23. Filtered for a system that rents its agent loop. Skipped as
noise: TUI, LSP, 75+ providers, the enterprise/console/stats SaaS, i18n, Effect-TS idiom.
The Jun–Aug 2026 changelog adds no new subsystem.*

## Worth taking

**`CONTEXT.md` — adapt.** A 225-line ubiquitous-language spec at the repo root: ~30
terms each with an `_Avoid_:` line naming the wrong word, then ~90 one-line invariants;
`AGENTS.md` names it the authority. Two things in it:

- *The form.* `callback-box/docs/glossary.md` is 58 lines and carried two conflicting
  `asset` definitions (fixed in this pass). `_Avoid_:` lines and an invariant list are
  the discipline that catches that. → `issues/docs-and-chores/2026-05-21-fill-out-the-glossary.md`.
- *The content.* Context Source (typed value, stable key, pure renderers), Context Epoch
  (span during which the baseline prompt stays the cache prefix), and Mid-Conversation
  System Message: when a source changes, don't rewrite the cached prefix; emit a durable
  system message at the next safe turn boundary. "Context source changes never wake idle
  sessions." callback-box sends its system prompt once at session creation
  (`src/services/claude-chat.ts`) and relies on the agent re-reading files; a card edited
  by a connector mid-chat is invisible until then, and nothing names that. The SDK gives
  no turn-boundary hook, but the shape is buildable above it as a next-turn preface.
  → `issues/exploration/2026-08-25-mid-session-context-admission.md`.

**`opencode export --sanitize` — adopt.** `packages/opencode/src/cli/cmd/export.ts`
replaces every content field with `[redacted:<kind>:<id>]` and keeps structure verbatim:
a chat bug you can hand over. callback-box has transcript rendering
(`src/cli/lib/session-*.ts`, chat review) and `bin/path-leak-check.ts`, but no redacted
form; the boxholder rule is that real-box material never reaches the public repo
unvetted. → `issues/features/2026-08-25-session-export-sanitize.md`.

**`small_model` — adapt.** One config slot routing title/summary/compaction to a cheap
model. callback-box runs chat-review, title and summary passes on the box's main model.
One knob, no router. → `issues/features/2026-08-25-small-model-slot.md`.

**`subagent_depth` + child permission derivation — adapt.** Default depth 1, enforced by
walking `parentID` (`tool/task.ts`); children get `task`/`todowrite` denied unless
allowed (`agent/subagent-permissions.ts`). callback-box has no depth cap. → appended
to `issues/exploration/2026-05-19-subagent-strategy.md`.

## Hooks — later, as a gap list

`packages/plugin/src/index.ts`. callback-box's box-level lifecycle is one hook
(`PostToolUse → cb validate --hook`). Hooks with no analogue, to ask for when the Agent
SDK grows them:

| Hook | Use for a box |
|---|---|
| `session.idle` | firing point for session-rotation memory flush / open-loop extraction (openclaw-hermes triage #3, #8) |
| `session.compacted`, `experimental.session.compacting → {context, prompt}` | inject box state into the compaction summary — the hook openclaw-hermes §3.2 named as the price of renting the loop |
| `tool.definition` | rewrite a built-in tool's description per project |
| `shell.env` | per-session env into bash |
| `permission.ask → allow/deny` | programmatic approval override |

Also `prune()` (`session/compaction.ts`): non-LLM context shrink that evicts old tool
output past 40k tokens while protecting `skill` outputs. Not applicable without a hook;
noted for the "skills are load-bearing" instinct.

## Reference

- **Shadow-git revert** (`session/revert.ts`, snapshot dir with `objects/info/alternates`
  pointing at the real object store; message- and part-granular). A way to checkpoint a
  box mid-wakeup without polluting box history. Reactor rollback has no undo today.
  Later; not filed.
- **`invalid` sentinel tool**: when a model's args fail schema, return a well-formed
  tool error instead of a dead turn. Check what a schema-failing card write does mid-turn.

## Rejected

| OpenCode | callback-box | Why |
|---|---|---|
| Agents-as-markdown (`mode`, `model`, `steps`, `permission`) | procedures, schedules, wakeup→reactor | different axis: workflows vs loop configurations |
| Permission ruleset (`tool → glob → allow/ask/deny`) | `bypassPermissions` (`src/core/agent/run.ts`) — one trusted operator | openclaw-hermes §3.4 already settled this; a hardline deny-list via PreToolUse is the right size. `doom_loop` and `external_directory` as *concepts* are the only keepers |
| Remote skill index (`skill/discovery.ts`: `index.json`, versioned cache, atomic swap) | compiled-in managed skills (`src/core/box/skills.ts`) | correct today; revisit at the first third-party box skill — the atomic-swap cache is the reference implementation then |
| Live share to `opncd.ai` (public secret URL, `share: auto`) | `docs/plans/publish-pages.md`: snapshot-never-live, fail-closed tiers | validates callback-box's posture |
| Codemode (restricted-JS tree-walking interpreter batching tool calls) | `cb <verb>` composable in one bash line | solves the huge-MCP-catalog problem callback-box doesn't have |
| One server, many clients; ACP; desktop sidecar | web + iOS over one server; `docs/mobile-contract.md` | already done, and the drift legend is sharper |
| Slack package (thread ↔ session, no approval path) | Telegram placeholder | a chat surface without an approval channel isn't a control surface |
| Zen gateway, `experimental.policies` | — | a business; procurement policy for one boxholder |
| `instructions` incl. remote URLs, no glob-scoped tier | six-tier context router (`cb-context`) with size lint + knowledge audits | OpenCode is the worked counterexample to the attention-budget argument |
| `question` tool blocking on a `Deferred` | question cards that outlive the session (`docs/questions.md`) | callback-box is ahead |
