---
title: "A smoke tier at merge and deploy: boot a real box and click, because two of today's escapes were state bugs no unit tier can see"
workstream: smoke-tier
area: callback-box
labels: [tests]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "seems like we might be missing a standard smoke test to be run on merge?"
resolution: implemented
---

**Closed 2026-08-26**, by `worktree-smoke-tier`: `bin/smoke` boots a real box
through the dev router and walks it with `bin/browse` (nav-pages, place menu,
one chat), wired into `/finish` as a `kind: "smoke"` step whenever a landing
touches a deployed path (`bin/finish-preflight-lib.ts`,
`bin/deployed-paths.ts`); `callback-box/deploy/deploy.sh` keeps the
post-deploy `/healthz` + `/healthz/canary` hooks against prod. Per-run
history lands in a shared log (`bin/smoke --report`), and
`schedules/smoke-review/` reviews weekly whether each step still earns its
place.

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
