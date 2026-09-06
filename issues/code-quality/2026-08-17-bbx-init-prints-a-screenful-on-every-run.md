---
title: "`bbx init` prints a screenful of routine success on every run, including when scripted"
workstream: transition-cleanup
area: beebox
labels: [output-noise]
filed-by: agent
discovered-by: agent
discovered-in: worktree-add-box-process — provisioning a box ran bbx init twice
priority: important
---

`bbx init` reports everything it did, every time, whether or not anything
changed. A single re-init prints roughly fifteen lines:

```
Updated beebox at <box>/content
  Ensured standard directories exist
  Updated .gitignore

Linked .claude/memory/ → ~/.claude/projects/ (auto-memory now git-tracked)

Generated 50 card rules in .claude/rules/
Installed 8 skill(s) in .claude/skills/: build-course, calendar, drive, ...
Generated agent docs in .beebox/ and docs/generated/
building search index over 18 files...
Built search index in .beebox/

Run 'bbx status' to see the current state.
```

None of it is an anomaly. It is a list of steps that succeeded, and the
monorepo's own rule is that routine-success output should print nothing —
noisy output costs agent context every time it appears
(root `CLAUDE.md`, "Treat noisy command output as a bug").

## Why it showed up now

`deploy/add-box.sh --create` runs `bbx init` twice: once locally to scaffold the
box, once on the server after cloning it. So provisioning one box emits this
block twice, inside output the operator is reading for the parts that matter
(what was registered, whether the canary passed). The signal is in there; it is
just outnumbered.

`bbx init` is also invoked by other scripted paths, so this is not specific to
provisioning.

## The tension

This output is *good* when a person runs `bbx init` interactively on a new box.
"Installed 8 skills", "Generated 50 card rules" is exactly what you want to see
the first time — it tells you the scaffold worked and what you got. Deleting it
outright would make a genuinely useful first-run experience worse.

So the split is probably not "quiet vs loud" but **fresh vs re-init**:

- A **fresh** init legitimately has a lot to report. Keep it.
- A **re-init that changed nothing** has nothing to report and should say
  nothing, or one line. The code already distinguishes these —
  `announceAndInitGit` (`src/cli/commands/init.ts:38`) branches on
  `isFresh`/`isUpdate`, and the update
  branch is already the shorter one; it is just still several lines, and the
  steps after it print unconditionally.

A `--quiet` flag for scripted callers is the smaller, dumber alternative. It
works, but it puts the decision on every caller and leaves the default wrong,
so it is worth trying the fresh-vs-re-init split first.

Worth checking while in there: `building search index over 18 files...` is
lowercase where its neighbours are sentence-case, and reports progress for an
operation that then reports completion on the next line.
