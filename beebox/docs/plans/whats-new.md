---
title: "What's new: a person-facing Bee Box changelog copied into each box"
status: draft
workstream: user-changelog
issues: []
---
# What's new: a person-facing Bee Box changelog copied into each box

The person using a box has no way to learn that Bee Box gained a feature, such
as the Accept control in the composer. This plan adds `whats-new.md`: one dated
line per user-visible change. The engine copies it into each box on docs
refresh, where the person opens it from Settings and the agent reads it when
asked "what's new?". The `agent-changes` schedule writes it alongside
`agent-changes.md`.

**Issues addressed:** none filed for this. Related and left open:
`issues/decisions/2026-07-20-release-discipline-and-update-story.md` ("Still
open: no changelog or release notes"; this covers the person's changelog, not
release notes or update detection) and
`issues/features/2026-08-03-detect-server-update-prompt-client-reload.md` (a
"what's new" prompt after an update would belong there). A general way to show
every Bee Box doc to the person was planned and parked:
[unimplemented-plans/bbxdocs.md](../unimplemented-plans/bbxdocs.md).

## Design

### Situations

- When Priya opens her box after a few days and finds an Accept control in the
  composer she has not seen, I want to see what changed in Bee Box lately, so I
  can try the new control instead of working around it.
- When Priya asks the box "what's new?", I want the answer to come from the
  same list I can open, so the two agree.
- When Odette is in the middle of entering a recipe, I do not want a "What's
  new" banner or badge, so I can finish what I came to do.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| New control noticed | Show when asked | Settings: a "What's new in Bee Box" link opens `_content/docs/generated/whats-new.md` as a markdown card | Waits to be found |
| "What's new?" in chat | Show | The agent reads the same file, answers briefly, links it | Waits to be found |
| Mid-task | Quiet | Nothing | None |

### Spirit

- **Serves:** "It should feel possible": the person learns what they can now do.
- **Risks:** "It should feel like a place": an engine-written file in the
  person's tree. Guard: it sits beside the engine's other generated docs in
  `_content/docs/generated/`, which box git ignores.

### Trust

Shows only, takes no action.

### When it goes wrong or does nothing

- Nothing user-visible landed: the list keeps its last entries; its header
  says when it started.
- An agent edits the box copy: the next refresh replaces it, as for every file
  in `_content/docs/generated/`. Accepted; the same holds for those files today.

### Walkthrough

Priya opens Settings and selects "What's new in Bee Box". The workspace opens
`_content/docs/generated/whats-new.md` through the ordinary files route. The
markdown renderer shows dated lines, newest first; one reads "2026-11-14:
Accept in the composer marks the agent's text as your own." Nothing is written,
and box git is unchanged.

## Smallest fix and budget

The smallest fix is this plan. Estimate, additions plus deletions:

- Copy step in `generateDocs` and the prose-docs exclusion: ~25 source, ~30 test.
- Settings link: ~15 source, ~15 test.
- Schedule: `isPersonSurface`, two-group briefing, prompt section: ~70 source,
  ~40 test.
- doc-check format for the second file: ~15 source, ~15 test.
- Authored docs: the seeded `whats-new.md` (~20 lines), one guide line.

About 225 changed lines. Not a BIG CHANGE.

## Stated preferences this plan trades against

- **Developer decision, 2026-11-16:** "Let's just copy it into the box", after
  the `_bbxdocs` area was judged too complicated "for just exposing one new
  document to the user".
- **Principle 8, one way to do each thing** (`docs/engineering-principles.md`):
  the doc has one source and one path agents and the person use. The source is
  kept out of the package docs index so agents do not see two copies.
- **Box `agent-changes` precedent** (`schedules/agent-changes/`): same format,
  same limits, same landing.

## What already exists

- **Generated box docs.** `DOCS_DIR = "_content/docs/generated"`
  (`src/core/docs-gen/shared.ts:16`), ignored by box git (`guidance-surfaces.ts:72`:
  "`.gitignore` excludes `.beebox/` and `_content/docs/generated/`"). Written by
  `writeStaticDocs` (`src/core/docs-gen/generate/core.ts:402`) with `withDocId`.
  Reuse: one more file in that write.
- **Refresh gate.** `canSkipGeneration` (`generate/core.ts:364`) skips unless
  box inputs or the engine commit changed. A new `whats-new.md` arrives with a
  new engine commit, so the gate refreshes it. Reuse unchanged.
- **Shipped source.** `package.json` `files` includes `"docs/box"`, so
  `docs/box/whats-new.md` is in every install.
- **Package docs index.** `proseDocs` (`package-docs/core.ts:84`) turns every
  `docs/box/*.md` into a package doc and requires `read-when`. Skip
  `whats-new.md` there.
- **Settings.** `src/frontend/src/pages/SettingsPage.tsx:28` `SettingsSections`
  lists sections. `src/frontend/src/components/view-widgets/CardLink.tsx`
  opens a card by path. Reuse.
- **Schedule.** `schedules/agent-changes/lib.ts:8` `OWN_OUTPUT`, l.32
  `isAgentSurface`; `run.ts` gathers first-parent landings and closed issues;
  `prompt.md` holds the bar ("Leave out UI-only changes").
- **Format check.** `src/dev/doc-check/agent-changes.ts` checks entry format,
  order, and limits. Reuse for the second file.

## Prior art (external)

No decision depends on an external premise.

## Ontology

- **`whats-new.md`** (new): dated changes a person would notice. Source
  `beebox/docs/box/whats-new.md`; box copy
  `_content/docs/generated/whats-new.md`. Not `agent-changes.md`, whose bar is
  agent habits.
- **Person surface** (new, schedule only): a repo path whose change can alter
  what the person sees: `bin/deployed-paths.ts`'s shipped paths minus tests and
  docs. The iOS app and the Chrome extension ship separately, on their own
  schedule, so their changes are left out of this box-version list.

## Tracks / scope

### Track 1 — The doc and its copy

- **What:** seed `docs/box/whats-new.md`; copy it into the box; point agents
  at the box copy; link it from Settings.
- **Direction:** a small `copyWhatsNew(boxRoot)` reads
  `<PACKAGE_ROOT>/docs/box/whats-new.md` and writes
  `_content/docs/generated/whats-new.md` with `withDocId` when the bytes
  differ. `generateDocs` calls it before the skip gate, next to
  `ensureEngineDocs()` (`generate/core.ts:435`), so a deleted box copy heals on
  the next refresh even when the engine has not changed.
  `proseDocs` skips `whats-new.md`. The agent guide's DOCS section
  (`src/core/agent-guide/guide.md:136`, next to the `agent-changes.md` line)
  gains: "When the person asks what's new in Bee Box, read
  `_content/docs/generated/whats-new.md` and link it." Settings gets a "Bee
  Box" section with an ordinary link to the card's view URL, built with
  `serializeViewUrl` (`src/frontend/src/lib/view-url.ts:183`). Not
  `CardLink`: it needs a view host (`CardLink.tsx:37` calls `useViewHost()`,
  which throws `ViewHostMissingError` outside one), and Settings has none.
- **First chunk:** the copy, the exclusion, tests that a refresh writes the
  file, rewrites a deleted copy with an unchanged engine, and that the package
  index does not list it.

### Track 2 — The schedule writes it

- **What:** the `agent-changes` session also maintains `whats-new.md`.
- **Direction:**
  - `lib.ts`: `isPersonSurface(file)`; both files in `OWN_OUTPUT`.
  - `run.ts`: each landing records which filters it passed; the briefing lists
    two groups. Hand off when either is non-empty.
  - `prompt.md`: a second bar. An entry qualifies when a person would notice
    it: a new control, a new thing they can ask for, or a changed behavior that
    would surprise them. Leave out internal work, fixes with no visible change,
    and dev tooling. Second person; what the person sees; one line. The session
    states an outcome for each group in its alert: entries written, or "no
    qualifying change". Authority widens to the two files.
  - `doc-check`: same format and limits for `whats-new.md`. The limits are the
    check's (`src/dev/doc-check/agent-changes.ts:10-11`: 12 entries in any 10
    days); the prompt's stale "10 entries" is corrected in the same edit.
  - Baseline: the schedule's existing baseline sha is shared. The seeded
    entries cover landings up to that sha, so nothing falls between them.
- **First chunk:** `isPersonSurface`, the two-group briefing, tests.

## Could this be simpler?

Simpler: no copy; the agent reads the package doc when asked. The person could
not open it, which is the point of the request. Simpler still: link to
beebox.run; that page shows `main`, not the box's version, and is not a card.
This plan is the smallest version that is a card.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Source missing from an install (files list changed) | Track 1 test | `writeStaticDocs` fails the refresh | Clear |
| Box copy edited by an agent | No | Next engine update overwrites it | Silent; accepted, as for all generated docs |
| Session skips a qualifying person change | No (judgment) | Per-group outcome in the alert | Visible in the alert |
| Box copy deleted, engine unchanged | Track 1 test | Copy runs before the skip gate | Clear (healed on next refresh) |

## Agent-flow / user-flow edge cases

- **Wrong file:** the agent answers "what's new" from `agent-changes.md`.
  ADDRESSED: the guide line names the file for that question.
- **Stale ref:** none; the path is fixed.
- **Two agents:** none write it at runtime.
- **Hand-edit drift:** see Failure modes; accepted.
- **Fabricated value:** an entry for a change the person cannot see.
  ADDRESSED in part by the bar and the filter; the developer can delete lines.
- **Validation error UX:** doc-check messages as for `agent-changes.md`.
- **Transition:** a box on an old engine has no copy and the guide does not
  mention it. Nothing breaks.

## NOT in scope

- Showing other Bee Box docs to the person: parked in `bbxdocs.md`.
- A badge or notice after an update: the update-detection issue.
- Release tags and version numbers: the release-discipline issue.

## Open design questions

none

## Knowledge audits

One `knows_directly` entry in `src/dev/knowledge-audits.yaml`:
`whats-new-answer`, "The person asks what's new in Bee Box" → reads
`_content/docs/generated/whats-new.md` and links it. Run against
`~/src/boxes/test1` before landing.

## What will hold this after it ships

Unit tests for the copy and the exclusion; `lib.test.ts` for the schedule
filter and briefing; doc-check for the format. No new test tier.

## Implementation order

1. Track 1, with the seeded doc.
2. Track 2.
3. The knowledge audit, run and recorded.

## Rollout shape

Done when the copy test, the `lib.test.ts` cases, and doc-check pass, along with
`pnpm typecheck` and `pnpm lint`. Then open Settings in a worktree box, follow
the link, and confirm box `git status` is clean. No migration: the next docs
refresh writes the file.
