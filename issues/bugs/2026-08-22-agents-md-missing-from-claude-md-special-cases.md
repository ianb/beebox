---
title: "`AGENTS.md` is missing from the places that special-case `CLAUDE.md` — refresh-maps fails forever on every codex box"
workstream: unattached
area: callback-box
labels: [codex, maps, procedures]
priority: important
filed-by: agent
discovered-by: Ian
discovered-in: main session — diagnosing a daily refresh-maps failure on a codex-engine box
---

A box whose `agentEngine` is `codex` gets an `AGENTS.md` symlink beside every
`CLAUDE.md` (`core/agent-context-mirrors.ts`), because Codex reads `AGENTS.md`
where Claude reads `CLAUDE.md`. That is correct and intended — the mirrors are
symlinks, tracked, ~9 bytes each.

**But the code that special-cases `CLAUDE.md` was never taught about
`AGENTS.md`.** The sharpest consequence is that `refresh-maps` fails every day
on such a box and cannot ever succeed.

## The stalemate

`core/maps/precheck-ignore.ts:81`:

```ts
const META_FILES: readonly string[] = ["MAP.md", "CLAUDE.md", MAP_STATE_FILE];
```

Its own doc comment: *"Names that appear in directories but should never appear
in the listing."* `AGENTS.md` belongs in that list and is absent.

So every directory holding a `CLAUDE.md` presents refresh-maps with an unmapped
file that is, literally, a symlink to the file excluded on the line above. The
precheck demands each MAP list it; the agent correctly declines to write an
instruction-file symlink into a content map; `cb refresh-maps --brief` keeps
reporting `needsWork: true`; the validate step fails. Every run, forever.

Observed on a box with 106 instruction files: the run's agent made only an
unrelated `session-manifest.jsonl` edit and then failed validate. Legitimate map
work existed in the same run (two new `config/feedback/` entries) — the
impossible item fails the procedure regardless, so real work is blocked behind
an unsatisfiable check.

## It is not one line — the same omission is in 15 places

Scanning every `"CLAUDE.md"` literal in `src/` for a sibling `AGENTS.md`:

```
core/maps/precheck-ignore.ts:81      <- the confirmed failure
core/maps/finalize.ts:93             <- maps again, write side
core/box/package.ts:249
core/sdk-hooks.ts:90
core/agent/codex-run.ts:62           <- codex path itself
services/codex-chat.ts:49            <- codex path itself
cli/commands/agent-context.ts:17
core/docs-gen/claude-md.ts:27
dev/doc-graph-data.ts:67
dev/doc-graph-html-data.ts:258, 281
dev/doc-link-repair.ts:18
dev/lib/context-layers.ts:65, 83, 103
```

Some are certainly fine as-is (a generator that writes `CLAUDE.md` should not
write `AGENTS.md`; a dev tool may deliberately normalize mirrors away). **Each
site needs a judgment, not a blanket rewrite.** The two in the codex paths and
the second maps site deserve looking at first.

For contrast, the places that *did* get it right —
`core/list-cards.ts:56`, `core/claude-md-lint.ts:46,52,102`,
`dev/lib/codex-audit-behavior.ts:29`, `dev/lib/test-runner.ts:127` — are worth
reading as the intended pattern.

## A second instance of the same class

The same box shows `config/box.json` as unmapped. It is structural config
introduced alongside the engine switch, and it is in neither `META_FILES` nor
`SKELETON_HIDDEN_PATHS`. Decide it deliberately: is it meta (never listed), or
content a MAP should mention? Do not just add it to make the symptom go away.

## Why this was missed

A sweep for `CLAUDE.md` handling was done when box mirrors were introduced, and
these sites were not caught. The lesson worth encoding: **the pairing needs a
guard, not another sweep.** Options worth weighing — a single exported constant
both names come from (so a bare `"CLAUDE.md"` literal is the smell), or a lint
rule flagging the literal outside an allowlist. Without one, the next filename
the harnesses disagree about repeats this exactly.

## Scope note

Affects every box running the codex engine — the symptom is silent until someone
reads a health check, since the procedure fails cleanly and the scheduler keeps
running.
