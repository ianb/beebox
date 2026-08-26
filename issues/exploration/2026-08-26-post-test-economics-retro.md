---
title: "Retro, first day under change-based selection: eleven incidents, five improvements — keep the speed"
workstream: unattached
area: monorepo
labels: [tests, schedules, codex]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "look through what went on and how we can improve; I don't want to revert"
---

Boxholder's framing (2026-08-26): the new speed is great; improve, don't revert.

## Incidents (2026-08-25/26)

1. Schedule tick dead for a day — empty unmarked store dir refused; no alert
   possible because alerts live in the store (`a4d328ea`).
2. Full-suite red reports could not be filed — tap excerpt carried home paths,
   path-leak-check refused the commit, twice (`133c38d7`).
3. SPA-fallback doctests depended on gitignored `src/frontend/dist`; 46 ledger
   failures classed as flake for weeks (`0d4db556`).
4. Codex plugin installer re-pointed the user's global marketplace at the
   full-suite temp checkout; every codex box's place menu dead, hourly; the
   installer cannot self-repair (`2026-08-26-codex-plugin-installer-hijacks-global-marketplace`, in flight).
5. `test/field-test/run.doctest.md` red on main after `a6d93a90` — careful tier
   never runs pre-merge; selection cannot see an on-disk config dependency.
   Caught by the hourly run in 30 min (the intended trade).
6. Second hourly bisect blamed the next landing because the baseline had moved.
7. Codex emitted an item type outside the SDK's union; no `default`, turn died,
   the finalize swap dropped the streamed reply (`81b5cc81`).
8. Three sessions launched with `--issue <path> -` as their briefing —
   options after the worktree name were swallowed (`621957b7`).
9. `workstreams resume` starts a fresh Claude session though the transcript
   survives on disk (`resume-continues-session`, in flight).
10. A survey subagent fabricated file:line evidence for a section it had
    delegated and never received; it self-retracted.
11. Schedule desktop notifications are not sticky
    (`2026-08-25-schedule-alerts-desktop-notifications-are-not-sticky`).

Only 5–6 are caused by selection; 5 is the accepted trade. The rest were
latent and now surface at the hourly run or on the live box instead of in
someone's worktree.

## Improvements, in order

1. **The hourly run is the safety net; make it rock-solid.** Self-test its
   filing against a real tap excerpt; carry known-red files forward so a new
   landing is not blamed for an inherited failure; route "cannot start / cannot
   file" through a channel that depends on neither the store nor a git commit.
2. **Inventory the world state tests can touch; isolate each.** `.taprc`
   already isolates secrets and origin-id; add `CODEX_HOME` (in flight), audit
   `~/.claude`, `~/.config/cb`, launchd, build artifacts. A test that needs a
   real-world thing declares it. Fewer runs make environment drift surface
   later, so this matters more under selection, not less.
3. **Close the selection blind spot with data.** Implicated careful-tier tests
   run pre-merge (only unimplicated ones defer). The ledger's "missed" class
   becomes proposed spawner edges automatically.
4. **Degrade, don't die, at external boundaries.** Exhaustive switch WITH a
   default that skips and warns once; UI keeps the streamed bubble when the
   authoritative entry never arrives; error copy names the layer that failed
   (the menu said "landmarks" for a Codex plugin failure).
5. **Process.** Launcher now refuses options after the name; `cb-pick-issues`
   bare invocation stops to ask; briefings carry understanding. Add: a subagent
   that cites `file:line` must have opened the file.

The parked smoke tier (`2026-08-26-merge-time-smoke-tier`) would have caught
3, 4 and 7 within the hour; revisit once 1–2 land.
