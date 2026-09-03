---
title: "The rename moved the state directory to `.beebox/` but left every box's pre-rename `.gitignore`, so boxes now commit their state dir, locks, pid file, and secrets"
workstream: unattached
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
  is not a box. Whether the marker belongs in the state directory at all is
  the box-layout question the `box-layout-criteria` workstream owns
  (`issues/code-quality/2026-08-17-package-root-vs-content-dir-keeps-causing-bugs.md`);
  cite this as evidence there rather than deciding it here.
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
3. Decide the marker question with the layout workstream.

Related: `issues/decisions/2026-08-30-rethink-box-autocommit.md` (autocommit
sweeping in whatever is unignored is the mechanism that made this bite).
