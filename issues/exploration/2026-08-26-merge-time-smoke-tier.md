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

Not scheduled — the boxholder wants to see how change-based selection settles
first (2026-08-26). Parked here so the shape isn't lost.

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
