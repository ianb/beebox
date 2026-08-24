# issues/

The idea and issue queue for the monorepo. Most items here are **tensions, not
resolutions** — half-thought-out design ideas, noticed problems whose right fix
isn't obvious, questions that need research before they're actionable. An item
being filed is *not* license to implement it: researching or designing an item
is real work on it; implementing it happens when the developer chooses it.

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
is the ID — pick a descriptive name). Before filing, search the whole tree —
`bin/issues search --all "<symptom or idea>"` (hybrid keyword + semantic; see
`bin/CLAUDE.md`) plus a grep for the file/symbol names — and extend a matching
item rather than duplicating. Pick the
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
next-action: discuss          # discuss | reconfirm | duplicate | invalid | fixed | manually-confirmed | verify-without-me
filed-by: agent               # omit when the developer filed it
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

**Don't use the developer's name in prose.** Those two frontmatter fields are
the good reason to write it: a name is *data* there — the record of who found
or authored something, the same way a commit has an author. Everywhere else,
say **"the developer"** (or "the boxholder" in callback-box docs, matching the
surrounding register). It reads as a role because it *is* a role: this is how
any developer talks back to an agent, and the guidance holds whoever is sitting
there.

The failure is easy to fall into, because the person you are talking to is
right there and naming them feels precise. It isn't — it bakes one person into
text that describes a general relationship, in a source-available repo. If a
sentence still makes sense with "the developer" substituted in, it should have
said that. This restates the broader rule in `callback-box/CLAUDE.md` ("Keep
source and docs generic — never hardcode personal names"), which applies to
agent-facing docs and skills as much as to shipped source.

- `needs:` values: `design` (needs a design/plan written), `decision` (a fork
  only the developer can resolve), `manual-testing` (see below). Research-needed is
  signalled in the body instead — see below. `needs: [decision]` is
  **orthogonal** to the `decisions/` category: a *feature* can carry
  `needs: [decision]` and still live in `features/`; `decisions/` is only for
  items whose *whole deliverable* is the call.
  `needs: [decision]` is a standing property: the issue cannot be completed
  without the developer choosing a direction. `next-action: discuss` is a removable queue
  signal that discussion is the next step. An issue can carry both when both
  facts matter.
- `needs: [manual-testing]` means **the code is written and ready to test, but an
  agent cannot finish verifying it — the developer has to exercise it themselves.** Unlike the
  other two it's usually added *after* the code lands, not before: the work is
  written and tests pass, but the thing it actually fixes can only be confirmed by
  a human (on a phone, in a real browser, against live external credentials, over
  a real network, or by looking at whether it *feels* right). Add it rather than
  closing an item on green tests, and say in the body **what specifically to try
  and what should happen** — a year from now "needs testing" alone is useless. An
  agent should never remove this itself; only the developer clears it, by testing. Every
  flagged issue must use a `## Manual testing` section; the browser links to its
  stable `#manual-testing` anchor. `grep -rl "manual-testing" issues/` is the
  list of things waiting on them.
  - **Ready-to-test is the whole point — do NOT use it for an unfixed bug.** If no
    fix has landed (the item just describes a problem, or only proposes fix
    directions), it is *not* awaiting testing — it is awaiting a fix, so it gets
    **no** `needs` value (or `[design]`/`[decision]` if it genuinely needs those).
    A "verify on a real device" note in the body is guidance for *when* a fix
    lands, not license to pre-set the label. The list `grep -rl "manual-testing"`
    produces must be things the developer can actually pick up and test *today*; an unfixed
    bug in it wastes their time. Only add the label once the fix is committed.
  - **When the code has already landed** (the common case — the fix shipped and
    only a real-device / browser check remains), make that the item's *headline*:
    lead the body with a one-line status callout so "done except for the phone
    check" is visible at a glance, not buried in a `## Fixed in X` section partway
    down. A blockquote right after the frontmatter:
    `> **⏳ Awaiting manual testing** — fix landed in \`<commit>\`; <one line of
    what to try>. Only the developer clears this.` The reader (and the developer scanning the queue)
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
  **Agents do not set this field.** Priority is the developer's attention budget, and an
  agent guessing at it produces a queue that looks triaged when it isn't —
  `backlog` in particular buries an item nobody decided to bury. Omit the field
  unless the developer has indicated a priority in the request; `uncategorized` is the
  honest state for a freshly filed issue and is a filter they can work through.
  Write the field only when they say what it is, or when they ask you to record a
  priority they have already given.
- `next-action:` says what should happen next before the issue leaves the queue.
  It is separate from priority.

  **This field is the developer's, and it is how they hand an idea back to an agent.** They
  read the queue, form a suspicion about an item, and write it here for
  whoever picks it up next — so in practice they set every value, and an agent's
  job is to answer the tag rather than to write one. (The `discuss` carve-out
  below is the sole exception, and it is deliberately narrow.) Reading a tag as
  a peer's note misses the point: it is the boxholder thinking out loud at the
  one moment they had the whole queue in view, addressed to you.

  `discuss` means bring the issue to the developer for discussion;
  do not start implementing it. The provisional values ask the next agent to
  verify a suspected outcome and apply it only when the evidence confirms it.
  The issue browser renders those values with question marks to keep their
  provisional meaning visible: `reconfirm` means reassess whether the issue is
  still live; `duplicate` means confirm that another issue owns the same work;
  `invalid` means confirm that the premise does not hold; and `fixed` means
  confirm that the reported behavior is already resolved. A matching tag is not
  permission to close blindly. Remove the field after acting on it or disproving
  it; remove `discuss` after the discussion produces a disposition.
- `next-action: manually-confirmed` is authoritative, not provisional. It means
  the developer personally confirmed that the fix applies. Read the issue once
  to ensure the confirmation covers the whole item, then close it as
  `implemented` without repeating the manual check. If the issue carries
  `needs: [manual-testing]`, this tag is the developer's explicit clearance to
  remove that gate as part of closing the issue.
- `next-action: verify-without-me` applies to `needs: [manual-testing]` items.
  It says the human gate is not going to close — they cannot reproduce the failure on demand, or the test is not
  worth their time — so stop waiting on it and settle the issue on whatever
  evidence is reachable without them.

  The agent's job is then: verify everything code, tests, and a simulator *can*
  establish, and then dispose of the issue. Close it when the evidence carries
  it, naming what remains unverified and why that is acceptable. Otherwise
  remove `manual-testing` and record precisely what ships unchecked — an
  honest "unverified, here is the residual risk" beats an item parked forever
  on a test nobody will run.

  **It is not an instruction to close.** An audit under this tag can find work
  that was never built, and that is a live issue needing implementation, not a
  missing test. Say so and leave it open for the work. It is also worth
  separating "genuinely impossible without a device" from "nobody has run it" —
  the second is often fixable here.

  Removing the field is not enough on its own: an item that leaves
  `grep -rl "manual-testing" issues/` must leave it because it was settled, so
  that list stays a queue the developer can work rather than a graveyard.
  Agents may set `discuss` when work reaches a genuine human judgment call, but
  must summarize the tension in the issue rather than using the tag as a vague
  escalation.
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

## Re-encountering an issue

Meeting an already-filed problem again — the same bug in a new session, a user
report matching an open item, a symptom found while fixing something else — is
evidence, and the issue should record it. Add a dated line to the body (where
it was seen, in what conditions), then apply whichever of these holds:

- **`needs: [manual-testing]` + re-encountered → it is not fixed.** The label
  means "code landed, only a human check remains"; a fresh sighting *is* that
  check, failed. Remove `manual-testing`, keep the `## Manual testing` section
  as history, note the re-encounter as the headline, and treat the item as an
  open bug again (this is the one case where an agent removes the label —
  the developer's gate is for confirming a fix, not for a fix that visibly
  didn't hold).
- **`priority: backlog` or `normal` + re-encountered → the priority may be
  stale.** Do not change it (agents never set `priority:`); note the sighting
  in the body with a one-line "re-encountered on <date>, priority may be
  stale". If the issue carries no `next-action:`, set `next-action: discuss`
  so the developer sees it; if it already carries one, leave that tag alone —
  it is the developer's requested disposition, and the body note is enough.
  `important` needs no note.
- **Closed + re-encountered → reopen**, unless what you saw is genuinely a
  different defect: `git mv` back out of `closed/`, drop `resolution:`, and
  record what the original fix missed. A duplicate of a closed issue is only
  closed if the closed one's fix is still in place.

## Taking on an issue (agents)

Before you start working an issue, **search the queue for related and
duplicate items** — `bin/issues similar <path> --all` (semantic; add `--docs`
to include plans/design docs as prior art), then grep by the issue's slug,
its keywords, the files/symbols it names, and the symptom. A fix often resolves a sibling too, and there are frequently near-dupes
filed from different angles. Decide up front which of the cluster this work should
address *together* (fixing one and leaving its twin open is wasted future work),
and **list every issue in the cluster in the plan** (cb-plan's "Issues addressed"
header) so `/finish` knows the full set to reconcile — issues that aren't listed
are the ones that get forgotten.

## Filing (agents)

Filing is at your discretion — no thresholds or quotas. When you notice something
worth keeping that's outside your current task: check for an existing item
(`bin/issues search --all "<what you saw>"`; a hit that already describes it —
open or closed — is amended or reopened per "Re-encountering an issue" above,
not duplicated), pick a category, then file with `title:`, `workstream: unattached`, `filed-by: agent`,
`discovered-by:` (the actual source), and `discovered-in:` (your worktree and
what you were doing), and move on. Leave `priority:` off — see above; it is
the developer's call, not yours. Set
`workstream:` to the current workstream only when it has explicitly taken
responsibility for resolving the issue. Don't fix out-of-scope things in place,
and don't file trivia you'd be embarrassed to see triaged. Set `next-action:
discuss` only when the issue describes a concrete judgment the developer must make next;
the tag is not a substitute for explaining the decision in the body.
