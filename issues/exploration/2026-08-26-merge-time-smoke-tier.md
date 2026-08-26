---
title: "A smoke tier at merge and deploy: boot a real box and click, because two of today's escapes were state bugs no unit tier can see"
workstream: unattached
area: callback-box
needs: [design]
labels: [tests]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "seems like we might be missing a standard smoke test to be run on merge?"
---

Unparked the same day: after the retro
(`2026-08-26-post-test-economics-retro`) the boxholder's position is that
**every code-related merge to main should run a smoke test.** Docs-only
landings are exempt (the deploy hook's "deployed paths" rule is the precedent
for that distinction).

Two escapes on 2026-08-25/26 passed every existing gate because the code was
right and the *state* was wrong: the SPA fallback that only installs when a
build artifact exists (`test/fixtures/frontend-dist` fixed the test side), and
the place menu failing on every codex box because another process had broken
global `~/.codex` state (`2026-08-26-codex-plugin-installer-hijacks-global-marketplace`).
Only a real box on the real machine shows either.

What exists: `/finish` verification is typecheck + lint + `test:changed`
(`bin/finish-preflight-lib.ts`) — fixture boxes, nothing boots the app.
`deploy.sh` has `/healthz` + a `/healthz/canary` cold-start — post-deploy,
server-level, "a box serves". `test/tours/*.tour.ts` (dashboard, nav-pages,
new-chat, capture, browse-walk) are browser walks with a11y + screenshot
checkpoints, wired to nothing: no script, no `/finish` step, no schedule.

Shape: a short tour (nav-pages, open the place menu, open one chat) driven by
`bin/browse` against a real box, hard-fail, never graph-selected, two-minute
budget. Two hooks: after the merge in `/finish` against the main checkout on the
dev router; post-deploy against prod in the canary slot. Belongs to the
test-economics scheme as its own tier (`careful.txt` is the precedent for a
tier expressed as a list).

## Research: the existing tours have already rotted (2026-08-26)

Ran all five in the `tab-identity` worktree, against its own box clone, to
see whether "wired to nothing" had cost anything yet. It has.

All five still **execute** — the framework has not bit-rotted in the three
months since it landed. But three of the five are failing their own soft
assertions and aborting after one checkpoint:

- `browse-walk` — `pass aborted: Could not resolve button "box directory, 3357 items"`
- `dashboard` — `expected button "+ Memo" not found in interactive snapshot`
- `capture` — `expected button "Cancel capture session" not found in interactive snapshot`

`nav-pages` (10 checkpoints) and `new-chat` (2) still walk clean, with 2 axe
violations each.

Two things this settles for the tier proposed above.

**It is evidence for the tier.** An instrument nobody runs decays silently and
nobody learns anything from it; these have been degraded for weeks with no
signal. Whatever gets built has to run on its own or it becomes this.

**It is also a warning about how to write it.** Not all three failures are app
regressions — `browse-walk` hardcoded an item COUNT into a selector
(`"box directory, 3357 items"`), so it breaks whenever the box's contents
change, and the findings above are partly box-state artifacts rather than
defects. A hard-fail smoke tier written with content-coupled selectors like
that fails every week for reasons nobody cares about, gets ignored, and ends
up exactly where the tours are — except now it is also blocking merges. The
selectors need to be stable app addresses (`cb-` ids), and the fixture box
stable, before anything hard-fails on them.

Worth deciding as part of this issue: whether the existing five tours are
repaired, retired, or left as the review instrument they are.
