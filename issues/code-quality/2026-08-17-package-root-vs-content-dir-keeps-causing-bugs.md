---
title: "Package root vs `content/`: one box has two roots, and callers keep picking the wrong one"
workstream: box-layout-criteria
area: beebox
labels: [box-shape]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-add-box-process — three instances of this bug in one work unit
---

A v2 box has two roots. The **package root** holds `package.json`, `src/`, and
`.claude/`. The **box root** is `content/`, and holds `.bbx-box` plus everything
an agent sees. See [`box-layout.md`](../../beebox/docs/box-layout.md).

Every interface that takes "a box path" must therefore say which root it means,
and they do not agree. Callers guess, and the guess is silent: both paths exist,
both look plausible, and picking the wrong one fails somewhere else — or not at
all until later.

The boxholder's framing when asking for this item: the file tree is just hard to
understand. That is the real issue. The bugs below are symptoms.

## The evidence: four instances, one family

Three landed in a single work unit on 2026-08-17
([add-box.sh](../bugs/2026-08-17-add-box-script-targets-a-service-that-no-longer-exists.md)):

1. `deploy/add-box.sh` wrote access config and connector secrets to
   `<package-root>/config/`. That directory does not exist — `config/` is under
   `content/`. On a fresh box the write crashed the remote script. Caught by a
   cross-model review, not by a test.
2. The same script passed the package root to `bbx boxes add`, which checks for
   `.bbx-box` at the path it is given (`src/cli/commands/boxes.ts:30`, via
   `isBox` at `src/core/schedule/scheduler.ts:56`). It failed on the first real
   run against the server.
3. The two manifests take **different** roots, which is what produced (2):
   `hub.json` holds package roots, `boxes.json` holds `content/` dirs. Nothing
   states this; it is only visible by reading existing entries.

The fourth is older and already closed:
[slug derived from `basename(boxRoot)`](../closed/bugs/2026-07-11-v2-box-slug-from-boxroot-basename.md)
was the same mistake — every v2 box slugged as the literal string `content`.
It was fixed by collapsing every derivation into one helper,
`src/lib/box-slug.ts`. That fix worked and has not regressed, which is a useful
signal about what kind of fix works here.

## What makes it likely to recur

- **The resolver that gets it right is in the wrong place.** `resolveBoxRoot`
  (`src/hub/child-spawn.ts:74`) accepts either root and returns the box root.
  It is the correct answer, but it lives in the hub package, so code outside
  the hub either imports across a layer boundary or reimplements the check.
  Two non-hub callers already reach in: `src/cli/commands/hub.ts:26` and
  `src/field-test/run-box.ts:26`.
- **Bilingual is the exception, not the default.** The hub accepts either root
  deliberately. `bbx boxes add`/`remove` do not. A caller cannot know which
  behavior a given command has without reading it.
- **Nothing fails loudly at the boundary.** Handing `config/box.json` a package
  root produces a stray directory or an ENOENT deep in a script, not "you gave
  me the wrong root".

## Directions, none decided

The narrow, obvious pieces:

- Move `resolveBoxRoot` to `src/lib/` (it needs only `path` + `fileExists`, so
  there is no cycle risk) and repoint its callers, per the rule that `src/lib/`
  is the single home for cross-cutting helpers.
- Make `bbx boxes add`/`remove` bilingual, so both manifest-writing commands
  behave the same way. Note the stored value should stay the box root —
  existing `boxes.json` entries are all `content/` dirs.

The wider question, which is the one actually worth thinking about, and which
should be settled before doing the narrow pieces in case they become moot:

- Should a "box path" be a **type** rather than a string, so a package root and
  a box root cannot be passed to the same parameter? `src/lib/box-shape.ts`
  already returns a `BoxShape` with both roots resolved — the pieces exist; what
  is missing is any pressure to use them at boundaries.
- Should the two manifests agree on one form, with a migration for the one that
  changes? They disagree for no stated reason.
- Is the two-root layout itself worth revisiting, or is it load-bearing? It
  exists so a box can be an installable package with its own dependencies while
  the operational content stays a clean tree. That is a real constraint, so the
  answer may be "keep it, make it legible" rather than "collapse it".

## Research (incomplete)

Not yet done: an audit of every site that takes a box path as a string and which
root each expects. That inventory is what would say whether this is three sharp
edges or a systemic naming problem. `grep -rn "boxRoot\|packageRoot\|boxPath"
beebox/src/` is the starting point.
