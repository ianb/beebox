---
title: "A coined chat with ?engine=claude still runs its first turn on the box's default engine (codex) — fourth occurrence, after three fixes"
workstream: coined-engine-authority
resolution: implemented
area: callback-box
priority: important
labels: [chat, codex]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "this session somehow got lost"
---

On a codex-default box, opening a chat with `?engine=claude&model=claude-haiku-4-5-20251001`
and sending the first message ran the turn on **Codex**, then the chat became
unopenable. Session `4d206d20-7738-4925-b837-a4758925646e` on the boxholder's
personal box, 2026-08-29 ~11:00Z. Three prior fixes on this path (2026-08-27/28)
each closed one layer; this survived all of them, so the path is not understood.

Log (box `hub-child.log`, times UTC):

```
10:59:14 [ChatSessionRegistry:reserve] Reserved 4d206d20-…  (held=1)
10:59:14 [ChatSession:init] Loaded session: 4d206d20-…
10:59:35 [ChatSession:init] Loaded session: 4d206d20-…
10:59:35 [ChatSessionRegistry:create] Created entry for 4d206d20-… (size=2)
10:59:35 [ChatSession:features] setFeature hq-dictation=on
11:00:17 [ChatSession:send] Sending message (579 chars …)
11:00:17 Invariant violated: coined session 4d206d20-… resolved to engine codex
11:00:17 [ChatSession:start] Starting SDK chat run
11:01:37 [codex-tool-activity] unknown Codex item type "collab_tool_call"
11:02:49 [ChatSession:done] Turn complete, is_error: false
11:06:05 Development bundle changed; draining before reload…  → shutdown stops the session
```

State afterwards — the two records DISAGREE, which is the diagnostic signature:

- husk `store/chat/web/2026-08-29_4d206d20.chat.card`: `engine: claude`
- `.callback-box/chat-session-history.json` entry: `engine: codex`, features `{hq-dictation: on}`
- No transcript for this id in `~/.claude/projects/…` (Claude never ran it) and none
  in `~/.codex/sessions` under this id (Codex mints its own thread ids; a coined
  UUID is not one of them). The turn's content lives only in whatever Codex thread
  ran it, findable by `context-dir` + time.

Verified the running box child had the latest fix (`fcbc67dc`, `coinedEngineFor`
present in `dist/cli.mjs`, child started 06:06 local). So the resolver fix holds
and yet the run started on codex. The three prior fixes, for the record:
`5fed638d` (resolveStartEngine honours requested), `2fd3b175` (registry passes
reservation.engine into session options), `fcbc67dc` (module-level coined-id →
engine map consulted by both resolvers). The registry-level doctest
(`test/core/chat-session-registry.doctest.md`, "a coined reservation's engine
reaches the run it starts") passes — so the failing path is one the doctest does
not model.

Suspects, in order:

1. **The 20-second gap between reserve (10:59:14) and entry creation (10:59:35),
   and the 42s to send.** The warm-slot/prewarm path (`registry-warm.ts`
   `prewarmReservedChat` → `probeStartOptions`) builds a probe ChatSession
   WITHOUT the reservation's engine and resolves the model as `engine ?? "claude"`.
   If the warm subprocess it spawns is what the send later adopts
   (`warmCompatible`), the run inherits the probe's engine, not the reservation's.
2. **Reservation expiry / release before send.** If the reservation was released
   (TTL, `chatIdIsTaken`, a second reserve for the same directory) before
   11:00:17, `coinedEngineFor` returns null and `resolveStartEngine` falls to the
   box default — while the husk (written at reserve time) still says claude.
   `ChatReservationStore.get` deletes on TTL read; check `RESERVATION_TTL_MS`
   against the 63s observed.
3. **`recordSessionStart` writing `reservation.engine` from a different object
   than the run used** — the husk and history disagreeing means two writers with
   two answers; find both call sites and make one authority.

Also from this incident, separate but adjacent:
- Codex item type `"collab_tool_call"` is real (the warn-once from `81b5cc81`
  named it) — add the case in `codex-tool-activity.ts` so it renders.
- A bundle hot-reload stops every live chat session on the box child
  (`Development bundle changed; draining before reload` → `registry shutdown`).
  A landing killed the boxholder's in-progress chat. Drain should wait for
  idle chats or hand the session to the new child — filed separately if not
  taken here.
- Recovery for this specific session: locate the Codex thread by context-dir and
  time, and re-bind or archive the husk so the chat opens.

The fix must come with a test that reproduces THIS sequence — reserve, delay
past the warm handoff, set a feature, send — on a codex-default box, asserting
the backend's `startOptions.engine`, the husk, and the history entry all agree.

## Resolution

The confirmed path was the pre-send feature toggle, not warm adoption or the
63-second delay. `setFeature` created the missing history row with the box
default engine; start then treated that premature Codex row as more authoritative
than the Claude reservation.

The reservation record is now the single pre-start authority. Engine readers
resolve through that live record; warm probing and session construction receive
its engine and model; pre-start feature changes stay on the record until the
first real start writes history and the husk together. A constructed session
retains that record even after the reservation's addressability TTL expires, so
the old default-engine history fallback cannot recur through expiry. The exact
reserve → warm → create → set-feature → send sequence now asserts backend,
husk, history, and features together.

The incident's Codex thread was recovered locally as
`01a04d2d-7071-79d2-a9a4-7a06c11d44ad` from the matching context directory and
timestamp. The history row and husk were rebound to it, and the husk engine was
corrected to Codex so the chat opens against the transcript that actually ran.

The adjacent `collab_tool_call` activity now renders on live and history paths.
Bundle reload stopping live chat sessions is tracked separately in
[bundle reload stops live chat sessions](../../bugs/2026-08-29-bundle-reload-stops-live-chat-sessions.md).
