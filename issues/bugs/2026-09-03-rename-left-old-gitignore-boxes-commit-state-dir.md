---
title: "The rename moved the state directory to `.beebox/` but left every box's pre-rename `.gitignore`, so boxes now commit their state dir, locks, pid file, and secrets"
workstream: box-state-not-tracked
area: beebox
priority: important
labels: [box-shape, git, privacy]
filed-by: agent
discovered-by: Ian
discovered-in: main session — a `git reset --hard` on a local box reverted its chat registry and broke the open chat
---

## What happened

The boxholder reset a local box's `main` to an older commit. The chat that
was open then failed with an internal error: the box's `.beebox/` state
directory is committed in that box, so the reset also rewound the chat
registry to before the open session existed, the box treated the unknown
session as its default engine, and the Codex history request failed. Four
registry files restored from the dropped commit fixed it. The reset was the
trigger; the defect is that the state directory was ever tracked.

## Why it is tracked

The 2026-08-30 rename moved the state directory to `.beebox/`
(`src/lib/state-migration.ts`, run automatically) and the lock and pid files
to the `.bbx-*` prefix; the former names are in `docs/name-history.md`. The
stock ignore file that `bbx init` writes (`src/core/box/index.ts`, "Always
write .gitignore") knows the new names. Nothing re-ran `bbx init` on existing
boxes, and the state migration does not touch `.gitignore`, so every migrated
box still carries the pre-rename file: its header names the former product,
its state-directory rule names the former directory, and its lock and pid
rules use the former prefix. None of those match anything any more. The next
`git add -A` autocommit sweeps the whole state directory in.

## Inventory, 2026-09-03

Every box was checked (six local, six production, tracked files by category).

- **One local box** has already committed it: 180 files under `.beebox/`
  including the chat registry, active-chat locks, `events.db` with its WAL
  and SHM, `usage.db`, the search index, `hub-child.log`, `client-debug.log`,
  a mobile-devices secret file and a mobile-session secret, plus
  `.bbx-serve.pid` and `.bbx-trick-commit.lock` at the box root. The secrets
  are in that box's git history now; the repo is local-only.
- **The primary test box** has 41 state files untracked and unignored, one
  autocommit away from the same state.
- **Every production box** tracks exactly one state file, `.beebox/box.json`,
  the shape marker, and has one box with a pending unignored file. Five of
  six still have the pre-rename ignore file; the sixth had `bbx init` run
  since the rename and has the new one.
- The log-like files outside `.beebox/` (`config/migrations.jsonl`,
  `store/usage/session-manifest.jsonl`) are content and belong. Three boxes
  also carry a hidden `config/.migrations.jsonl` beside the real one that no
  code references; separate residue, worth a look.

## What to decide

The boxholder's question: should the box be resilient to this, or should
the state simply never be tracked, or both. Locks in particular have no
business in a commit. Pieces of the answer:

- **Locks, pids, databases, logs, secrets: never tracked.** No design
  question there. The ignore file already says so once it is regenerated.
- **The marker.** `.beebox/box.json` is tracked on every production box only
  because the migration created it while the ignore file still named the
  former directory. With the new ignore rule a fresh clone has no marker and
  is not a box. Whether the marker belongs in the state directory at all was
  deferred to the `box-layout-criteria` workstream
  (`issues/closed/code-quality/2026-08-17-package-root-vs-content-dir-keeps-causing-bugs.md`,
  since closed by the one-root layout). That workstream no longer exists —
  settled below, "The marker decision, 2026-09-13".
- **The chat registry.** Session history, models, and turn markers are state
  the box needs to keep across a content revert. Untracked is the simple
  answer and matches the stock ignore. If any of it should survive a clone,
  that is a deliberate export, not a side effect of autocommit.
- **Resilience.** Even untracked, a session the registry does not know
  should not become "Codex history request failed": the fallback engine for
  an unknown session is a guess, and the guess failed loudly at the wrong
  layer. A session id with no record should say so.

## The fix, in order

1. Make the state migration (or `bbx migrate`) regenerate `.gitignore` the
   way `bbx init` does, so a rename never leaves an ignore file behind again;
   check the `attachments-gitignore` block survives.
2. On each affected box: regenerate the ignore file, `git rm -r --cached`
   the state directory, locks, and pid, commit. For the box that committed
   secrets, rotate what can be rotated (re-pair mobile devices) since the
   values stay in history.
3. Decide the marker question. Decided — see "The marker decision, 2026-09-13";
   the implementation is what remains.

Related: `issues/decisions/2026-08-30-rethink-box-autocommit.md` (autocommit
sweeping in whatever is unignored is the mechanism that made this bite).

> 2026-09-03 progress (main session): two migrations landed, `gitignore-2026-09`
> (`scripts/migrate/box-gitignore.ts`; regenerates `.gitignore` via the now
> exported `writeBoxGitignore`, untracks the state dir, box-root locks, and
> pid from an allowlist, keeps `.beebox/box.json`) and `hooks-2026-09`
> (`scripts/migrate/box-hooks.ts`; reinstalls the managed git hooks, which
> still pointed at the former CLI). The state migration now removes an EMPTY
> canonical directory instead of refusing (two local boxes and one worktree
> launch were stuck on that). All six local boxes converged and committed;
> the box that had committed its state has 182 files untracked, the marker
> kept. Production converges through the deploy sweep. Still open here: the
> marker question (layout workstream), the resilience ask for unknown session
> ids, and the hidden `config/.migrations.jsonl` residue.

## The marker decision, 2026-09-13

The `box-layout-criteria` workstream that this was deferred to no longer exists,
so it is settled here. Two findings decided it.

**No local box tracks the marker any more.** All six of `~/src/boxes/*` have
`.beebox/box.json` untracked. `scripts/migrate/box-gitignore.ts` keeps it in
`KEEP_TRACKED` and justifies that with "it is tracked on every production box
today", which is no longer true locally for any box — and `.gitignore` ignores
`.beebox/` as a directory, so nothing re-tracks it (a `!.beebox/box.json`
negation cannot work against an ignored directory). The `sdk-update` failure was
not a one-off: every local box is one clone away from it, held off only by the
`cp box.json` in `bin/lib/worktree-create.sh`.

**`_config/box.json` already exists and is already tracked** — timezone,
allowedEmails, googleServices, agentBrowsing. A box therefore has two files
named `box.json`, one tracked config and one untracked identity.

The marker's three fields settle where it belongs. `version: "1.0.0"` is a
hardcoded literal that reaches the dashboard as "v1.0.0" (`core/state.ts:145` →
`SystemInfo.tsx:23`); `created` is the box's birth date; `shapeVersion`
describes the layout of the TRACKED tree. None of the three is machine-local.
The marker is not state, and it sits in the state directory because the
2026-08-30 rename needed somewhere hidden to put it.

### What to do

Split identity from layout version; they have different costs.

**Identity** — "is this directory a box?" — moves off the marker entirely.
`isValidBox` (`core/box/index.ts:323`), `detectBoxTarget`
(`core/box/package.ts:89`) and `scheduler.isBox` (`core/schedule/scheduler.ts:45`)
all `fs.access` the marker. The tracked answer already exists and `getBoxShape`
already reads it: `package.json` declaring a `beebox` dependency (or the retired
name `LEGACY_PACKAGE_NAME` still accepts — `docs/name-history.md`). Make the
predicate that dependency AND a structural
sibling (`_config/` at the same root; `content/config/` for v2). Nothing in the
monorepo declares a `beebox` dependency, so the dependency alone does not
false-positive here, but `findBoxRoot` walks up from an arbitrary cwd and the
extra stat costs nothing. This is the half that fixes the clone breakage and
retires the `worktree-create.sh` workaround.

**Layout version** — keep `shapeVersion`, move it to tracked space, as a
`"beebox": { "shapeVersion": 3, "created": "…" }` block in `package.json`. Not
in `_config/box.json`: `_config/` is itself a shape-dependent path, so answering
"which shape am I?" from inside it is circular, while the package root is the
root in every shape. `version: "1.0.0"` dies with the marker. Keep the
forward-compatibility refusal (`NewerShapeRequiredError`) — an older engine
opening a v4 box should still refuse rather than proceed.

**Migration.** This cannot go in the manifest-driven `MIGRATIONS` list:
`getBoxShape`/`findBoxRoot` must resolve the box before `bbx migrate` can run.
Read tracked-first with a fallback chain (`package.json` block → `.beebox/box.json`
→ the v2 probe); WRITE the tracked field in `bbx init` and in a new listed
migration that also `git rm --cached`s the marker where it is still tracked and
then deletes it; drop the fallback once the fleet converges. The alternative —
writing `package.json` from inside `migrateBoxState` — puts a tracked-file write
on a lazily-invoked resolver path that autocommit then sweeps, and is rejected
for that reason.

### What it touches

Beyond the three predicates: `lib/paths.ts:56,95` duplicates both `BOX_MARKER`
and the minimum-version constant, so there are two resolvers to change in
lockstep (worth collapsing while in there);
`workstreams-app/src/router/box-entry.ts:58-146` reads the marker and branches on
`shapeVersion === 2` for slug derivation; `schedules/cross-box-leak-scan/box-manifest.ts:39`;
`beebox/deploy/add-box.sh:373`; `deploy/deploy.sh:722`; `docker/entrypoint.sh:41`;
and roughly twenty test fixtures and doctests that hand-write markers.
`feedback-review/collect.ts:25` keys on the `.beebox` DIRECTORY and is
unaffected. Verification has to include a fresh clone of a box becoming a box,
not only green unit tests.

## Resilience for an unknown session id — done 2026-09-13

Fixed. `resolveRecordedChatEngine` (`core/chat/session/engine.ts`) separates
"nothing recorded this session" from "the box default happens to be this", and
the two reads that hand the answer to an engine (`loadSessionHistory`,
`resolveSessionAvailability`) use it; an unrecorded id resolves from the local
transcript file and never reaches Codex. Two things fell out of it. A clean "no
transcript here" from bootstrap used to depend on Codex's error WORDING, because
an unrecorded id was routed to Codex and only a recognized phrasing became a
`false`. And `CodexHistoryRpcError`'s user-visible `message` omitted the RPC
message it held on a field beside it, which is why the banner said only "Codex
history request failed" — it now carries the operation and the RPC message.

`test/webapp/chat-reservation-restart.doctest.md` asserted the broken behavior:
its prose narrated this exact mechanism and expected the throw. Worth noting
that the hazard was written down as expected output rather than filed.

## The `_config/.migrations.jsonl` residue — done 2026-09-13

Nothing writes it. It was the manifest's ORIGINAL name, seeded by hand on
2026-05-24 (box commit `1f8c8ff5`, "Seed migration manifest (mark all
applied)", 19 lines); the live manifest is `_config/migrations.jsonl`. The two
commits that touched it since (`box-packageify`, `one-root`) only relocated it
with the rest of the tree, and its mtime never moved off the seeding date. No
code references the dotted name. Removed from test1, the only local box still
carrying it. Production boxes may still have one; it is inert, and no migration
was added for a dead 19-line file.

## Still open

- The marker change itself, per the decision above.
- **The secrets.** The fix list said to rotate what was rotatable on the box
  that committed a mobile-devices secret and a mobile-session secret, since the
  values remain in that box's history. No progress note records that happening.
  Needs the boxholder: whether the mobile devices were re-paired, and whether
  that box's history gets rewritten or left as is (it is local-only, which
  lowers the stakes without removing them).


> 2026-09-05 (main session): more evidence for the marker question. The
> marker now lives in the gitignored `.beebox/`, so a box clone that lacks
> it — the `sdk-update` worktree's `test1` clone had none — is not a box to
> `detectBoxTarget`, and `bbx init` on it (which `bin/lib/worktree-create.sh`
> runs to refresh hooks) refuses with "already has a package.json". That
> blocked the scheduled `sdk-update` run twice tonight ("could not create the
> worktree"). Unblocked by copying `box.json` into the clone; the durable
> answer is the marker decision (a box package should be recognizable from
> tracked files — its `package.json` names `beebox` — not only from a
> gitignored marker).
