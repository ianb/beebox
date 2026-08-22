---
title: "`AGENTS.md` is missing from the places that special-case `CLAUDE.md` — refresh-maps fails forever on every codex box"
workstream: agents-md-pairing
area: callback-box
labels: [codex, maps, procedures]
priority: important
resolution: implemented
filed-by: agent
discovered-by: Ian
discovered-in: main session — diagnosing a daily refresh-maps failure on a codex-engine box
---

**Closed — implemented.** `META_FILES` now covers both instruction filenames,
so the precheck stops demanding a MAP describe a symlink to the file excluded
beside it. Two further defects found while adjudicating the site list are fixed
in the same change, and `config/box.json` is settled. Details below the fold.

**Scope was wider than filed: this affected every box, not only codex boxes.**
`generateAgentContextMirrors` is called unconditionally from
`ensureAgentContext` (`core/docs-gen/claude-md.ts`), so a box with no
`agentEngine` set gets the mirrors too. Reproduced on a claude-engine box clone:
`AGENTS.md` appeared in every directory listing, and a `docs/` directory listed
nothing else at all.

**Adjudication of the 15 sites — 3 needed work, 12 were already right.**

| Site | Verdict |
| --- | --- |
| `core/maps/precheck-ignore.ts:81` | **Bug.** Fixed. |
| `core/maps/finalize.ts:93` | **Second live bug.** It creates `<dir>/CLAUDE.md` and nothing planted the mirror, so a newly-mapped directory stayed invisible to Codex until the next `generate-docs`. Self-healing, therefore silent. Now links the file it just created, via a narrow `ensureAgentsMirror(claudePath)`. |
| `core/sdk-hooks.ts:90` | **Drift.** A hand-rolled subset of `isBuiltinLintableMarkdown`, which documents itself as the single source of truth "so every entry point agrees". It missed `AGENTS.md`, `docs/generated/`, and the skip-dirs; the codex-side hook (`cb validate --hook`) already routed through the real predicate. Deleted in favour of it — a deliberate broadening, not a no-op. |
| `codex-run.ts:62`, `codex-chat.ts:49`, `agent-context.ts:17` | Correct. They expand includes from the canonical file; `AGENTS.md` is a symlink to it. No second bug hid in the codex paths. |
| `box/package.ts:249`, `docs-gen/claude-md.ts:27`, `claude-md-lint.ts:46,102` | Correct. Canonical write / canonical find — mirroring here would double-write or double-report. |
| `doc-graph-data.ts:67`, `doc-graph-html-data.ts:258,281`, `doc-link-repair.ts:18` | Correct. The doc graph excludes `AGENTS.md` at the walk (`EXCLUDE_PATTERNS`), so nothing downstream can see one; basename repair cannot mis-resolve to a file that never enters the index. |
| `dev/lib/context-layers.ts:65,83,103` | Correct content; the layer *label* still reads "CLAUDE.md" on a codex box. Cosmetic, left alone. |

The site list read scarier than it was because it mixed two mechanisms: the
monorepo's own `AGENTS.md` files are gitignored generated *regular files* from
`bin/generate-agents-md.ts`, not the box's tracked symlinks. Every `dev/` site
lives in that world.

**`config/box.json`** → `SKELETON_HIDDEN_PATHS` (exact-path entry). It is
machine-owned — the admin UI and the invite-accept path rewrite it — and its
fields are already in `docs/box-layout.md`, so a per-box MAP bullet would only
go stale. Not `META_FILES`: that is a bare-basename match at any depth and would
also hide a `box.json` a boxholder created elsewhere. Note this does not rewrite
MAPs that already mention the file; a stale bullet is cosmetic and clears the
next time that directory's listing changes.

**No structural guard was built, deliberately.** The filed suggestion was a
derived constant or a lint rule so a bare `"CLAUDE.md"` literal becomes the
smell. The boxholder's call (2026-08-22): the filename set is expected to stay
at these two — `AGENTS.md` being the more general standard — so the drift being
guarded against is narrower than it looked, and a lint rule is not worth its
cost. Instead the two names live in `core/agent-instruction-files.ts`
(`CLAUDE_MD`, `AGENTS_MD`, `AGENT_INSTRUCTION_FILES`, `isAgentInstructionsFile`)
and every site that has to *recognize either name* imports from there. Sites
that mean the authored file alone keep their literal; the asymmetry is real and
the code should show it.

**Verification.** A doctest in `test/core/maps/maps-precheck.doctest.md` pins
both listing paths against a real symlink — `listChildrenOnDisk` and
`listChildrenAtCommit` classify it differently, and the git-side half is set up
so the mirror appears *between* the recorded state and HEAD, since anything else
asserts nothing. Both halves fail with the fix reverted. `maps-finalize` pins
the new mirror. Full suite green.

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
