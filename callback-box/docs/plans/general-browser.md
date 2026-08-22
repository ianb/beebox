---
title: "One browser: artifacts, docs, code, plans, and exhibits in one place"
status: active
workstream: dev-comments
issues:
  - ../../../issues/docs-and-chores/2026-08-22-exhibits-doc-overstates-container-chrome.md
---

# One browser

A single reading surface in the workstreams app for everything the developer
reads about the work: repository markdown, source code, dev artifacts, plans,
issues, and an index of exhibits. It replaces a set of surfaces that grew
separately and are, in the boxholder's words, *"confusing and hard for me to
find things"* in.

This plan is a dependency of `document-comments.md`. Comments attach to whatever
this browser renders; the browser is useful without them.

## Job to be done

*When I want to look at something about the work — a plan an agent wrote, the
code it changed, a screenshot it produced, a scratch note it left — I want one
place to go and one way to find it, so that finding the thing is not itself the
task.*

*When I am reading a source file, I want to see that two workstreams have
changed it out from under me, so I learn that from the file rather than from a
merge conflict.*

The second situation sets the browser's structure. The unit is the **file**, and
a workstream is a lens over it — never a partition you enter first.

The failure this addresses is not that any one surface is bad. It is that they
are reached differently, they overlap, and none of them holds code:

- `/<worktree>/dev/` — the artifact manifest (`bin/router-docs.ts:303-331`).
- `/<worktree>/dev/docs/` — every `.md` in the worktree, with a grouped sidebar
  and quick-open (`:434-442`, `:519`).
- `/<worktree>/dev/<subdir>/` — directory indexes (`:788`).
- `/workstreams/plans` — a list in the app that links *out* to the doc browser
  to be read (`PlansPage.tsx:9`), and which lists only the **main checkout's**
  plan directories (`documents-service.ts:149-152`), so a plan written in a
  worktree does not appear at all until it merges.
- The exhibits origin — a separate port with a separate credential.

Nothing browses source code at all.

**One surface is already right, and this plan copies it rather than replacing
it.** `/workstreams/issues` is universal across workstreams, filtered by search
params, with the selected item as state rather than a route
(`IssuesPage.tsx:10`, `router.tsx:15-37`). It is the shape the rest should have
had; see The addressing rule.

## Issues addressed

None resolved outright. Related, and worth reading before designing:

- `issues/features/2026-07-28-directories-as-viewable-things.md` — the same
  "a directory should be a viewable thing" instinct, aimed at the **box**'s
  `browse/` surface rather than the dev repo. Different tree, same shape of
  question; the vocabularies should not contradict each other.
- `issues/features/2026-08-12-structured-module-docs-and-code-search.md` — a
  searchable structured description per module. If that ships, it is the natural
  index for this browser's code half. Not a dependency in either direction.
- `issues/features/2026-07-08-selection-provenance-canonical-anchors.md` — the
  standing thinking on anchors, which Track 4 extends with a `file:` source type.

## Stated preferences this plan trades against

- `callback-box/docs/engineering-principles.md` — **3** (validate at
  boundaries), **4** (resilient AND never silent), **7** (hierarchy is a
  discoverability contract), **8** (one way to do each thing), **12** (the
  maintainer is usually an agent).
- Principle **8** is the spine of this plan: several reading surfaces for one job
  is the violation, and consolidating them onto the pattern the issues browser
  already uses is the fix.
- `CLAUDE.md` (monorepo root) — the dev-page casualness carve-out applies to
  *pages*, not to app code. Everything here is workstreams-app code and is
  linted and typechecked.
- **Boxholder posture, 2026-08-22:** consolidation is wanted even where it
  removes working affordances — *"making some of the eclectic affordances in the
  workstreams-app redundant (doc browser, artifacts, scratch, etc). Which is
  good."* A plan that preserves every existing surface to avoid churn has
  misread the ask.

## What already exists

| Thing | Where | Reuse or rebuild |
|---|---|---|
| Markdown rendering to React | `workstreams-app/src/frontend/components/Markdown.tsx:28` | **Reuse.** |
| In-app document reading | `workstreams-app/src/frontend/components/IssuesPane.tsx:97` | **Reuse the pattern.** |
| Frontend routing with Zod-validated search | `workstreams-app/src/frontend/router.tsx` — TanStack Router, `basepath: "/workstreams"` | **Reuse.** |
| Worktree root resolution | `workstreams-app/src/server/issues-mutation-service.ts:81` — `overlay.worktreeRoots.get(worktree)` | **Reuse.** |
| Path containment against traversal and symlink escape | `workstreams-app/src/server/issue-path.ts:13-39` | **Reuse the pattern**, per the house rule at `exhibits/store.ts:9-12` (share patterns, not source). |
| The markdown file list, including untracked and `scratch/` | `bin/router-docs.ts:348-364` — `git ls-files --cached --others --exclude-standard`, then a deliberate re-admission of ignored `scratch/*.md` | **Reuse the logic, port it to the app.** The `scratch/` carve-out is load-bearing: *"scratch/ is exactly where agents leave deliverable orientation docs the boxholder wants to browse"*. |
| Server-side syntax highlighting | `bin/router-docs.ts` — `highlightCodeBlocks` over hljs, for fenced blocks | **Reuse the dependency**, not the function: the app renders client-side React, so it needs hljs (or equivalent) in its own graph. |
| Quick-open, sidebar grouping, recent-sort | `bin/router-docs.ts:519` (`renderDocQuickOpen`), `:434-442` (`renderDocSidebar`) | **Rebuild in React.** These are the affordances that must survive the consolidation — see Track 3. |
| Closed-issue pills on rendered docs | `bin/router-docs.ts:122` — `appendClosedIssuePills` | **Port.** A small thing that makes issue links legible. |
| `data-cb-source` provenance tagging | `callback-box/src/frontend/src/lib/source-tag.ts:7`, `callback-box/docs/data-source-tagging.md` | **Extend with a `file:` type.** See Track 4. |
| A working source-inspection overlay | `callback-box/src/frontend/src/components/SourceViewOverlay.tsx:19-26` — walks up to the nearest `data-cb-source`, highlights, click to inspect | **Reuse the technique.** This is already the affordance the comment plan needs. |
| Exhibits, on a separate origin | `bin/workstreams-app-supervisor.ts:21-23` — *"The exhibits surface is a SECOND listener in the same supervised process group, on its own origin… The router never proxies it: exhibit URLs are direct, which is exactly why"*; credential separation at `workstreams-app/src/server/exhibits/auth.ts:8-13` | **Index, never absorb.** See the boundary below. |
| The exhibits ask queue, already surfaced in the app | `workstreams-app/src/frontend/pages/AsksPage.tsx` | **Reuse.** The browser links to it rather than duplicating it. |

## Prior art (external)

- **Sourcegraph / GitHub code view** establish the conventions this browser
  should not deviate from without reason: a file tree, a line-addressable view
  (`#L12-L20`), and blame/history beside the content. Line-range URL fragments
  are the de facto standard for pointing at code, and matching them means a link
  from this browser pastes usefully elsewhere.
  <https://docs.sourcegraph.com/code_navigation>
- **Text fragments (`#:~:text=`)** are the equivalent standard for prose, and are
  already used in this codebase (`quote-anchor.ts`). Using text fragments for
  prose and line ranges for code is the split every code host has converged on;
  this plan follows it rather than inventing one addressing scheme for both.
  <https://developer.mozilla.org/en-US/docs/Web/URI/Fragment/Text_fragments>
- **No prior art found** for "one browser over a monorepo's docs, code, and
  agent-produced artifacts with a shared provenance-tagging spine." The closest
  neighbours are documentation site generators (Docusaurus, MkDocs), which build
  a static site from a curated subset — the opposite of this browser's premise
  that everything in the tree is browsable live, including untracked files.

## The addressing rule

**Enter a universal view; filter to a workstream if you care to.** The boxholder,
2026-08-22: *"I want to enter a universal view, then filter by workstream if I
care to. As opposed to going into a workstream like the current
`workstream-name/dev/` does."*

This is one rule, and it applies to more than the browse route — the
workstream-first pattern is currently the app's front door as well. The
inventory, and what each surface becomes:

| Surface today | Shape | Becomes |
|---|---|---|
| `/<worktree>/dev/…` (`bin/router-docs.ts`) | Worktree is the first path segment | Retired into `/workstreams/browse?file=…` (Track 5) |
| `/workstreams/` → a list of workstreams (`router.tsx:13`) | You pick a workstream to reach anything | **The universal recency feed** (Track 3); the workstream list becomes one view among others |
| `/workstreams/$name` (`WorkstreamDetailPage`) | Per-workstream detail | **Kept.** A workstream's issues, git state, and session are legitimately about the workstream itself, not a partition of the files |
| Exhibits `/:ws/` (`exhibits/app.ts:275`) | Per-workstream exhibit list | A universal exhibit index with a workstream filter; the per-workstream URL keeps working |

**Storage layout is not navigation, and does not change.** The exhibits store
stays one directory per workstream (`workstream-exhibits.md:231`) — that layout
is what makes an exhibit survive a cull, and nothing about a universal *listing*
requires reorganizing it. The rule is about how the developer reaches things, not
about where bytes live.

**Why `WorkstreamDetailPage` survives the rule and `/dev/` does not.** The test
is whether the workstream is the *subject* or merely the *location*. A
workstream's session state and issue set are about that workstream — there is no
universal version of "is this session live". A file is not about a workstream; it
merely sits in one checkout, and treating that as its address is what makes it
unreachable from anywhere else.

## The boundary this plan must not cross

**Exhibits keep their own origin.** The exhibits listener exists specifically so
that agent-authored pages, which run arbitrary scripts, do not execute on the
origin holding the router and workstreams authority
(`exhibits/auth.ts:8-13`: *"It grants the exhibits routes and nothing else — the
router/workstreams authority lives on a different origin behind a different
credential, which is the whole reason for the second listener."*).

The browser therefore **indexes** exhibits — lists them, shows their asks and
dispositions, links to them — and never re-serves an exhibit page on the
workstreams origin. The same reasoning applies to `dev/*.html` artifacts, which
are agent-authored pages with inline scripts: the browser lists them and frames
or links them at their existing origin. Absorbing either would delete a boundary
that was put there deliberately.

This is the concrete answer to "HTML pages are a bit more quirky."

**What an exhibit can be asked for: a header component.** The boxholder wants
exhibits to carry some of the browser's functionality — *"they can do ANYTHING,
but I'm hoping we can ask them to include a header component that shows some
functionality."* How much can be **guaranteed** rather than asked for depends on
the tier, and the exhibits contract is not quite right about this today:

| Tier | Chrome today | Header |
|---|---|---|
| No page file (default renderer) | Container shell | **Guaranteed** — the container renders it |
| `index.tsx` (module) | Container shell (`app.ts:150-173`) | **Guaranteed** — same shell |
| `index.html` | **None** — *"served as-is, scripts allowed. That is what this origin exists for"* (`app.ts:143-147`) | **Asked for** — a one-line include |

So two of the three tiers get the header with no author cooperation at all, by
extending the shell that already renders the ask control. Only the raw HTML tier
has to opt in, and for it the browser's exhibit index shows which exhibits carry
a header and which do not — an honest gap rather than a silent one.

`workstreams-app/docs/exhibits.md` currently states that the container's control
is appended *"for every tier, custom pages included"*, which the `html` branch
above contradicts. That doc line needs correcting whether or not this plan
proceeds; it is filed rather than fixed here
(`issues/docs-and-chores/2026-08-22-exhibits-doc-overstates-container-chrome.md`).

## Tracks / scope

### Track 1 — The address space and the read API

**What.** One way to name any readable thing, and one procedure to read it.

**Why this needs to change.** Five surfaces have five addressing schemes today,
and two of them (`PlansPage`'s link-out) hardcode `main`.

**Direction.** `/workstreams/browse?file=<repo-relative-path>` addresses
everything, with `&workstream=<name>` as the lens. Neither the worktree nor the
selected file is a path segment.

**This follows the issues browser, which already made both decisions.** The
boxholder named it as the model — *"This is like the issues browser, which also
isn't per-workstream"* — and the code bears it out twice over:

- It is universal. `issues.list` returns every issue across every workstream
  (`IssuesPage.tsx:10`), rendered in one pane, with category, priority, needs,
  status and sort held as Zod-validated **search params** (`router.tsx:15`).
- It **migrated away from path segments for the selected item.**
  `legacyIssueRoute` (`router.tsx:18-37`) takes the old
  `/issues/$category/$filename` shape and redirects it to
  `/issues?issue=<relPath>`. That is a decision this codebase already made and
  implemented a migration for; a new browser addressing files by path segment
  would be re-adopting the shape those redirects exist to retire. (The redirects
  themselves are now slated for removal —
  `issues/code-quality/2026-08-22-remove-legacy-issue-deep-link-routes.md` — which
  does not weaken the precedent; it completes it.)

The consequence is that the list is always present and the selection is state on
top of it, rather than a separate page you navigate into — which is the same
reason it suits the browser: the recency feed stays visible while you read.

Deep links still work: `?file=src/foo.ts#L12-L20` for code and a
`#:~:text=` fragment for prose are both unaffected by the selection living in a
search param.

`documents.read({relPath, workstream?})` returns the content plus a
discriminated `kind` — `markdown | code | directory | page | data` — whether the
file is tracked, and which workstreams have modified it (Track 3a). Path
resolution reuses the `issue-path.ts` containment pattern against the resolved
root — main's, or `overlay.worktreeRoots.get(workstream)` when the lens is on —
refusing traversal and symlink escape rather than clamping.

`kind` is a closed union dispatched with `assertNever`, so adding a renderer is a
compile error until every switch handles it (principle 2).

**Vocabulary lock-ins.** The route `/workstreams/browse`; `?file=` for the
selection and `?workstream=` for the lens, matching `?issue=` on the issues
browser; the `kind` union members.

**First implementation chunk — BUILT (2026-08-22).**
`workstreams-app/src/server/document-read.ts` (address resolution, the `kind`
union, containment re-checked after realpath, the text-size and binary
refusals), wired through `DocumentsService.readDocument` and the
`documents.read` tRPC query. Covered by
`workstreams-app/test/document-read.doctest.md` and driven over HTTP against a
standalone app.

### Track 2 — Renderers

**What.** One renderer per `kind`.

**Direction.**
- `markdown` — the existing `Markdown` component, plus closed-issue pills.
- `code` — syntax-highlighted, **line-numbered, and line-addressable**
  (`#L12-L20`), matching what every code host does. Line numbers are the
  pointing device here; prose has no equivalent and does not get them.
- `directory` — a listing that is itself a browsable thing, not a dead end.
- `page` — an agent-authored HTML artifact: framed or linked at its serving
  origin, never inlined (see the boundary above).
- `data` — JSON/YAML rendered readably rather than as a wall of text.

**First implementation chunk — BUILT (2026-08-22).** `markdown`, `code`,
`directory`, and `page` render in `BrowsePage.tsx` at
`/workstreams/browse?file=…&workstream=…`, and `PlansPage` now links there
instead of out to `/main/dev/docs/…`. Line-addressable code fragments and the
`data` renderer are still to come.

### Track 3a — Workstreams as a lens, not a partition

**What.** Every file view knows which workstreams have touched it; every
workstream can filter the browser to what it touched.

**Why this needs to change.** Today a workstream's changes are only visible by
entering that worktree. Reading a source file on main tells you nothing about the
three branches rewriting it, which is exactly when you would want to know.

**Direction.** Two directions over one piece of data — the set of files each
workstream branch has changed relative to main (`git diff --name-only
main...worktree-<name>`, per workstream):

- **File → workstreams.** A file view shows "changed in: `scanner-ingest`,
  `dev-comments`", each linking to that workstream's version of the same address
  (`?workstream=…`) and to its issues.
- **Workstream → files.** `?workstream=<name>` filters the browser and
  quick-open to what that workstream has touched, without becoming a separate
  browser.

The app already carries per-workstream git state — `gitStateSchema` with `ahead`
(`workstreams-app/src/shared/workstreams.ts:14-15`) — so this extends an existing
shape rather than introducing a git dependency.

**Freshness, stated explicitly rather than assumed.** An earlier draft said this
data would be *"invalidated on the same signal the workstream list already
refreshes on."* No such shared signal exists: `documents-service` holds a 60-second
snapshot cache (`DOCUMENT_CACHE_MS`, `documents-service.ts:26`) invalidated only
after issue saves (`:265`), while the workstream list is a fresh CLI call each
time (`workstreams-command.ts:160`), and the existing overlay scans only `issues/`
paths (`issue-overlay.ts:104`). So the model is written down instead:

- Changed-files data joins the **existing 60-second document snapshot**, computed
  with it and expiring with it. One TTL for the whole surface rather than a
  second, differently-aged cache.
- The staleness window is therefore up to 60 seconds, and it over-reports: a file
  shows as changed slightly after it stops being. That is the harmless direction.
- An explicit refresh is available, for the case where the developer just
  committed and wants the feed to agree with them.
- **A failed or timed-out diff reports the workstream information as
  unavailable, never as "changed in: none".** The absence of an answer and an
  answer of "none" must not look alike (principle 4).

**Cost to state plainly:** one `git diff` per live workstream per snapshot
period, which is a handful of subprocesses a minute at the observed number of
workstreams. If that ever stops being cheap, the answer is a longer TTL, not a
cleverer cache.

**Vocabulary lock-ins.** `?workstream=` means "lens", not "location", everywhere
in the browser.

**First implementation chunk — BUILT (2026-08-22).**
`workstreams-app/src/server/workstream-changes.ts` scans every live worktree
(committed, uncommitted, and untracked, matching `issue-overlay.ts`), rides the
existing 60-second document snapshot, and reports a failed scan as *unavailable*
rather than as "changed nothing". `documents.read` carries `changedIn` and
`changesUnavailable`; `documents.changedFiles` answers the other direction and
distinguishes a quiet workstream from one that does not exist. The viewer shows
"changed in …" with each name linking to that workstream's version of the same
address. Covered by `workstreams-app/test/workstream-changes.doctest.md`.

### Track 3 — Finding things

**What.** The navigation that makes one surface better than five, rather than a
sixth.

**Why this needs to change.** This is the actual complaint. Consolidation that
loses quick-open and the grouped sidebar would make finding things *worse* while
claiming to fix it.

**The front door is recency across all workstreams, not a file tree.** The
boxholder's rule: *"a file is interesting if it has been modified recently, in
any workstream."* That is a feed, not a listing, and it is a different structure
from a directory tree — so the browser opens on cross-workstream recent activity,
with the tree available rather than mandatory. Three views over one dataset:

- **Aggregate** (the default) — what changed recently anywhere, most recent
  first. If file asks are built
  (`issues/features/2026-08-22-file-asks-agent-flagged-attention.md`), a flagged
  file is badged here — "this changed" and "someone wants your eyes on this" are
  different signals. The feed does not depend on that work landing.
- **Filtered** — the same feed narrowed to one workstream (`?workstream=`).
  Viewing one workstream on its own is fully supported and is **not** the
  per-workstream browser the boxholder rejected: the rejection was of entering a
  workstream as a *mode* you browse inside. A filter over one address space is
  the opposite of a partition, and the existing `WorkstreamDetailPage` remains
  the place to see a workstream's issues and state.
- **Distribution** — how much recent work came from which workstream, answering
  *"an understanding of how much work comes from what workstreams."*

The recency computation is a generalization of working code:
`bin/router-docs.ts:382-400` already derives per-file times from
`git log --format=%ct --name-only` and falls back to filesystem mtime for
untracked files, with the reasoning recorded in place — untracked files *"were
created after the worktree clone, not shared at clone time like tracked files —
so fall back to it, which floats in-progress docs to the top."* Today it is
scoped to `.md` in one repository root; this generalizes it to all files across
every live workstream, and the mtime fallback keeps mattering for exactly the
same reason.

**Direction.** Port the affordances that work, in React:
- Quick-open over every browsable path (`renderDocQuickOpen`, `router-docs.ts:519`).
- A sidebar grouped by area, with path and recently-edited sorts
  (`renderDocSidebar`, `:434-442`).
- The untracked-and-`scratch/` inclusion rule (`:348-364`), extended from `.md`
  to code and data.
- Cross-links to the surfaces that stay separate: the exhibits index, the asks
  queue, the site preview.
- The issues app keeps its own interface and is linked, not absorbed — the
  boxholder is explicit: *"issues should still be the interface we have now."*
  What issues gain is source tagging, so the comment capability reaches them
  (`document-comments.md`, Track 3).

**First implementation chunk.** The aggregate recency feed, mounted at the app's
index route. It is both the front door and the smallest thing that makes the
browser worth opening daily; quick-open and the sidebar follow. The workstream
list that occupies `/` today (`router.tsx:13`) moves to its own route rather than
being deleted — it is still how you reach a session to focus or resume.

### Track 4 — `file:` provenance, and the source overlay

**What.** Extend `data-cb-source` so a rendered chunk can say which file it came
from, and bring the inspection overlay to this browser.

**Why this needs to change.** `SourceType` is box vocabulary — `card | commit |
api | dir | session | schedule` (`source-tag.ts:7`) — with no way to say "this
came from a file in the repo." Provenance is what makes a chunk addressable when
the page assembles content from several places, which is the case the boxholder
named ("chunks might also come from elsewhere").

**Direction.**
- Add `file` to `SourceType`, identifier = repository-relative path, documented
  in `callback-box/docs/data-source-tagging.md` beside the existing types.
- The browser tags its rendered content with it, whole-page for a simple file and
  per-chunk where a view assembles several.
- **`data-cb-source-item` stays free-form.** The doc is explicit — *"This is
  free-form text — not a structured identifier"* — and it should stay that way.
  A consumer stores it verbatim as context; nothing resolves it. Making it
  structured would force every tool that emits a chunk to mint stable
  identifiers, which is the document-medium machinery this family of work has
  twice decided against.
- Port the walk-up-and-highlight overlay (`SourceViewOverlay.tsx:19-26`) into the
  app, where it serves both debugging and comment capture.

**Vocabulary lock-ins.** The `file:` source type and its identifier being a
repository-relative path.

**First implementation chunk.** The `file` type, its doc entry, and tagging in
the markdown and code renderers.

### Track 5 — Retiring what this replaces

**What.** Turning off the surfaces the browser subsumes, rather than leaving them
beside it.

**Why this needs to change.** The whole justification is principle 8. Two
browsers is the state being fixed, not an acceptable end state.

**Direction, in the order the surfaces can safely go:**
1. `PlansPage`'s link-out becomes an in-app link (this one is pure gain, and can
   land the day Track 2 does).
1b. The app index becomes the universal feed and the workstream list moves to
   its own route — the front-door half of the addressing rule.
2. `/<worktree>/dev/docs/` redirects to the browser once Track 3 has quick-open
   and the sidebar — not before.
3. The `/<worktree>/dev/` manifest and directory indexes redirect once Track 2's
   `directory` and `page` renderers land.
4. `bin/router-docs.ts` shrinks to serving raw artifact files (which the `page`
   renderer frames) and stops rendering chrome.

Each step is a redirect, not a deletion, so a bookmarked URL keeps working.

**First implementation chunk.** Step 1.

**Sequencing note.** The browser is built *beside* the surfaces it will replace,
and they are retired only as each renderer lands — the boxholder's framing:
*"do it in parallel to existing work (and later we'll remove some of the existing
work)."* Nothing in this plan requires an existing surface to be turned off
before its replacement is usable.

## Could this be simpler?

**The simplest version that could work:** leave the five surfaces alone and add
only a code viewer, since code is the one genuinely missing kind. That is a
fraction of the work and closes the literal gap.

**What the fuller version buys:** the complaint is not "I cannot read code," it
is *"it is confusing and hard for me to find things."* Adding a sixth surface to
a set of five that already confuse would make the stated problem worse while
technically adding a feature. The consolidation *is* the deliverable; the code
renderer is one of its parts. Principle 8.

**Where this plan could still be too big:** Track 2's `data` renderer and Track
5's step 4 are the two pieces nothing depends on. If the plan needs to shrink,
they go first — a JSON file can render as code, and `router-docs.ts` can keep its
chrome for as long as nobody visits it.

**What is deliberately not simplified:** Track 3. Porting quick-open and the
sidebar is the difference between consolidation and regression.

## Subplans

`document-comments.md` is the sibling plan, not a subplan: it has its own store,
CLI, and transcription decisions, and it is useful on its own. This plan is its
dependency for anything beyond `bin/comments`. They ship in either order; the
comment UI needs Track 2, and nothing else crosses.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A path escapes the worktree root (`..`, absolute, symlink) | Doctest per escape shape | Containment plus post-`realpath` re-check, refusing rather than clamping | Clear |
| The named worktree does not exist or was culled | Doctest | `documents.read` returns NOT_FOUND naming the worktree | Clear |
| A binary or very large file is requested | Doctest with a fixture | Size and content-type checked before read; offered as a download rather than rendered | Clear |
| An agent-authored `page` artifact runs script on the app origin | Doctest asserting the renderer frames rather than inlines | The `page` renderer never inlines HTML into the app document | Clear |
| An exhibit is indexed but its origin is down | Doctest | Listed with its link; the failure appears on navigation, not as a missing row | Clear |
| Syntax highlighting fails on an unknown language | Doctest | Falls back to plain monospace, not an empty pane | Clear |
| A redirect from a retired surface points at a browser route that does not exist yet | Doctest per redirect, landing on a real route | Track 5's ordering: each redirect lands only after its renderer | Clear |
| The file list is stale after an agent writes a new doc | Doctest | Read live per request, as the doc browser is today (`no-store`) | Clear |
| Quick-open over a very large tree becomes slow | No | Not addressed; the tree is thousands of files, not millions | **Silent** (accepted) |
| Two worktrees hold different untracked files at one path | Doctest | Distinct addresses via the `?workstream=` lens; the unlensed address is main's | Clear |
| A workstream's `git diff` fails or times out | Doctest with a broken worktree | The file renders with workstream information marked unavailable, never as "changed in: none" | Clear |
| The changed-files cache is stale after a workstream commits | Doctest on invalidation | Invalidated with the workstream list; a stale entry over-reports, which is visible | Clear |
| An `index.html` exhibit carries no header | Doctest over all three tiers | The exhibit index says so; the other two tiers get the header from the shell | Clear |

**The accepted silent failure.** Quick-open performance is not designed for. The
repository is a few thousand files; if it ever is not, the symptom is a slow
palette, which is visible and fixable then. Principle 6 — defending it now is
defending a failure that cannot currently happen.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — *ADDRESSED.* `kind` is a closed union with
  `assertNever`; a renderer cannot be silently missing.
- **Stale ref** — *ADDRESSED.* A link to a file that has moved 404s naming the
  path, rather than rendering an empty document.
- **Two agents touching the same file** — *N/A.* The browser is read-only.
  Mutation lives in `document-comments.md` and in the existing issue actions.
- **Hand-edit drift** — *ADDRESSED.* Everything is read live from disk; there is
  no cache to go stale.
- **Fabricated free-form value** — *ADDRESSED by design.* `data-cb-source-item`
  is free-form prose written by the tool that renders a chunk. It describes
  rather than identifies, and nothing resolves it, so a wrong one misleads a
  reader but cannot mis-address anything.
- **Validation error UX** — *ADDRESSED.* Refusals name the worktree, the path,
  and which rule refused.
- **Partial migration / transition state** — *ADDRESSED.* Track 5 is a redirect
  sequence, each step gated on its renderer. During the window both surfaces
  work; at no point does a URL stop resolving.

## NOT in scope

- **Re-serving exhibit pages or `dev/*.html` on the workstreams origin.** The
  origin separation is deliberate; see the boundary section.
- **Editing.** The browser reads. Comments are the sibling plan; issue mutations
  already exist elsewhere.
- **Commenting on diffs, and a diff view generally.** The boxholder expects to
  want it later and deprioritized it explicitly. The recency feed names what
  changed; seeing the change itself is a separate piece of work.
- **Replacing the issues interface.** It stays as it is.
- **Search over file contents.** Quick-open matches paths. Content search is a
  real want and a different piece of work — see the structured-module-docs issue.
- **Git history, blame, or diffs.** A code host would have them; nothing in the
  stated job needs them yet.
- **Per-workstream browsers.** Explicitly rejected by the boxholder. A workstream
  is a lens; entering one is not a mode.
- **Writing to a workstream from the browser.** The lens reads another branch; it
  does not edit one.
- **The box's own `browse/` surface.** Different tree, different vocabulary, its
  own filed issue. This plan must not quietly redefine what "browse" means there.
- **Deleting `bin/router-docs.ts`.** Track 5 shrinks it to raw file serving; the
  `/dev/` origin still serves artifacts that the `page` renderer frames.
- **Authentication changes.** The browser rides the workstreams origin's existing
  `control-read` classification.

## Open design questions

- **Does the doc browser's `scratch/` re-admission rule generalize?** It exists
  because agents leave deliverable notes there. Extending it from `.md` to code
  and data means gitignored build output could appear. Lean: keep the rule
  scoped to `scratch/` specifically, as it is today, rather than to "ignored
  files" generally.
- **How much of a code host does the `code` renderer become?** Line numbers and
  line-addressable fragments are in. Blame, history and cross-references are out
  for now, but the line is worth confirming — they are the natural next asks.
- **What does the unlensed address show for a file that exists only in a
  workstream?** Main has no such file, so the canonical address 404s until the
  branch merges. Lean: render it with the lens applied automatically and say so,
  rather than 404ing on a file the developer can plainly see exists.
- **How much functionality belongs in the exhibit header?** Provenance and a link
  back to the browser are obvious. A comment affordance would be useful and drags
  the sibling comments plan onto the exhibits origin, which has its own
  credential. Lean: provenance and navigation first, comments deliberately not.

## Knowledge audits

**Skipped, with rationale.** Knowledge audits prompt a **box agent** and test
what it recalls (`callback-box/docs/knowledge-audits.md`). This browser is dev-repo
infrastructure that a box agent never encounters. The one piece that touches box
vocabulary — the `file:` source type in `data-source-tagging.md` — is a
convention for *frontend code authors*, not something a box agent recalls while
processing cards. Its verification is the lint/typecheck of the code that uses it.

## Implementation order

1. **`documents.read` and containment** (Track 1). No UI.
2. **Markdown renderer and the browse route** (Track 2), plus `PlansPage`
   linking in-app (Track 5 step 1). First visible value.
3. **Code renderer** (Track 2) — line numbers and line-addressable fragments.
4. **File → workstreams** (Track 3a). The cross-workstream view the job story
   asks for; the `?workstream=` filter falls out of the same data.
5. **Quick-open and the sidebar** (Track 3). The point at which the browser can
   replace daily use of `/dev/docs/`.
6. **`file:` source type and the overlay** (Track 4). Unblocks the comment plan's
   capture affordance.
7. **Directory and page renderers** (Track 2), plus the exhibit header in the
   container shell and the exhibit index.
8. **Redirects** (Track 5, steps 2–4), each gated on the renderer it needs.

## Rollout shape

**Where this code runs.** The workstreams app is main-checkout code — the
supervisor is pointed at `path.join(MAIN_ROOT, "workstreams-app")`
(`bin/router.ts:1511-1514`). Development runs against an isolated router
(`CALLBACK_STATE_DIR`, `ROUTER_PORT`, and `CALLBACK_MAIN_ROOT` at
`bin/router.ts:106` pointed at the worktree). On main, the supervisor restarts
the app on source change by itself (`bin/workstreams-app-supervisor.ts:483-499`),
so no boxholder action is needed after merge.

**Track 5 touches `bin/router-docs.ts`**, which the comments plan deliberately
does not. Those changes are redirects and deletions of chrome, and they land
last, after the browser has replaced what they served.

**Test posture.** Doctests in `workstreams-app/test/`:

- `browse-read.doctest.md` — every path-escape shape, an unknown worktree, a
  binary file, a large file, tracked and untracked.
- `browse-kinds.doctest.md` — `kind` dispatch exhaustiveness, and the `page`
  renderer framing rather than inlining.
- `browse-navigation.doctest.md` — the file list including untracked and
  `scratch/`, quick-open matching, both sort orders.
- `browse-workstream-lens.doctest.md` — file → workstreams for a file changed on
  two branches, the `?workstream=` filter, a failed diff reporting unavailable
  rather than none, and cache invalidation.
- `browse-recency.doctest.md` — the aggregate feed ordering across two
  workstreams, the untracked-file mtime fallback, and the per-workstream
  distribution counts.
- `browse-source-tags.doctest.md` — `file:` tags emitted by the markdown and code
  renderers, and the overlay's walk-up finding the nearest one.
- `browse-redirects.doctest.md` — each retired URL lands on a route that renders.

**Done-when:** those seven suites pass; every URL retired in Track 5 redirects to
a working route; `PlansPage` no longer links out of the app; a plan, a source
file, a directory, and a scratch note are all reachable from one quick-open; and
a file changed on two branches says so when read at its unlensed address.

**Migration.** None — no stored data changes shape. The retirements are
redirects.

**Cross-model review.** This plan spans the router, the app, and a shared
frontend convention, and it retires working surfaces. It gets a `/cross-model`
pass before implementation starts.
