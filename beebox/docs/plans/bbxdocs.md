---
title: "_bbxdocs: one read-only area for Bee Box's own docs, and a person-facing changelog"
status: draft
workstream: user-changelog
issues:
  - ../../../issues/docs-and-chores/2026-11-10-generated-box-docs-do-not-name-their-source.md
---
# _bbxdocs: one read-only area for Bee Box's own docs, and a person-facing changelog

Bee Box ships reference docs for box agents in its package. Agents read them at
`node_modules/beebox/box-docs/`; the person cannot open them at all. This plan
gives every box one path, `_bbxdocs/<doc>.md`, that agents read from disk and
the person opens as an ordinary card or link. The area is a symlink into the
package, is not in box git, and refuses writes. The first new doc in it is
`whats-new.md`: user-visible changes, one line each, written by the same
schedule that writes `agent-changes.md`.

**Issues addressed:**
- `issues/docs-and-chores/2026-11-10-generated-box-docs-do-not-name-their-source.md`
  — partly: the renamed package directory gets a source header (Track 2).
- Related, left open: `issues/decisions/2026-07-20-release-discipline-and-update-story.md`
  ("Still open: no changelog or release notes"). This plan adds the person's
  changelog; release tags and update detection stay with that issue.
- Related, left open: `issues/docs-and-chores/2026-07-20-day-to-day-usage-docs.md`.
  `_bbxdocs/` is where such docs would live; writing them is not in scope.
- Related, left open: `issues/features/2026-09-12-agent-documentation.md`
  (the public corpus on beebox.run). `site/sources.ts` reads the renamed
  package directory; only its path changes.
- Searched the queue for `box-docs`, `bbxdocs`, `changelog`, `what's new`,
  `whats-new`: no other duplicate.

## Design

### Situations

- When Priya opens her box after a few days and finds an Accept control in the
  composer she has not seen, I want to see what changed in Bee Box lately, so I
  can try the new control instead of working around it.
- When Tomas asks the box "can you make a reminder fire when I open a card?",
  I want the agent's answer to link the doc it read, so I can read the whole
  thing myself and see what else it can do.
- When Priya asks "what's new?", I want the agent to answer from the same list
  I can open, so the two do not disagree.
- When Odette is in the middle of entering a recipe, I do not want a "What's
  new" banner or badge, so I can finish what I came to do.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| New control noticed | Show when asked | Settings page, "Bee Box docs" section: links to What's new and to the docs index; both open as markdown cards in the workspace | Waits to be found |
| Agent cites a doc | Show | Chat link `_bbxdocs/triggers.md` opens the doc as a card | Waits to be found |
| "What's new?" in chat | Show | Agent reads `_bbxdocs/whats-new.md`, answers briefly, links it | Waits to be found |
| Mid-task | Quiet | Nothing | None |

No badge, banner, or post-update notice in this plan. The update-detection
issue (`issues/features/2026-08-03-detect-server-update-prompt-client-reload.md`)
is the natural place to add one later.

### Spirit

- **Serves:** "You should be able to see the gears" — the docs the agent works
  from become docs the person can read, at the same path.
- **Risks:** "It should feel like a place" — an engine-owned area in the
  person's tree could read as clutter or as something they should tend. Guard:
  it is read-only, has a plain label in breadcrumbs (`Bbxdocs` is derived by
  `display-path.ts`; Track 1 gives it an explicit label), and holds nothing the
  person must maintain.

Spirit also says the box's story is "Not a changelog — a narrative"
(`docs/architecture/spirit.md`). That sentence is about the box's own activity.
`whats-new.md` is about the software, and a dated list fits that.

### Trust

Shows only, takes no action. The agent reads and links; it never writes the
area (Track 3 enforces this).

### When it goes wrong or does nothing

- The box link is missing (a dev box that has not run the migration): the
  person still sees the docs, because the server reads the package directly.
  The agent's reads fail, and the `package-docs` health check reports the
  missing link with the fix (`bbx engine migrate --sweep`).
- A doc named in an old chat no longer exists: the card opens as "not found",
  the same as any missing file.
- Nothing user-visible has landed: `whats-new.md` keeps its last entries. The
  header says when the list started.
- The person tries to edit: markdown cards have no edit UI
  (`src/frontend/src/renderers/markdown.tsx` renders `<Markdown>` only); a
  write through any API is refused with "Bee Box docs are read-only".

### Walkthrough

Priya opens Settings and selects "What's new in Bee Box". The workspace opens
`_bbxdocs/whats-new.md`. `GET /api/files/_bbxdocs/whats-new.md` resolves the
path in read mode; for this one area the server reads the package's own docs
directory, whatever the box's link says. The markdown renderer shows dated lines. One reads
"2026-11-14: Accept in the composer marks the agent's text as your own. See
`composition-editor.md`." She selects the link; it resolves relative to
`_bbxdocs/` and opens that doc. Nothing is written; box git is unchanged.

## Smallest fix and budget

**Smallest fix:** write `whats-new.md` into `docs/box/` so it ships in
`box-docs/`, and have the agent answer "what's new?" from it. The person could
not open it, and agent links to it would still be dead. That fails the
developer's stated goal: "a general pattern for exposing beebox-hosted docs to
the user".

**Chosen design:** five tracks (below). Estimates, additions plus deletions:

| Track | Source | Tests |
|---|---|---|
| 1. Host area kind, the read mapping, write refusals | ~200 | ~180 |
| 2. Rename `box-docs` → `bbxdocs`, file modes, the link, the migration | ~160 code, ~480 path-string lines (mechanical) | ~110 |
| 3. Write guard for agents | ~80 | ~60 |
| 4. Settings links | ~30 | ~20 |
| 5. `whats-new` from the agent-changes schedule | ~90 | ~50 |

Total: about 1,100 hand-written lines plus about 480 mechanical path rewrites
(of which `src/dev/knowledge-audits.yaml` is 152 and `agent-guide/ledger.yaml`
is 56). Authored docs: about 60 lines (`whats-new.md` seed, `about-bee-box.md`,
`box-guidance.md`, `box-layout.md`). Not a BIG CHANGE.

## Stated preferences this plan trades against

- **Developer decisions, this conversation (2026-11-15):** a virtual root, not
  a URL scheme ("it acts like a normal link/file/etc, just that it's loaded
  differently"); a symlink so links and files extrapolate the same way; clear
  in both instructions and permissions that it is read-only and not in git; a
  dedicated package location; agent docs and person docs are peers in one
  place.
- **Principle 8, one way to do each thing** (`docs/engineering-principles.md`):
  the rename leaves no `box-docs` alias. Old paths in box content are rewritten
  by the migration (Track 2), not kept working by a second name.
- **Principle 7, hierarchy is a discoverability contract:** `_bbxdocs/` sits
  with the other underscore areas, so a reader can predict it.
- **Principle 11, enforcement beats convention:** the write refusal is code in
  the fence and a `PreToolUse` hook, not only a sentence in the guide.
- **Memory "minimize invented concepts":** one new vocabulary kind (`host`)
  instead of a per-doc audience flag or a new card type.

## What already exists

- **Root vocabulary.** `src/shared/box-layout-types.ts:43`: `kind: "area" |
  "tooling";`. Areas are listed in `src/shared/box-root-vocabulary.ts:19-23`.
  Reuse; add a kind.
- **Namespace fence.** `src/lib/box-namespace-resolve.ts:91`:
  `export type BoxNamespaceAccessMode = "read" | "write";`. At l.247-254: "The
  area segment itself (e.g. `_content`) must not be a symlink" … `if
  (areaStat.isSymbolicLink()) return false;`. Extend for host areas.
- **Package docs.** `src/core/docs-gen/shared.ts:19`: `PACKAGE_DOCS_DIR_NAME =
  "box-docs"`; l.28: `BOX_PACKAGE_DOCS =
  \`node_modules/beebox/${PACKAGE_DOCS_DIR_NAME}\``, with the comment "every
  pointer an agent sees is built from this constant". Reuse; change the values.
- **Refresh entry point.** `ensureEngineDocs()` runs first in `generateDocs`
  (`src/core/docs-gen/generate/core.ts:435`), which runs at chat start
  (`start-run.ts:117`), each reactor cycle, `bbx init`, and `bbx docs refresh`.
  The link is created there.
- **Box `.gitignore`.** `writeBoxGitignore` (`src/core/box/structure/core.ts:236-298`)
  runs only at `bbx init`; its comment says a change "reaches existing boxes
  only through a new dated migration". Reuse via a migration
  (`src/core/migrations.ts`).
- **Agent hooks.** `install-validation-hooks.ts` merges a `PostToolUse` entry
  (matcher `Edit|Write|MultiEdit`, runs `bbx validate --hook`) into the box's
  `.claude/settings.json`. Post-hooks cannot block. Add a sibling `PreToolUse`
  entry with the same merge code.
- **CLI target paths.** `src/cli/lib/cli-target-path.ts:74` `resolveCliTargetPath`
  throws `DisplayFormPathArgError` and `ReservedSegmentPathArgError` (l.84,
  l.94). Reuse for a lexical host-area write refusal.
- **Markdown rendering.** `src/frontend/src/renderers/markdown.tsx` renders
  `.md` files through `GET /api/files/*` with `basePath` for relative links; no
  edit UI. Reuse as is.
- **Changelog schedule.** `schedules/agent-changes/` (`cadence: 3d`, baseline
  sha in the schedule store, `run.ts` gathers first-parent landings and closed
  issues, `lib.ts:32` `isAgentSurface` filters files, `OWN_OUTPUT` at l.8).
  Reuse; add a second filter and output.
- **Search.** `src/core/search/walk.ts` skips symlinked dirents and indexes
  package docs separately in `walkEngineDocs` (l.87-117). Reuse; key hits by
  `_bbxdocs/` so a hit opens for the person.

## Prior art (external)

- Claude Code permission deny rules under `permissionMode: "bypassPermissions"`:
  not relied on. Box sessions run in bypass mode
  (`core/agent/box-session-settings.ts`); a `PreToolUse` hook that exits 2
  blocks the call in every mode, so the plan uses the hook. Evaluated-only.
- Codex hook support for a pre-tool block: unverified; see Open design
  questions.
- No other decision depends on an external premise.

## Ontology

- **Host area** (new): a box root entry, underscore-named, whose content Bee
  Box provides. Readable through every read path; refuses writes (ordinary writes fail; a deliberate `chmod` is an accepted risk); not in
  box git. Identified by `kind: "host"` in `BOX_ROOT_VOCABULARY`. Not an
  `area` (writable, git-tracked). Exactly one exists: `_bbxdocs`.
- **`_bbxdocs`** (new): the host area. In the box, a relative symlink
  `_bbxdocs -> node_modules/beebox/bbxdocs`, which agents read through. The
  server does not follow it; it maps the path to `PACKAGE_ROOT/bbxdocs`.
  Spoken label "Bee Box docs".
- **Package docs directory** (renamed): `<package root>/bbxdocs/`, formerly
  `box-docs/`. Build output of `ensurePackageDocs`; gitignored in the engine
  repo. `PACKAGE_DOCS_DIR_NAME` names it.
- **`BOX_PACKAGE_DOCS`** (existing constant, new value): `_bbxdocs`. Every
  pointer an agent sees is built from it.
- **Package doc** (existing): one `.md` in the directory. Sources unchanged:
  `docs/box/*.md`, the static generators, built-in card docs, canvas-loop docs.
- **`whats-new.md`** (new package doc): dated user-visible changes, source
  `docs/box/whats-new.md`. Not `agent-changes.md`, whose bar is agent habits.
- **Person surface** (new filter in the schedule): a repo path whose change can
  alter what the person sees. Defined as the shipped paths of
  `bin/deployed-paths.ts` minus tests and docs, plus `ios-app/` and
  `beebox-clerk/`. Not `isAgentSurface`.

## Tracks / scope

### Track 1 — Host area kind and the read fence

- **What:** add `kind: "host"` and the `_bbxdocs` entry; let read paths follow
  that one symlink; refuse writes to it everywhere.
- **Why:** the fence refuses any symlinked area (`box-namespace-resolve.ts:254`),
  and `BOX_AREA_NAMES` filters (browse, `box-namespace.ts`) only know `area`.
  Reusing `area` would mark it writable to every consumer.
- **Direction:**
  - `box-layout-types.ts`: `kind: "area" | "host" | "tooling"`.
  - `box-namespace.ts`: `isInBoxNamespace` accepts `area` and `host`; new
    `isHostArea(relativePath)`.
  - Reads never follow the box's link. The server maps `_bbxdocs/<rest>` to
    `realpath(PACKAGE_ROOT/bbxdocs)/<rest>` (`src/lib/package-root.ts:44`
    `export const PACKAGE_ROOT`), then requires the `realpath` of the result
    to stay under that directory. The box owns the link and could point it at
    `.git`; the server does not trust it. The link exists for agents, which
    read the filesystem.
  - `resolveBoxNamespacePathOnDisk` returns that mapped path for a host area
    in read mode, and a distinct `{ ok: false, reason: "read-only" }` in
    write mode (today every refusal is `"escaped"`, l.331, which routes show
    as "Access denied"). Route adapters (`files-write.ts:62` and siblings)
    turn `read-only` into "`_bbxdocs/` holds Bee Box's own docs and is
    read-only. Put your notes in `_content/`."
  - CLI paths: `resolveCliTargetPath` stays a normalizer (it also serves
    `ls`, `refs`, `validate`). Its leading-slash recognition (l.31, `kind ===
    "area"`) learns `host`. Mutating commands (create, move both ends, trash,
    upload) and `actions.create` (`routes/actions.ts:103`) call a new
    `assertWritableTarget(boxRoot, relativePath)` that refuses a host area by
    name.
  - Writes that reach the package directory by another name
    (`node_modules/beebox/bbxdocs/...`, a symlink from `_content/`) are
    stopped by file modes, not by path checks: Track 2 makes the directory
    and its files non-writable on disk. File modes stop ordinary writes
    (an edit, `sed -i`, `cp`, a create through an alias). They do not stop a
    same-user process that first runs `chmod` or renames the directory; that
    is a deliberate override, outside this plan's threat model (see Failure
    modes).
  - Browse (`status.browse`, `status.ts:274-347`; REST `browse.ts`): today it
    calls the boolean `verifyBoxNamespaceOnDisk` (l.300), then reads the
    original path (l.311) and builds refs with `path.relative(boxRoot,
    fullPath)` (l.347). Change it to take the resolver's mapped physical path
    for reading and to build every returned ref from the logical path
    (`_bbxdocs/<rest>`), never from the physical one. At the root, a host-area
    entry is a symlink dirent: list it as a directory by name. Tests: a link
    pointed at `.git` still lists the package docs; a package outside the box
    root returns `_bbxdocs/whats-new.md` refs, not `../../…`.
  - `validate/box-checks.ts:70-85`: skip host areas in the recursive walk.
  - `box-root-check.ts:55`: build the "exactly …" list from the vocabulary.
  - `display-path.ts`: explicit label "Bee Box docs" for `_bbxdocs`.
- **Vocabulary lock-ins:** `kind: "host"`; `_bbxdocs`; `isHostArea`;
  `reason: "read-only"`; `assertWritableTarget`.
- **First chunk:** the kind, the vocabulary entry, `isHostArea`, and the fence
  change, with tests: read maps to the package directory; a box link pointed
  at `.git` does not change what is read; write returns `read-only`; a `..`
  or a nested symlink out of the package directory fails; `bbx refs
  _bbxdocs/triggers.md` and `/_bbxdocs/triggers.md` resolve.

### Track 2 — Rename, link, migration

- **What:** rename the package directory to `bbxdocs/`, point every agent-
  visible pointer at `_bbxdocs/`, create the link in every box, and migrate
  existing boxes.
- **Why:** the developer asked for a dedicated package location and one name
  for agents and the person.
- **Direction:**
  - `PACKAGE_DOCS_DIR_NAME = "bbxdocs"`; `BOX_PACKAGE_DOCS = "_bbxdocs"`.
  - `package.json` `files`, `beebox/.gitignore`, `.dockerignore`,
    `release.ts`, `deploy.sh`, `site/sources.ts`, `site/docs-generated.ts`,
    `bin/deployed-paths.ts`, `doc-check/file-paths.ts`, `doc-graph-data`.
  - Rewrite literal `node_modules/beebox/box-docs/` and `box-docs/` pointers:
    `agent-guide/guide.md` (18), `ledger.yaml` (56), `knowledge-audits.yaml`
    (152), `prompts.ts:68`, schemas (`landmark.ts`, `intake-job.tsx`,
    `guide/schema.tsx`), `triage/auto/research.ts:34`, the retrospective
    procedure template, `docs/box/*.md`, live `beebox/docs/`, three skills,
    `schedules/agent-changes/prompt.md`, `schedules/agent-docs-refresh/run.ts`.
    Leave `implemented-plans/`, `issues/`, and `research/` as history.
  - `ensureBoxDocsLink(boxRoot)` in `docs-gen/box-docs.ts`, called after
    `ensureEngineDocs()`: only when `.gitignore` already has the `_bbxdocs`
    line (so the link never exists in a box that could commit it), create the
    relative link if missing; replace it if it points elsewhere; leave a real
    directory at `_bbxdocs` alone and report it (health check).
  - File modes: `ensurePackageDocs` seals the live directory (files `0444`,
    directory `0555`) as its last step, after the swap. The temporary
    directory stays writable until then. Every stage that changes a sealed
    directory first restores `u+w` on it: removing the old directory after
    the rename swap, the non-atomic `EXDEV` fallback `replaceDirContents`
    (`package-docs/core.ts:274-299`, which deletes the destination's `.hash`
    and moves files in), and the error cleanup (l.251). A `finally` re-seals
    the live directory whatever happened. Tests, as a non-root user: two
    builds in a row; a forced `EXDEV` fallback; a failed swap that leaves the
    live directory sealed and intact. Ordinary writes by any tool or alias
    then fail with EACCES. In production the engine files also belong to
    another user. The
    `.hash` fast path (l.233, "`if (await storedFingerprint(dir) === want)
    return { status: "current" }`") stays; with read-only files an edit needs
    a deliberate `chmod` first.
  - Committing the link: the `.gitignore` line keeps it out of `git add`.
    The managed pre-commit (`validate/pre-commit.ts`) also refuses a staged
    host-area path. A box with its own git hook keeps it
    (`install-validation-hooks.ts:421` leaves foreign hooks alone), so there
    only the ignore line applies and `git add -f` could still commit the
    link; `bbx validate` reports a tracked host area in every box. The
    migration runs `git rm --cached _bbxdocs` when a link was already
    committed.
  - Ordering: the link is created only after the migration has written the
    ignore line. Before that, the guide already names `_bbxdocs/` (it is
    regenerated by the new engine), agents' reads fail, and the health check
    says "run `bbx engine migrate --sweep`". `bbx docs refresh` alone does not fix
    it. The person's reads work throughout, because the server maps the path
    without the link. The docker entrypoint and `deploy.sh` run the sweep
    before serving, so only a dev box that skipped `bbx engine migrate` sees this.
  - `ensurePackageDocs` writes a `README.md` header line "Generated by Bee Box
    from `beebox/docs/box/` and `src/core/docs-gen/`. Read-only; not in box
    git." The same line appears as an HTML comment at the top of each
    generated doc (issue 2026-11-10).
  - `walkEngineDocs` keys hits as `_bbxdocs/<doc>.md`.
  - `package-docs` health check: also errors when the link is missing or
    points elsewhere.
  - `writeBoxGitignore` adds `_bbxdocs` (no trailing slash: `dir/` does not
    match a symlink).
  - Migration `bbxdocs-2026-11`: append `_bbxdocs` to `.gitignore` if absent;
    untrack `_bbxdocs` if tracked; rewrite `node_modules/beebox/box-docs/` to
    `_bbxdocs/` in tracked `.md` and `.card` files; create the link.
    Idempotent.
- **Vocabulary lock-ins:** `bbxdocs/` package directory; migration name.
- **First chunk:** constants, link creation, gitignore, migration, health check,
  with tests. Then the mechanical rewrite as its own commit.

### Track 3 — Write guard for agents

- **What:** guide text that says the area is read-only and not in git, and a
  `PreToolUse` hook that blocks Edit, Write, MultiEdit, and NotebookEdit on
  host-area paths with a message that says where to write instead.
- **Why:** file modes (Track 2) already stop the write; a bare EACCES does
  not tell the agent what to do next. The hook turns the refusal into
  guidance. In dev, `node_modules/beebox` links to the engine checkout, so
  without the modes an edit would land in the engine's build output.
- **Direction:** `bbx validate --pre-hook` reads `tool_input.file_path`,
  resolves it against the box root, and exits 2 with "`_bbxdocs/` is Bee Box's
  own docs: read-only and not in box git. Put your notes in `_content/` or
  `_config/`." when the real path is under the link target.
  `install-validation-hooks.ts` merges the entry next to the `PostToolUse` one.
  The guide's DOCS section (`guide.md:126-140`) states the same rule.
- **Bash and Codex:** the hook does not match them; the file modes stop an
  ordinary write and the shell shows "Permission denied". An agent that runs
  `chmod` or renames the directory first has overridden the rule on purpose;
  this plan does not defend against that.
- **First chunk:** the hook command, the settings merge, and tests.

### Track 4 — Settings links

- **What:** a "Bee Box docs" section in `src/frontend/src/pages/SettingsPage.tsx`
  with two card links: "What's new" (`_bbxdocs/whats-new.md`) and "All docs"
  (`_bbxdocs/README.md`).
- **Why:** the person needs a findable entrance (Design, situation 1).
- **First chunk:** the section and a render test.

### Track 5 — whats-new from the agent-changes schedule

- **What:** the same session writes two files: `agent-changes.md` (unchanged
  bar) and `whats-new.md` (new bar).
- **Why:** one gathering step, one baseline, one cadence. The developer chose a
  peer doc, not a second process.
- **Direction:**
  - `lib.ts`: `isPersonSurface(file)`: `bin/deployed-paths.ts`'s rule minus
    tests and docs, plus the client roots it leaves out (`ios-app/`,
    `beebox-clerk/`; `deployed-paths.ts:21` covers server roots only). Both
    outputs in `OWN_OUTPUT`.
  - `run.ts`: each landing records which filters it passed; the briefing
    groups them. Hand off when either group is non-empty.
  - The prompt requires an explicit outcome for each group: entries written,
    or "no qualifying change" with one line of reason in the handoff. The
    format check proves format only; the outcome line is what shows the
    group was read.
  - `prompt.md`: the person bar. An entry qualifies when a person would notice
    it: a new control, a new thing they can ask for, or a changed behavior that
    would surprise them. Internal work, fixes with no visible change, and dev
    tooling do not. Second person, what the person sees, one line, a "See
    `<doc>.md`" when a doc explains it. Same date-and-hash format.
  - `doc-check/agent-changes.ts`: apply the same format and size limits to
    `whats-new.md`.
  - Seed `docs/box/whats-new.md` with a header ("This list started on
    2026-11-15") and entries from the last two weeks, written by hand at
    implementation time from `git log`.
- **First chunk:** `isPersonSurface`, the two-group briefing, and their tests.

## Could this be simpler?

- **Simplest:** a copy of the docs inside `_content/` written on refresh (the
  `_content/docs/generated/` pattern). No fence change. It fails the
  developer's requirement that the area be read-only, and edits there are lost
  on refresh, the failure in issue 2026-11-10.
- **Simpler still:** no symlink; a virtual route only. Agents would keep
  `node_modules/beebox/box-docs/` and the person `/_bbxdocs/`. The developer
  rejected this: links and files would not extrapolate.
- **Smaller migration:** keep `box-docs` as an alias in the package. Rejected
  by principle 8; the migration rewrites old pointers instead.
- **Deny rules instead of a hook:** fewer lines, but enforcement under bypass
  mode is unverified. File modes do the blocking; the hook only adds the
  message.
- **File modes alone, no fence change for writes:** would stop ordinary writes,
  but API callers would see a raw EACCES. The `read-only` reason costs a few
  lines per route adapter and gives the stated message.

## Subplans

none

## Failure modes

No critical gap remains. An ordinary write by any path or tool fails on file
modes; the named paths add a clear message.

> **Accepted risk:** a same-user agent that deliberately runs `chmod`, renames
> the docs directory, or (in production) replaces the `bbxdocs` entry in the
> box-owned engine shim (`deploy/server-bin/bbx-box-install:25`, l.68-83) can
> change what agents read. The server still serves the real docs to the
> person. Accepted: it needs an agent to defeat a refusal it has just been
> shown, and full isolation would need a separate owner for the package in
> every runtime, including dev.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Box link repointed at `.git` or elsewhere; a read follows it | Track 1 test | Server maps to `PACKAGE_ROOT/bbxdocs`, ignores the link | Clear (reads the real docs) |
| Read escapes the package directory with `..` or a nested symlink | Track 1 test | realpath containment | Clear (refused) |
| Write via `commands.executeSync` / `move` / `trash` / `actions.create` into `_bbxdocs/` | Track 1 test | `assertWritableTarget` | Clear |
| Write via an alias (`node_modules/beebox/bbxdocs/`, a symlink under `_content/`, the share inbox) | Track 2 test (alias create fails) | File modes `0444`/`0555` | Clear (EACCES) |
| Write via the files API | Track 1 test | `reason: "read-only"` | Clear, with message |
| Agent Edit/Write tool on `_bbxdocs/x.md` | Track 3 test | `PreToolUse` exit 2 | Clear |
| Agent Bash write | Track 2 test (modes) | File modes | Clear ("Permission denied") |
| `ensurePackageDocs` cannot replace a read-only old directory | Track 2 test (two builds in a row) | chmod before removal | Clear (build error) |
| Link missing (migration not yet run) | Track 2 test | Health check: "run `bbx engine migrate --sweep`"; agents' reads fail; the person's reads still work | Clear |
| A real directory already at `_bbxdocs` | Track 2 test | Left alone, health check error | Clear |
| Link committed to box git | Track 2 test | Link created only after the ignore line; pre-commit refuses a staged host path; migration untracks | Clear |
| Old pointer in box content after migration (a file the migration skipped) | Migration test | Read fails "file not found"; `agent-changes.md` entry names the rename | Clear |
| Browse lists `_bbxdocs` as a file | Track 1 test | stat-follow for host areas | Clear |
| Session updates `agent-changes.md` and skips a qualifying person change | No (judgment) | Required per-group outcome line in the handoff | Visible in the schedule's run record; the format check cannot catch it |
| An iOS or extension change never becomes a candidate | `lib.test.ts` | Client roots in `isPersonSurface` | Clear |
| Production relative link does not resolve through `.beebox/engine` shim | Manual check on deploy | Health check error | Clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** an agent puts its own notes in `_bbxdocs/`.
  ADDRESSED: Track 3 hook message names `_content/` and `_config/`.
- **Stale ref:** a doc renamed in a later release leaves a dead link in a chat.
  ADDRESSED as for any missing file: "not found". No forwarding.
- **Two agents touching the same card:** not applicable; nothing writes the
  area at runtime except `ensurePackageDocs`, which replaces the package
  directory, with its own swap and fallback.
- **Hand-edit drift:** the person or an agent tries to edit `whats-new.md`.
  ADDRESSED: no edit UI; API refuses; hook refuses.
- **Fabricated free-form value:** the schedule writes an entry for a change the
  person cannot see. ADDRESSED in part: the prompt's bar and the person-surface
  filter; the developer can delete lines. Same review as `agent-changes.md`.
- **Validation error UX:** ADDRESSED: each refusal names the area, says it is
  read-only, and says where to write instead.
- **Partial migration / transition state:** engine updated, migration not yet
  run. ADDRESSED in Track 2, "Ordering": no link until the ignore line
  exists; the health check names `bbx engine migrate --sweep`; the person's reads
  work throughout.

## NOT in scope

- A badge or notice after an update: belongs with the update-detection issue.
- Release tags, version numbers in `whats-new.md`: the release-discipline issue.
- Day-to-day usage docs for the person: the usage-docs issue; this plan only
  gives them a home.
- Fencing `share.saveTextual`, `quick-capture` discard, `publications.*`, and
  `resolveCliTargetPath` callers against symlinks and non-namespace targets in
  general: a pre-existing gap (for example `node_modules/...` as a create
  target), filed as its own issue at implementation. File modes cover the
  package docs directory here.
- A Codex pre-tool hook: file modes already stop the write.
- Moving `_content/docs/generated/` into a host area: different source (the
  box's own content); separate question.
- A Bash write guard.

## Open design questions

- **Codex message:** if Codex supports a blocking pre-tool hook, mirror the
  Track 3 hook in `plugins/beebox-codex/hooks/hooks.json` for the clearer
  message. The write is stopped either way. Lean: check during Track 3; skip
  if unsupported.

## Knowledge audits

New agent-facing concept: `_bbxdocs/` is the docs path, and it is read-only.
Add `knows_directly` entries to `src/dev/knowledge-audits.yaml`:
- `bbxdocs-path`: "Where are Bee Box's own reference docs?" → `_bbxdocs/`.
- `bbxdocs-read-only`: "You want to correct a mistake in `_bbxdocs/triggers.md`.
  What do you do?" → do not edit; note it in the box and tell the person.
- `whats-new-answer`: "The person asks what's new in Bee Box." → reads
  `_bbxdocs/whats-new.md` and links it.
Run each against `~/src/boxes/test1` before landing and record the status.

## What will hold this after it ships

- Fence behavior: unit tests on `verifyBoxNamespaceOnDisk` and
  `resolveCliTargetPath` with a temp box and a real symlink. The read/write
  decision is a pure function of kind and mode (`isHostArea`), tested directly.
- Link and migration: tests on a temp box, including a re-run.
- Hook: a test that pipes a hook payload into `bbx validate --pre-hook` and
  checks the exit code and message.
- Schedule: `lib.test.ts` for `isPersonSurface` and the two-group briefing.
- Doc format: `doc-check` on `whats-new.md`.
- No new test tier.

## Implementation order

1. Track 1 (kind, fence, CLI refusal, browse, validate).
2. Track 2 code (constants, link, gitignore, migration, health check, search
   keys, source header).
3. Track 2 mechanical rewrite (separate commit).
4. Track 3 (hook, settings merge, guide text).
5. Track 5 (schedule filter, prompt, doc-check, seeded `whats-new.md`).
6. Track 4 (Settings section).
7. Knowledge audits, run and recorded. An `agent-changes.md` entry announcing
   the move to `_bbxdocs/`.

Ships as one piece when every chunk is done, and only when the developer says.

## Rollout shape

Done when these pass: the fence tests (read through link; write refused; escape
refused), the CLI refusal test, the link and migration tests (fresh, re-run,
real directory present), the hook test, the schedule `lib.test.ts`, doc-check on
both changelogs, a Settings render test, and `pnpm typecheck` and `pnpm lint`.
Then a browser check in a worktree box: open Settings, follow "What's new",
follow a doc link; confirm `git status` in the box is clean. The migration is
scripted and atomic per box; the sweep runs it on container start and deploy.
