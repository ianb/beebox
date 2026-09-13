# issues/

The monorepo issue queue holds unresolved tensions: bugs, ideas, design choices,
research, and maintenance that should survive the current session. Filing an
item does not authorize implementation; researching or designing it is real
work that can advance it without implementation. Fix a small in-scope
problem directly; file work that is out of scope or whose resolution is not yet
clear.

## Private issues (`private-issues/` — a SEPARATE repo)

Choose public or private before creating a file. This repository is
source-available, so everything under `issues/` is public.

Use the separate per-developer `private-issues/` repository for personal box
content, operational tasks, private infrastructure, non-public people or
domains, credentials-adjacent details, or examples that need those facts to be
useful. Public issues describe the code with public, reproducible context. If
unsure, ask the developer before filing publicly. If sanitizing loses the
substance, create a sanitized public issue and a private companion; the private
file may link to the public one, but public files must never link into
`private-issues/` (`doc-check` rejects this).

For maintenance or debugging on a developer's real content (not a `test1`
clone), nothing learned there
enters the public repository until the developer has scrubbed and approved it.
This includes issue text, commit messages, comments, and fixtures. Until then,
use `private-issues/` or hold the finding and ask. Structural facts such as
command shapes, file names and sizes, card types, counts, durations,
timestamps, and errors emitted by our code are safe when they reveal no private
content. If those facts are insufficient, keep the item private.

`private-issues/` is a different Git repository mounted through a gitignored
symlink. Stage and commit from inside it: `git add -A` at the monorepo root
stages none of its contents because the mount is gitignored; that is the leak
guard working. `bin/private-issues init <checkout>`
creates the peer repository and mount; worktree creation mounts a corresponding
private branch. `/finish` lands its branch with the public workstream, while
unmerged private work survives worktree cleanup and is reported by
`bin/workstreams sweep`. See `bin/private-issues help` and `bin/CLAUDE.md`.
Private issues appear in the owner-session-gated issues browser marked
`private`.

## Layout: category subdirectories

Open items live at `<category>/YYYY-MM-DD-<slug>.md`; the directory is the
category and the date is the filing date. There is no `type:` field.

- `bugs/` — defects, crashes, data loss, and flakes.
- `features/` — new user-facing or agent-facing capability.
- `code-quality/` — refactors, debt, lint or type improvements, tests, and
  internal consistency.
- `docs-and-chores/` — documentation, process, and maintenance.
- `decisions/` — the deliverable is a decision rather than an implementation.
- `exploration/` — early ideas, external-tool evaluations, research, and
  agent-cognition tensions that are not ready to implement.
- `watch/` — an external or upstream trigger must occur before action. Each
  issue names the trigger and what to re-check. Do not pick these from the
  ordinary queue or schedule periodic checks; move actionable work elsewhere.

Choose the dominant category: a bug whose likely fix is a refactor remains a
bug. Reclassify with `git mv`.

## Frontmatter

Every issue requires `title:` and `workstream:`. The schema is closed; the
following keys are the complete vocabulary (plus the deferred-only keys below):

```yaml
---
title: "Short human title"
workstream: unattached
needs: [design, decision]
design: ../../beebox/docs/plans/foo.md
area: beebox
labels: [soft-launch]
priority: important
next-action: discuss
filed-by: agent
discovered-by: Ian
discovered-in: worktree-foo — while doing X
resolution: implemented
---
```

Unknown keys are reported by
`workstreams-app/src/server/issue-domain.ts`; adding a real field requires
updating both this contract and `KNOWN_FRONTMATTER_KEYS` there.

### Identity and grouping

- `title:` replaces an H1; the body starts with the tension.
- `workstream:` is ownership. Use a bare workstream name only after that
  workstream accepts responsibility; otherwise use `unattached`. `unknown` is
  historical backfill only. `/finish` records the resolving workstream even
  when `manual-testing` keeps the issue open.
- `discovered-in:` is provenance, never ownership. Use
  `worktree-<bare-name> — <context>`. A finding can remain
  `workstream: unattached`.
- `discovered-by:` names who first identified the issue; `filed-by:` names who
  created the file; omit `filed-by` when the developer filed it. Use the
  person's preferred name when known or `agent` for
  an agent-originated finding.
- `area:` identifies the owning product area (e.g. `beebox`, `router`,
  `vibe-check`, `clerk`, `docs`). `labels:` is an optional list of
  kebab-case cross-cutting group names; use it instead of inventing schema
  fields. Category, area, and labels are independent; labels are a facet in the
  `workstreams/issues/` browser.
- `design:` links the applicable plan.

Names belong in authorship metadata because they are data. In prose use “the
developer” (or “the boxholder” in Bee Box documentation), never a personal
name.

### Human-owned signals

- `priority:` is `important`, `normal`, or `backlog`; omission appears as the
  derived `uncategorized` state. Agents never set or change priority unless the
  developer explicitly supplies it. The browser sorts important, normal,
  uncategorized, then backlog, newest first within each group; all four states
  are filters and newest-filed is the default order.
- `needs:` may contain `design`, `decision`, or `manual-testing`. `design`
  requires a plan; `decision` requires the developer to choose. These are
  standing properties and are independent of the `decisions/` category.
  Research state belongs in the body, not `needs:`. An issue may carry both
  `needs: [decision]` and `next-action: discuss`: one is a standing gate and the
  other is the current queue action.
- `next-action:` is a removable request from the developer. Values are
  `discuss`, `reconfirm`, `duplicate`, `invalid`, `fixed`,
  `manually-confirmed`, and `verify-without-me`. Agents normally answer these
  values rather than set them; the narrow exception is `discuss` when work
  reaches a concrete human judgment call. Explain that call in the body.

`discuss` means surface the decision and do not implement. `reconfirm`,
`duplicate`, `invalid`, and `fixed` are provisional hypotheses, not permission
to close blindly. Verify them, act on the evidence, and remove the field after
acting or disproving it. Remove `discuss` after the conversation produces a
disposition.

`manually-confirmed` is authoritative: the developer confirmed the fix. Read
the issue to ensure the confirmation covers its full scope, then close it as
`implemented`. It explicitly authorizes removing a `manual-testing` gate while
closing.

`verify-without-me` releases a `manual-testing` gate the developer cannot or
will not exercise. Verify everything available through code, tests, browser,
and simulator. Close only if that evidence carries the claim, naming the
remaining uncertainty; otherwise remove `manual-testing`, leave the issue open,
and record the concrete residual risk. It is not an instruction to close or to
pretend unbuilt work is merely untested. Distinguish evidence that truly needs a
device from a check nobody has run yet.

### Manual-testing lifecycle

`needs: [manual-testing]` means the fix is committed and ready for the developer
to test, but an agent cannot complete the real-device, real-browser,
live-credential, real-network, or human-eye verification. Never add it to an
unfixed issue. State exactly what to try and the expected result under the
literal heading:

```markdown
## Manual testing
```

The browser and `bin/confirm-tested` depend on that stable heading.
`bin/issues list --needs manual-testing` lists the waiting items. When the
fix has landed, put this status directly after frontmatter:

```markdown
> **⏳ Awaiting manual testing** — fix landed in `<commit>`; <what to try>. Only the developer clears this.
```

The developer clears this gate after a successful test, either directly or
through `next-action: manually-confirmed`. Agents remove it only through two
explicit transitions: a fresh re-encounter proves the fix failed, or
`verify-without-me` releases the human gate for an evidence-based disposition.

Persistent stock `test1` content belongs on a clone branch named `keep`, rooted at the
source test1's `origin/main`; select only intentional content onto it. Snapshot
a reusable but disposable scenario as `test-setup`, which prevents culling
until confirmation deletes it. Link test instructions as
`/<workstream>/test1/browse/<card-path>` before merge and
`/main/test1/browse/<card-path>` after stock content lands.

## Body

State what was observed, why resolution is not obvious, and enough context and
`file:line` pointers to resume cold. Use Simplified Technical English (ASD-STE100, in spirit): short, active,
unambiguous sentences, one idea per sentence, and consistent terminology.
For user-facing features, use a Job To Be Done when the user's situation,
motivation, and outcome affect the design; do not force it for bugs, refactors,
or generic robustness work.

Research always stays in the body. Pending research uses the exact sentinel:

```markdown
## Research (incomplete)
```

When completed, rename it to `## Research (YYYY-MM-DD)`. These headings drive
`bin/issues list --research awaiting` and researched-state detection.

## Titles + cross-links

Link related issues with relative Markdown links: a bare filename within one
category, `../<category>/<file>.md` across categories, and a full relative path
from docs. Give external URLs descriptive link text. Plain text may name an
issue that does not exist yet.

Issue basenames must be unique across the tree; duplicates fail doc-check.
After any move, close,
reclassification, or rename, run `pnpm --dir beebox doc-check --fix`; it repairs
inbound links for moved files by unique basename and reports true renames,
deletions, or ambiguity for manual repair.

## Deferred items

Known-date work lives in flat `deferred/` with its ordinary filing-date name and
two required, deferred-only fields:

```yaml
activate-on: 2026-09-07
category: code-quality
```

The hourly `deferred-issues` schedule activates due files, removes both fields,
repairs links, and commits the move; a missed tick catches up later. Deferred
items are excluded from normal lists, searches, and automatic picking but
remain directly addressable. Their links and unique basenames remain enforced.

## Closed items

Close with `git mv` into `closed/<category>/`, preserving the category. Add
`resolution: implemented`, `wontfix`, or `superseded`, plus a short opening note
naming the resolving commit, plan, or reason. Open issues must not carry
`resolution:`. Git history is the archive; periodic maintenance may delete
long-closed files.

## Re-encountering an issue

A repeated symptom or report is new evidence. Add a dated body note stating
where and under what conditions it appeared, then apply the matching transition:

- An issue awaiting manual testing is not fixed if the reported behavior recurs.
  Remove `manual-testing`, keep its section as history, make the re-encounter the
  opening status, and treat it as an open bug. This is the explicit agent-removal
  exception to the human-owned gate.
- For `priority: normal` or `backlog`, do not change priority. Note that the
  priority may be stale and, if no `next-action:` exists, set `discuss` so the
  developer sees it. Preserve any existing next action. `important` needs no
  priority note.
- Reopen a closed issue with `git mv`, remove `resolution:`, and record what the
  previous fix missed. Keep a new report separate only when it is a different
  defect. A duplicate of a closed issue is only closed if the closed one's fix
  is still in place.

## Taking on an issue (agents)

Before starting, make one bounded duplicate and ownership check: read the
issue's links and `workstream:`, then run `bin/issues similar <path> --all`.
Do not turn one chosen issue into a queue-wide survey by default. Expand into
the full cluster workflow in `bbx-pick-issues` only when the issue links
siblings, the initial results show a plausible shared mechanism, or the
developer asked for a cluster. Then inspect relevant code and search by slug,
symbols, paths, and symptom; add `--docs` when plans or design docs are useful
prior art. Choose related work without expanding the developer's approved
scope.

Record every issue actually addressed in the plan's “Issues addressed” header
when a plan exists; otherwise retain the paths in the workstream briefing or
handoff so `/finish` can reconcile them.

## Filing (agents)

Before filing, make the public/private decision above, then run
`bin/issues search --all "<what you saw>"` and search relevant symbols or paths.
A matching open or closed issue is a re-encounter: amend or reopen it rather
than creating a duplicate.

For a new item, choose the dominant category and write
`YYYY-MM-DD-<descriptive-slug>.md` with `title:`, `workstream: unattached`,
`filed-by: agent`, accurate `discovered-by:`, and
`discovered-in: worktree-<name> — <context>`. Omit `priority:` unless the
developer supplied it. Assign the current workstream only when it explicitly
accepted responsibility. Use `next-action: discuss` only for a concrete human
decision explained in the body. Do not fix the out-of-scope work while filing,
and do not file trivia.
