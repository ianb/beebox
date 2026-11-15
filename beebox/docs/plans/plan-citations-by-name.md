---
title: "Code cites plans by name, so moving a plan never touches code"
status: draft
workstream: doc-move-references
issues:
  - ../../../issues/docs-and-chores/2026-11-10-plan-move-at-close-out-rewrites-source-comments.md
---
# Code cites plans by name, so moving a plan never touches code

Code comments cite plans by path (`docs/implemented-plans/secret-custody.md`). The path changes when finish moves a plan from `plans/` to `implemented-plans/`, so each close-out rewrites dozens of TypeScript files and reruns the full pre-commit typecheck. This plan makes comments in TypeScript and JavaScript cite a plan as `plan:<name>`, the plan's basename without `.md`, which does not change when the plan moves. doc-check enforces the form and converts existing paths with `--fix`, run once over the tree.

**Issues addressed:** `issues/docs-and-chores/2026-11-10-plan-move-at-close-out-rewrites-source-comments.md`. Builds on `beebox/docs/plans/doc-move-references.md` (same branch).

## Design

No design section: dev tooling and code comments only.

## Smallest fix and budget

Developer decision, 2026-11-15: of the three remedies in the issue (move the plan earlier, cite by a stable name, skip typecheck on comment-only diffs) the developer chose the stable name, and approved a one-time rewrite of existing citations ("A one off fixup of plan stuff is fine").

- Track 1, `beebox/src/dev/doc-check/plan-citations.ts` and its wiring in `check.ts`: find plan paths inside comments of `.ts`, `.tsx`, `.mts`, `.js`, `.mjs` files with the TypeScript scanner; report them, and with `--fix` rewrite them to `plan:<name>`; report a `plan:<name>` that names no plan; require plan basenames to be unique. About 150 lines, tests about 100.
- Track 2, `bin/lib/doc-move.ts`: a plan move that changes the basename rewrites `plan:<old>` to `plan:<new>`. About 20 lines, tests about 20.
- Track 3, the one-time conversion: `pnpm doc-check --fix`. Measured today: 1,752 plan-path occurrences in 1,290 code files, most of them TypeScript comments; the conversion is about 1,500 changed lines each way, about 3,000 in total. **BIG CHANGE** by count, approved; it is mechanical output of Track 1 and is reported separately.
- Docs: one rule in `beebox/code-style.md` and the finish agent note; about 10 lines.

## Stated preferences this plan trades against

- Minimize invented concepts (developer memory): the commit trailer `Plan: <name>` (`bin/commit-provenance.ts`) already names plans by bare basename. `plan:<name>` is the same identifier in a form a scanner can find without false matches; no registry or ID is added.
- Bias toward strict: the form is enforced by doc-check, which already fails the pre-commit hook; an unknown name fails too.
- Prior art (2026-10-19 close): `--fix` must not guess. Here the conversion is exact: a path is converted only when it ends in `plans/<name>.md`, `implemented-plans/` or `unimplemented-plans/`, and `<name>` is exactly one plan file. Basename uniqueness is enforced, not assumed.

## What already exists

- `findMovedPathMentions`, `beebox/src/dev/doc-check/file-paths.ts:212`: scans code with a line regex, comments and strings alike. Reuse its `MENTION_RE` token shape; the new scan restricts tokens to comment ranges.
- `mentionSourceFiles`, `beebox/src/dev/doc-check/check.ts:91`, excludes tests from `--fix` because that repair guesses by basename. The new conversion does not guess, so it includes tests.
- `issuesUniquenessProblems`, `check.ts:151`: the pattern for the new plan-basename uniqueness check. Today 438 plan files have no duplicate basename (checked with `git ls-files` and `uniq -d`).
- TypeScript is a beebox dependency (`beebox/package.json:150`); `ts.createScanner` gives comment ranges without parsing.

## Prior art (external)

No decision depends on an external premise.

## Ontology

- **Plan file**: a tracked `.md` file directly in `beebox/docs/plans/`, `implemented-plans/`, or `unimplemented-plans/`, other than `README.md`. Exists (`file-paths.ts` `LIFECYCLE_RE`).
- **Plan name**: the plan file's basename without `.md` (`secret-custody`, `doc-move-references.review`). Exists as the `Plan:` commit trailer value.
- **Plan citation**: new. `plan:<name>` in a code comment. Not a path; never rewritten by a move unless the name changes.

## Tracks / scope

### Track 1 — doc-check finds plan paths in code comments

- **Direction:** `planCitationProblems({ rel, content, plans })` where `plans: Map<name, path>`. Comment ranges come from `ts.createScanner(ts.ScriptTarget.Latest, false, languageVariant)` (JSX for `.tsx`). In each comment, a token matching `MENTION_RE` whose path ends in `(implemented-|unimplemented-)?plans/<name>.md` (optional `:L` suffix dropped) with `<name>` in `plans` is a problem, fixed to `plan:<name>`. A `plan:<name>` whose name is not in `plans` is an unfixable problem. Strings and template literals are untouched: test fixtures and runtime paths stay paths. Problem text: `plan path in a code comment: <file>:<line> \`<token>\` -> \`plan:<name>\` (pnpm doc-check --fix rewrites it)`.
- Plan-basename duplicates fail doc-check (`duplicate plan basename`).
- **Vocabulary lock-in:** `plan:<name>`.

### Track 2 — a plan rename rewrites its citations

- **Direction:** in `planDocMove`, when `from` is a plan file and the basename changes, replace `plan:<old>` (bounded: not followed by a name character) with `plan:<new>` in code sources, as rewrite kind `name`.

### Track 3 — convert once

Run `pnpm doc-check --fix`, review a sample, commit it alone so the diff is mechanical.

## Could this be simpler?

Simplest: stop rewriting code at move time and let comments keep the old directory. Comments would then claim a plan is in `plans/` after it shipped, and doc-check's moved-path check would fail them. Simpler still: convert once with `sed` and add no check. New comments would cite paths again within days; agents copy the form they read, and the issue was reported three times. The scanner restriction to comments is what lets the conversion skip test fixture strings, which are data.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A plan path inside a string is converted | Planned | Comment ranges only | Clear (test) |
| A cited name has no plan (typo, deleted plan) | Planned | doc-check problem | Clear |
| Two plan files share a basename | Planned | doc-check problem | Clear |
| A plan rename leaves `plan:<old>` | Planned | Track 2 rewrites it; doc-check catches any miss | Clear |
| A `.tsx` comment inside JSX is missed | Planned | JSX language variant | Clear (test) |

## Agent-flow / user-flow edge cases

- Wrong form: an agent writes the path. ADDRESSED: doc-check fails with the exact `plan:<name>` and `--fix`.
- Stale ref: the plan is deleted. ADDRESSED: unknown-name problem.
- Hand-edit drift: `plan: secret-custody` (space). Not matched as a citation and not a path; it reads as prose. Accepted.
- Finding the file from a name: `git ls-files '*/<name>.md'`, or the editor's file finder by basename.

## NOT in scope

- Issue paths in code (89 files): issues move at close too, but the developer approved plan citations; issues can follow the same form later.
- Swift, shell, YAML, and Markdown: they do not trigger the TypeScript typecheck, and YAML schedule prompts need a path an agent can open.
- Skipping typecheck on comment-only diffs: with this change a plan move no longer edits code comments.

## Open design questions

none

## Knowledge audits

None for boxes. The dev rule goes in `beebox/code-style.md`; the doc-check message teaches it at the point of use.

## What will hold this after it ships

`beebox/test/dev/doc-check/plan-citations.test.ts`: comment vs string vs template literal, JSX comment, `:L` suffix, unknown name, duplicate basename. `bin/test/lib/doc-move.test.ts`: plan rename rewrites `plan:<old>`. doc-check in the pre-commit hook holds the form.

## Implementation order

1. Track 1 with tests. Commit.
2. Track 2 with a test. Commit.
3. Track 3: `pnpm doc-check --fix`; commit the conversion alone.
4. Docs; cross-model review of the branch.

## Rollout shape

Done when the tests above pass, `pnpm doc-check` passes on the converted tree, and a dry-run move of a cited plan (`bin/doc-move --dry-run beebox/docs/plans/<plan>.md beebox/docs/implemented-plans/`) lists no `.ts` or `.tsx` file.
