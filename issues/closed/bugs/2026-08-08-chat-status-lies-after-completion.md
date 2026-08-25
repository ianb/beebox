---
title: "Chat shows 'Agent is working…' long after the turn finished; Recent files / landmarks deny the saved card meanwhile"
workstream: integration-tests
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — field-test v0 spine run (Priya, save-recipe)
labels: [soft-launch, field-test-findings, code-error]
resolution: implemented
---

> **Closed 2026-08-09.** Root cause: the chat machine's `streaming` state is
> exited ONLY by frames or terminal callbacks on the per-turn
> `events.turnStream` WS subscription — no timeout, no fallback. If the socket
> dies and never reconnects, "Agent is working…" persists forever while
> `chat.statusAll` (in-process, WS-free) correctly reports idle — disjoint
> code paths, which is exactly why the harness's quiescence check passed.
> Fix: a stream watchdog in `processing-status-display.ts` — while
> `streaming`, poll server status every 5s; after 3 consecutive idle reads
> (~15s, far past the frames-in-flight window at a healthy turn end) send
> `STREAM_RECOVER`, the machine's existing stalled-stream path, which
> refreshes history and keeps partial stream text. So a dead socket now
> self-heals in ≤ ~20s instead of never. WS auth for the browse-key on the
> upgrade was verified correctly wired server-side (`server-box-scope.ts`
> `createContext`) — not the bug. "Recent files" staleness was downstream of
> the same wedge (it derives from the machine's own messages), not a separate
> cache. Spun out: the reload-losing-the-question sub-symptom
> ([reload-loses-in-flight-question](2026-08-09-reload-loses-in-flight-question.md))
> and the suspicion that agent-browser's origin-scoped header injection may
> not cover WS upgrades
> ([browse-key-ws-upgrade-headers](2026-08-09-browse-key-ws-upgrade-headers.md)).
> Why the socket died in the field-test runs stays open in
> [serve-multiminute-freeze](../../bugs/2026-08-08-serve-multiminute-freeze.md),
> now carrying candidate stall sites.
>
> Cross-model review round: the watchdog now freezes its poll target to the
> first non-null session id of each streaming episode — the registry keys a
> resumed session under the id the client initiated it with, and the SDK can
> rotate ids on resume, so polling the machine's live (rotated) id would read
> idle and false-recover a healthy turn. `STREAM_RECOVER` also clears
> `interrupting`. Accepted gap, documented in the code: a "new" session that
> loses its socket before the first frame has no pollable identity and stays
> unrecovered.
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
[serve-multiminute-freeze](../../bugs/2026-08-08-serve-multiminute-freeze.md) — same
environment, same "server-side state not reaching the UI" smell.
