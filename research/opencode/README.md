# OpenCode review

*2026-08-25. Snapshot of [anomalyco/opencode](https://github.com/anomalyco/opencode)
(formerly `sst/opencode`; `opencode.ai`) at v1.18.23. MIT, TypeScript, shipped as a
Bun-compiled binary behind a Node shim; ~200K stars; 2–3 releases a week. Not the
Charm `opencode` that became Crush. Method: two source-reading subagents (Opus)
against a shallow clone plus the docs and issue tracker; the boxholder's framing was
"OpenCode is a harness, beebox is a layer on top — overlap may be nothing."*

Two questions, one note each:

| Doc | Question | Outcome |
|---|---|---|
| [engine.md](engine.md) | What would it take to support OpenCode as a third box engine beside Claude Code and Codex? | **later** — adapter about the size of the Codex one, but three blockers unchanged since the [2026-07-18 scorecard](../backend-alternatives/2026-07-18-alt-harnesses.md): no caller-chosen session id at the API boundary, storage churn with an open data-loss issue, no sandbox + a permission gate with no timeout. Triggers recorded in [issues/watch](../../issues/watch/2026-08-25-opencode-third-engine-triggers.md). |
| [inspiration.md](inspiration.md) | What does it offer a layer that rents the loop? | **not much, not nothing** — six items below; the rest is harness territory or places beebox is already ahead. |

## Dispositions

| Idea | Disposition | Traced to |
|---|---|---|
| Third engine adapter | **later** | [engine.md](engine.md); `beebox/docs/implemented-plans/codex-box-engine.md` is the template; watch item above |
| `opencode export --sanitize` — structure-preserving redacted transcript | **adopt** | [issues/features/…session-export-sanitize](../../issues/features/2026-08-25-session-export-sanitize.md); boxholder rule that real-box material never reaches the public repo unvetted |
| `CONTEXT.md` — Context Source / Epoch / mid-conversation system message | **adapt** the shape above the SDK | [issues/exploration/…mid-session-context-admission](../../issues/exploration/2026-08-25-mid-session-context-admission.md) |
| `CONTEXT.md` — glossary form: `_Avoid_:` lines + invariant list | **adopt** | appended to `issues/docs-and-chores/2026-05-21-fill-out-the-glossary.md`; duplicate `asset` entry fixed in this pass |
| `small_model` slot for title/summary/review passes | **adapt** | [issues/features/…small-model-slot](../../issues/closed/features/2026-08-25-small-model-slot.md) |
| `subagent_depth` + child permission derivation | **adapt** | appended to `issues/exploration/2026-05-19-subagent-strategy.md` |
| Plugin hook taxonomy (`session.idle`, `session.compacting`, `tool.definition`) | **later** — a gap list for when the Agent SDK exposes them | [inspiration.md §hooks](inspiration.md) |
| Shadow git checkpoint via `objects/info/alternates` | **later** — reactor-turn undo, not filed | [inspiration.md](inspiration.md) |
| `invalid` sentinel tool (malformed call → well-formed error result) | **reference** — check what a schema-failing card write does mid-turn | [inspiration.md](inspiration.md) |
| Permission ruleset, agents-as-markdown, Zen, Codemode, live share, Slack package, remote-URL instructions | **reject** | reasons per row in [inspiration.md](inspiration.md) |

## Where beebox is ahead

Context tiering with a size lint and knowledge audits; questions as durable cards
rather than a turn-blocking `Deferred`; validation of the *artifacts* (`bbx validate`),
not just config; snapshot-never-live publishing vs public-by-secret-URL share with an
`auto` mode; a versioned mobile wire contract. Recorded so the survey isn't read as a
gap list only.

## Fixed in passing

- `.claude/skills/bbx-context/SKILL.md` said boxes get no skills; `src/core/box/skills.ts` installs managed ones. Line corrected.
- `beebox/docs/glossary.md` carried two `asset` definitions; the superseded manifest one removed.
