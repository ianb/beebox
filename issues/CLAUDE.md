# issues/

The idea and issue queue for the monorepo. Most items here are **tensions, not
resolutions** — half-thought-out design ideas, noticed problems whose right fix
isn't obvious, questions that need research before they're actionable. An item
being filed is *not* license to implement it: researching or designing an item
is real work on it; implementing it happens when Ian chooses it.

Something you can just fix, fix — don't file it. File when the thing you noticed
is outside your current work, or when the resolution is genuinely unsettled.

## Layout: category subdirectories

Open items live in one of seven **category subdirectories** (the category *is*
the directory — like `closed/` is the status, there is no `type:` field):

- **`bugs/`** — actual defects: wrong behavior, data loss, crashes, flakes.
- **`features/`** — new user/agent-facing capability.
- **`code-quality/`** — refactors, tech-debt, lint/type raises, tests, internal
  consistency. (Usually the largest bucket — mostly architectural-review fallout.)
- **`docs-and-chores/`** — documentation, process, and maintenance chores.
- **`decisions/`** — items whose deliverable is a *call to make*, not a build
  (unify-or-not, keep-or-drop, evaluate-and-decide).
- **`exploration/`** — not ready to implement: half-thought-out ideas,
  external-tool evaluations ("check out X"), research, agent-cognition tensions.
- **`watch/`** — not actionable now, and not by us. Each item names an
  **upstream/external trigger** and what to re-check when it fires (an upstream
  bug we work around, a missing capability in a dependency). Visit a watch item
  when its trigger lands — a dependency upgrade, a release note — not on a
  schedule and not by picking it off the queue. If you *can* act on it today it
  belongs in another category.

Each item is one file, `<category>/YYYY-MM-DD-<slug>.md` (date = when filed; slug
is the ID — pick a descriptive name). Before filing, grep the whole tree for
related slugs/words and extend a matching item rather than duplicating. Pick the
*dominant* category — a bug whose fix is a refactor is still a `bug`. Reclassify
by `git mv`-ing between category dirs (and fix any inbound links).

## Closed items

Closed items move to **`closed/<category>/`** with `git mv` — directory placement
is the status (open = a category dir, done = under `closed/`), and the category
is preserved. Closed items aren't interesting; git history is the archive, and
long-closed files can be deleted in periodic sweeps.

## Titles + cross-links

The **title lives in frontmatter** (`title:`), not an `# H1` — the body starts
straight into the tension. Cross-link related issues with relative markdown
links: same category → bare `<file>.md`; cross-category →
`../<category>/<file>.md` (e.g.
`[knip-exports](../code-quality/2026-07-04-knip-exports-enforcement.md)`). A doc
elsewhere links in as `…/issues/<category>/<file>.md`. Links to items that don't
exist yet are fine as plain text naming the idea. `doc-check` validates every
link, so moving/reclassifying an item breaks its inbound links — from other
issues AND from `docs/`.

**After moving ANY issue** (closing → `closed/`, reclassifying between category
dirs, or a rename), run **`pnpm --dir callback-box doc-check --fix`** — it
re-resolves every broken issue link by its (unique) basename and rewrites the
path to the file's new location, so you don't hand-edit inbound links. It heals
moves; a true rename or delete it reports as unfixable (fix those by hand). Issue
basenames must stay unique (`doc-check` hard-errors on a duplicate) — that's what
makes the auto-repair reliable.

**External URLs get a title too** — `[Orwell's six rules](https://…)`, not a bare
URL. A bare URL makes the reader parse a link to find out what it is. (The dev
docs renderer autolinks bare ones as a fallback, but that only makes them
clickable, not informative.)

## Frontmatter

`title:` and `workstream:` are required; everything else is optional — omit
what doesn't apply.

```yaml
---
title: "Short human title"    # required — the H1 replacement
workstream: unattached        # bare workstream name; unknown is backfill-only
needs: [design, decision]     # what must happen before this can be called done
design: ../../callback-box/docs/plans/foo.md   # link once a design/plan exists
area: callback-box            # callback-box | router | vibe-check | clerk | docs | ...
labels: [soft-launch]         # optional cross-cutting tags (kebab-case, multiple allowed)
priority: important           # important | normal | backlog; omitted is uncategorized
next-action: fixed            # reconfirm | duplicate | invalid | fixed; provisional agent task
filed-by: agent               # only for non-Ian items
discovered-by: Ian            # person or agent that first identified the issue
discovered-in: worktree-foo — while doing X    # workstream/context provenance
resolution: implemented       # closed/ only: implemented | wontfix | superseded
---
```

- `workstream:` records **ownership**: the bare name of the workstream that has
  taken responsibility for resolving the issue. Use `unattached` when no
  workstream owns it yet, including for out-of-scope work merely discovered
  while doing something else. `unknown` exists only for lost historical
  provenance and is never written for a new issue. When another workstream
  resolves an issue, `/finish` stamps the resolving workstream even if
  `manual-testing` keeps the issue open.
- `discovered-in:` records **provenance**: where the issue was noticed and what
  was happening. It does not assign the issue to that workstream.
  Its machine-readable prefix is the exact token `worktree-<bare-name>`,
  followed by a spaced em dash and the human context shown in the example.
  An issue can be discovered by one workstream and owned by another. It can also
  be discovered in a workstream while remaining `workstream: unattached` for
  later triage.
- `discovered-by:` records **attribution**: the person or agent that first
  identified or reported the issue. Use a human's preferred name when known,
  such as `Ian`, or `agent` when an agent independently found it. This differs
  from `filed-by:`, which records who created the issue file. An agent can file
  an issue that has `discovered-by: Ian` and `filed-by: agent`.

- `needs:` values: `design` (needs a design/plan written), `decision` (a fork
  only Ian can resolve), `manual-testing` (see below). Research-needed is
  signalled in the body instead — see below. `needs: [decision]` is
  **orthogonal** to the `decisions/` category: a *feature* can carry
  `needs: [decision]` and still live in `features/`; `decisions/` is only for
  items whose *whole deliverable* is the call.
- `needs: [manual-testing]` means **the code is written and ready to test, but an
  agent cannot finish verifying it — Ian has to exercise it himself.** Unlike the
  other two it's usually added *after* the code lands, not before: the work is
  written and tests pass, but the thing it actually fixes can only be confirmed by
  a human (on a phone, in a real browser, against live external credentials, over
  a real network, or by looking at whether it *feels* right). Add it rather than
  closing an item on green tests, and say in the body **what specifically to try
  and what should happen** — a year from now "needs testing" alone is useless. An
  agent should never remove this itself; only Ian clears it, by testing. Every
  flagged issue must use a `## Manual testing` section; the browser links to its
  stable `#manual-testing` anchor. `grep -rl "manual-testing" issues/` is the
  list of things waiting on him.
  - **Ready-to-test is the whole point — do NOT use it for an unfixed bug.** If no
    fix has landed (the item just describes a problem, or only proposes fix
    directions), it is *not* awaiting testing — it is awaiting a fix, so it gets
    **no** `needs` value (or `[design]`/`[decision]` if it genuinely needs those).
    A "verify on a real device" note in the body is guidance for *when* a fix
    lands, not license to pre-set the label. The list `grep -rl "manual-testing"`
    produces must be things Ian can actually pick up and test *today*; an unfixed
    bug in it wastes his time. Only add the label once the fix is committed.
  - **When the code has already landed** (the common case — the fix shipped and
    only a real-device / browser check remains), make that the item's *headline*:
    lead the body with a one-line status callout so "done except for the phone
    check" is visible at a glance, not buried in a `## Fixed in X` section partway
    down. A blockquote right after the frontmatter:
    `> **⏳ Awaiting manual testing** — fix landed in \`<commit>\`; <one line of
    what to try>. Only Ian clears this.` The reader (and Ian scanning the queue)
    should see the true status in the first line.
  - Persistent stock test1 content belongs on a clone branch named `keep`,
    rooted at the source test1's `origin/main`; select only intentional content
    onto it. A re-runnable but disposable scenario is snapshotted as
    `test-setup`, which blocks culling until confirmation deletes it. Link test
    instructions as `/<workstream>/test1/browse/<card-path>` before merge and
    `/main/test1/browse/<card-path>` after stock content lands.
- `labels:` is a freeform cross-cutting tag — an optional YAML list of
  kebab-case strings for grouping issues by effort/epic/theme/sprint, anything
  the six categories and the `area` field don't capture (multiple allowed). It's
  orthogonal to `category` (the directory) and `area`: e.g. `labels:
  [soft-launch]` marks every issue that belongs to the soft-launch effort
  regardless of which category dir it lives in. Deliberately generic — reach for
  it whenever a set of issues wants a shared handle. Browsable as a facet in the
  `workstreams/issues/` browser.
- `priority:` controls attention within the issue queue: `important` deserves
  prominent review, `normal` has been deliberately triaged as ordinary, and
  `backlog` is intentionally deprioritized. Omission means `uncategorized`: no
  priority decision has been made yet. `uncategorized` is a derived UI state,
  not an authored frontmatter value. The issue browser defaults to newest-filed
  order. Its priority sort groups important, normal, uncategorized, then backlog,
  with newest-filed order inside each group. All four states are filters.
- `next-action:` asks the next agent to verify a suspected outcome and apply it
  only when the evidence confirms it. It is separate from priority. The issue
  browser renders the values with question marks to keep their provisional
  meaning visible: `reconfirm` means reassess whether the issue is still live;
  `duplicate` means confirm that another issue owns the same work; `invalid`
  means confirm that the premise does not hold; and `fixed` means confirm that
  the reported behavior is already resolved. A matching tag is not permission
  to close blindly. Remove the field after acting on it or disproving it.
- `resolution:` is set when moving to `closed/`. Add a short closing note at the
  top of the body naming the resolving commit, plan doc, or reason.

## Body

State the tension: what was noticed, why the resolution isn't obvious, enough
context (including `file:line` pointers) to pick it up cold months later.

**Write in Simplified Technical English** (ASD-STE100, in spirit): short
sentences, active voice, one idea per sentence, consistent terminology, no
ambiguity. An issue is read cold — write for fast, unambiguous parsing over
style.

**For user-facing functionality, frame the goal as a Job To Be Done** before the
means. Use a job story: *"When [situation], I want to [motivation], so I can
[outcome]."* The point is not the syntax — it is to **situate the job in the real,
concrete situations the user is in**: their intention in that moment, where their
attention is, what capacity they have, and how the job fits into the interaction.
This often needs several situations, not one. Prefer concrete but mundane examples;
avoid stale clichés like booking a flight or a restaurant reservation. Skip it for
bugs, refactors, and "work robustly" tensions where JTBD is the wrong lens; don't
force it.

**Research** always goes in the body. If research is the next step, file the item
with a stub section:

```markdown
## Research (incomplete)
```

Whoever researches the item fills the section in and retitles it
`## Research (YYYY-MM-DD)`. So `grep -rl "## Research (incomplete)" issues/` lists
everything awaiting research, and researching an item is a first-class way to
advance it without implementing anything.

## Private issues (`private-issues/` — a SEPARATE repo)

This repo is source-available, so everything in `issues/` is world-readable.
Issues that can't be public live in a **separate, per-developer private repo**,
mounted (always as a gitignored symlink) at `<checkout>/private-issues/` with
the same category layout and file conventions as `issues/`.

**What goes where.** Private: anything about a person's own boxes or their
content, personal/operational tasks, server/infrastructure specifics, names or
identifiers of non-public people/domains, credentials-adjacent details — and
any issue whose *examples* need such details to be useful. Public: everything
about the code itself, reproducible with public context. **When unsure, ask
the developer before filing publicly** — "does this contain non-public
information?" is a human call. If a sanitized public version loses the
substance, split it: a sanitized public item plus a private item holding the
specifics (the private one links to the public one, never the reverse).

### Working directly on a real box: nothing lands public unvetted

When your task is **maintenance on, or debugging of, a developer's live box**
— their real content, not a `test1` clone — the default inverts. **Nothing you
learned there enters this repo until the developer has scrubbed and approved
it**: not an issue, not a commit message, not a code comment, not a test
fixture. Route the follow-up to `private-issues/` instead, or hold it and ask.

This is stricter than the general rule above because the failure is
asymmetric. Public-safe *code* findings are cheap to re-derive if you defer
them; a fragment of someone's personal content committed to a
source-available repo cannot be recalled — git history keeps it after the
file is fixed. So "I think this part is generic" is not the standard. The
developer's review is.

Structural facts are the exception that keeps this workable: command shapes,
file names and sizes, card *types*, counts, durations, timestamps, error
strings from our own code. That is nearly always enough to describe a
mechanism. If your write-up needs more than that to make sense, it belongs in
`private-issues/`.

**It is a different git repo.** Stage and commit private issues from INSIDE
`private-issues/`. An agent that edits a private issue and runs `git add -A`
at the monorepo root sees nothing staged — that is the leak guard working
(the mount is gitignored), not a bug.

**Links are one-way.** Private issues may link to public files
(`../callback-box/...` style paths resolve through the mount). Public files
must NEVER link into `private-issues/` — the link would dangle for anyone
without the private repo; `doc-check` hard-errors it. Name the private item
in prose (not a link) if a public file must gesture at it.

**Mechanics** (opt-in; nothing happens without it): `bin/private-issues init
<checkout>` creates the repo as a peer of the main checkout and symlinks it
into main; worktree creation auto-mounts a private worktree (branch
`worktree-<name>`, stored outside the public worktree so no cleanup can
destroy it); `/finish` lands the private branch on private `main` alongside
the public merge; unmerged private work survives any worktree removal as an
orphan that `bin/workstreams sweep` reports until resolved. Details:
`bin/CLAUDE.md` and `bin/private-issues help`. Private issues appear in the
dev issues browser (`/workstreams/issues/`) marked `private` — that page is
owner-session-gated.

## Taking on an issue (agents)

Before you start working an issue, **grep the queue for related and duplicate
items** — by the issue's slug, its keywords, the files/symbols it names, and the
symptom. A fix often resolves a sibling too, and there are frequently near-dupes
filed from different angles. Decide up front which of the cluster this work should
address *together* (fixing one and leaving its twin open is wasted future work),
and **list every issue in the cluster in the plan** (cb-plan's "Issues addressed"
header) so `/finish` knows the full set to reconcile — issues that aren't listed
are the ones that get forgotten.

## Filing (agents)

Filing is at your discretion — no thresholds or quotas. When you notice something
worth keeping that's outside your current task: check for an existing item, pick a
category, then file with `title:`, `workstream: unattached`, `filed-by: agent`,
`discovered-by:` (the actual source), and `discovered-in:` (your worktree and
what you were doing), and move on. Set
`workstream:` to the current workstream only when it has explicitly taken
responsibility for resolving the issue. Don't fix out-of-scope things in place,
and don't file trivia you'd be embarrassed to see triaged.
