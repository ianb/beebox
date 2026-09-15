---
title: "The v2→v3 one-root migration cannot migrate a real v2 box: four distinct blockers on the two that remain"
workstream: unattached
area: beebox
labels: [git, migration]
filed-by: agent
discovered-by: agent
discovered-in: worktree-full-embrace-annex — converting the last manifest-scheme boxes
resolution: wontfix
---

> **Closed wontfix, 2026-09-14.** Boxholder: *"meta-cb and tech-talk should be
> purged, that's why they aren't converted."* Both were moved aside the same
> day — `meta-cb` to `~/src/boxes/purged/`, `tech-talk` to the server's
> `/home/beebox/purged-boxes/` (it was already absent from the hub registry).
>
> That empties the v2 population. Every box that exists is shapeVersion 3, so
> the migrator has nothing left to migrate and none of the four blockers below
> is reachable. They are recorded because the migrator is still in the codebase:
> anyone who revives it, or who finds an old v2 box in a backup, meets these
> four before anything works.
>
> The follow-on question — whether `scripts/migrate/one-root.ts`,
> `src/core/migrations/one-root-v2-probe.ts`, and the `one-root` migration entry
> should now be deleted as dead code — is not decided here.


Every v2 box tried refuses or crashes. Two boxes were attempted — `about` and
`meta-cb` — and between them they hit four distinct failures. `about` was
eventually migrated by hand-working around its two; `meta-cb` is still v2.

Each failure rolls back cleanly and leaves the box intact at its prior commit
with a clean tree. That part works and was verified after every attempt.

## The four blockers

**1. A symlink whose target has no move mapping.** `content/CLAUDE.md` is
classified `merge-claude-md` (`src/core/migrations/one-root-move-plan.ts:165`),
which merges its text rather than moving the file, so the symlink resolver finds
no destination:

```
_content/AGENTS.md: symlink target "CLAUDE.md" resolves to <box>/content/CLAUDE.md,
which has no v3 mapping (directory-level or exact) — refusing to migrate rather
than leave it dangling.
```

`AGENTS.md -> CLAUDE.md` appears to be stock — the v2 package root carries the
same pair — so this likely blocks every v2 box. Worked around on `about` by
deleting the symlink; the root `AGENTS.md -> CLAUDE.md` survives conversion.

**2. A duplicated, unmarked asset ignore block.** The migration appends a
second, path-anchored copy of the asset ignore rules
(`/_content/**/*.attach/**/*.jpg`) with no managed-block marker, alongside the
original marked block. `bbx attachments unignore` rewrites only the marked one,
detects the other, and refuses — so the box cannot reach the annex through the
supported path. Seventeen unmanaged rules, removed by hand on `about`.

This is the same failure family as `c47fd2be1`: an asset ignore rule in a
spelling the managed-block machinery does not recognize. It fails closed here,
which is the better direction, but it blocks conversion and the hand edit it
demands is exactly the step an operator can get wrong.

**3. Destination collisions on placeholder files.**

```
Found 2 v3 destination collision(s) — refusing to migrate rather than silently
overwrite one source with another:
  src/tricks/lib/.gitkeep (from tricks/lib/.gitkeep) already exists at its destination
  src/tricks/scripts/.gitkeep (from tricks/scripts/.gitkeep) already exists at its destination
```

Both files are empty. Refusing on a zero-byte placeholder collision is
over-strict — two empty `.gitkeep`s are interchangeable by construction.

**4. An ENOENT crash, not a refusal.** After working around 3, `meta-cb` failed
with:

```
ENOENT: no such file or directory, lstat
'<box>/_config/_template-updates/src/schemas/CLAUDE.md'
```

This one is a thrown error rather than a checked refusal, so it is a different
class from the other three. The migrator plans a move for a path that is not
there when it runs.

## How much this matters

Little, today, and that is the open question rather than a settled answer.
Every box in service is v3: all six production boxes and every local box except
`meta-cb`. The remaining v2 population is two dormant boxes — `meta-cb` (a local
scratch box, 24 commits, last touched 2026-09-04) and `tech-talk` (archived on
the production server, not served).

So there are two honest dispositions, and the choice is the boxholder's:

- **Retire the two v2 boxes**, at which point the migrator is dead code and can
  be deleted along with `one-root-v2-probe.ts` and the `one-root` migration
  entry. This matches the full-embrace-annex posture — make the invariant true
  rather than maintain an accommodation nobody uses.
- **Fix the four blockers**, if either box is worth keeping in a migratable
  state.

Nothing in service depends on the answer.

Supersedes the separate symlink issue filed the same day
(`2026-09-14-one-root-migration-refuses-claude-md-symlink.md`), which is
blocker 1 above.
