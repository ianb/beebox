---
title: "Chat shows 'Agent is working…' long after the turn finished; Recent files / landmarks deny the saved card meanwhile"
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — field-test v0 spine run (Priya, save-recipe)
labels: [soft-launch, field-test-findings, code-error]
---

In the v0 field-test spine run, the box agent finished saving a recipe card
(the card existed on disk — the run's hard check passed), but the chat UI kept
showing **"Agent is working…"** for 20+ minutes afterward, twice. During that
window the operator went looking for reassurance and both "Recent files" and
"All landmarks" showed nothing saved — a false negative at the exact moment
the save had succeeded. A reload then appeared to lose the in-flight question
entirely. The operator only saw the success because it wandered elsewhere in
the app and came back.

The operator's summary line is the tension exactly: "for most people this
would present as blocked, and the gap between those two outcomes is one
status indicator." A real user closes the tab at minute twelve, tells a
friend the app is broken, and is wrong.

Context to reproduce/investigate: dedicated `cb serve <box> --port <p>` on a
fresh field box (not the dev router), browse-key-authenticated headless
browser, real chat turn that writes a card. Suspects worth checking: turn-done
events not reaching this client (WS subscription vs the browse-key cookie on
the upgrade?), the streaming status never clearing when the SDK result arrives
after a long tool phase, and why Recent files didn't show a committed card.
May share a root cause with
[serve-multiminute-freeze](2026-08-08-serve-multiminute-freeze.md) — same
environment, same "server-side state not reaching the UI" smell.
