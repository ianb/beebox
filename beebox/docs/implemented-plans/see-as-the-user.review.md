# Plan review — see-as-the-user (Codex, gpt-5.6-sol, 2026-07-11)

Cross-model review of `see-as-the-user.md` (the 2026-07-11 first draft), run
via `/codex` in plan mode with `model_reasoning_effort=high`. Findings
verbatim below (absolute path prefixes shortened to repo-relative; raw
output in the session's `scratch/codex-out.md`). All eight findings were
verified against source and incorporated into the revised plan; the
per-finding disposition follows the verbatim block.

## Findings (verbatim)

1. **Critical — Track C does not enforce "the API can only shoot the tab
   that asked."**
   The plan makes that claim, but `captureVisibleTab(windowId)` captures
   whichever tab is active in that window at call time; it accepts no tab
   ID. A tab switch between validation and capture can therefore capture a
   different, potentially non-box tab. Chrome documents exactly that
   window-scoped behavior. Checking before and after reduces the race but
   cannot make the stated boundary structural.

   The proposed authorization is also too broad: it compares only the
   sender's origin, while clerk deliberately identifies enabled boxes by
   full root URL, including path (`beebox-clerk/src/domain/config.ts:5`,
   `config.ts:28`). Enabling `/worktree-a/box1` must not authorize
   `/worktree-b/box2` on the same origin.

2. **Critical — the command cannot reliably identify the conversation or
   browser tab to capture.**
   Track B defaults `--session` implicitly and broadcasts to "browser
   client(s)". Agent subprocesses receive `BBX_BOX_NAME`, `BBX_SERVER_URL`,
   and a box-wide token, but no current chat-session ID
   (`beebox/src/core/script-env.ts:83`). Falling back to the
   most-active pointer can target another conversation if activity changes
   while the agent is working.

   On the browser side, the existing `forSession` helper treats either
   null side as a wildcard
   (`beebox/src/frontend/src/components/chat/InteractiveChat-ws.ts:46`);
   an idle `?session=new` tab would therefore accept an established
   session's request if this helper is reused. Multiple matching tabs
   would all capture or open consent UI, and "first response wins" chooses
   an arbitrary viewport. The design needs an explicit current-session
   value plus client identity/focus selection, not "most active" plus
   broadcast.

3. **High — the advertised request outcomes are impossible with the
   specified protocol.**
   The plan promises `no-client` after a two-second ack grace, but neither
   the event nor response protocol defines an ack. The bus exposes no
   subscriber count (`beebox/src/core/event-bus.ts:173`), and its
   tRPC bridge may drop transient events for a slow subscriber
   (`beebox/src/webapp/trpc/routers/events.ts:78`). Consequently,
   no tab, wrong session, stale frontend, dropped event, background
   suspension, and failed response upload all collapse to `timeout`.

   Use two phases: session clients ack with a stable client ID and
   focus/capability state; the server selects one client and sends a
   targeted capture instruction. Then "no ack" can mean `no-client`, while
   "selected client did not finish" can mean `timeout`.

4. **High — the plan misses the almost identical implementation that
   already exists.**
   `bbx chat get-last-audio` already implements CLI long-poll → transient
   bus request → browser multipart response → in-memory
   first-response-wins rendezvous
   (`beebox/src/webapp/routes/chat-last-audio-routes.ts:1`,
   `beebox/src/core/last-audio-pending.ts:1`). Yet "What already
   exists" omits it and Track B proposes rebuilding the pattern.

   The minimal version should generalize that pending-request primitive
   and reuse its multipart upload shape. For Track A, capture one frame
   and pass its blob directly to `addImageFiles`; the existing image
   pipeline already downscales to 1920px
   (`beebox/src/frontend/src/lib/image-paste.ts:19`). The proposed
   preliminary 2560px resize is redundant and immediately resized again.

5. **High — "also post it into the thread" is treated as settled without
   a viable write path.**
   The plan requires an agent-initiated capture to become a visible chat
   attachment, then admits this needs a new message-injection path. The
   existing `/chat/send` path starts or queues an agent turn
   (`beebox/src/webapp/routes/chat-send-routes.ts:247`); using it
   while the requesting agent is mid-turn creates an unwanted second user
   turn. Direct transcript mutation is a different, concurrency-sensitive
   feature.

   Cut persistent thread injection from v1. Show an explicit client-side
   thumbnail/status row and retain the tmp image for the requesting
   command. Add transcript persistence later only with a defined non-turn
   message type.

6. **High — the page↔extension checks do not authenticate the trusted
   frontend.**
   Strict `event.origin` checks and the meta tag reject foreign frames,
   but any script running in the enabled box page can send the same
   `window.postMessage`. The existing "spoof guard" merely proves that the
   claimed `boxUrl` shares the tab origin
   (`beebox-clerk/src/domain/box-identity.ts:36`); it does not prove the
   message came from the application bundle. The threat model must say
   that same-origin script is trusted, and background validation must
   check exact enabled box URL/path, sender frame/document, schema, and
   correlation ID.

   The in-memory 600ms service-worker queue is unnecessary state. MV3
   explicitly allows unexpected termination and loses global variables
   when that happens; reject `busy` and retry/fallback instead of
   queueing. (Chrome service-worker lifecycle documentation.)

7. **Medium — several failure paths marked "clear" are actually silent or
   misclassified.**
   - A server restart closes the long-poll connection; the CLI gets a
     fetch/network failure, not the promised `timeout`.
   - If the CLI disconnects or is killed, the pending entry and capture
     request remain live until server timeout. The route must cancel on
     request abort so a consent popup cannot outlive its requester.
   - After a successful frame grab, `processImageBlob` failure is only
     logged to the console and produces no user feedback
     (`InteractiveChat-attachments.ts:98`). Track A therefore violates its
     own "never silent" claim.
   - The capture helper must specify waiting for playable video
     dimensions / a rendered frame before drawing; otherwise a zero-sized
     or blank first frame can look like success.

8. **Medium — named citation and "already validated" problems.**
   - "Images are serialized into the `<chat-app>` snapshot" is false.
     Images are separate model content; the snapshot serializer contains
     features and UI context only
     (`beebox/src/core/chat/features.ts:152`).
   - `InteractiveChat-attachments.ts:2-4` does not establish a tmp home
     for chat images; it says pasted images are base64 while uploaded
     files use tmp.
   - Events are not "declared transient" in `EventMap`. Persistence is
     selected at each `emit` versus `emitTransient` call
     (`event-bus.ts:173`); adding the event also requires editing
     `event-bus-schemas.ts` and bumping `EVENT_SCHEMA_GENERATION`
     (`event-bus-schemas.ts:76`).
   - The cited Chromium thread supports a blank frame immediately after
     switching tabs, not the plan's minimized/occluded/stale-frame
     assertions.
   - The Sentry citation names a mutable source path without a commit or
     permalink, so "source-verified" is not reproducible.
   - One BugHerd post cannot support the universal claim that "no
     production bug-report vendor" trusts DOM capture.
   - "Real compositor pixels at device resolution" is not established by
     the cited Chrome API reference; dimensions should be measured from
     the returned image rather than assumed.

**Single most important change:** redesign Track C before implementation
so exact box path, exact session/client, and the active-tab race are
explicit security invariants; as written, its central claim that
agent-initiated capture is structurally incapable of capturing a non-box
tab is false.

## Disposition (plan author, after source verification)

- **1a (active-tab race)** — accepted; verified against the Chrome tabs
  API (no tabId parameter). Plan revised: before/after active-tab checks
  with discard-on-mismatch, "structurally impossible" reworded to a
  documented ms-wide accepted risk.
- **1b (path-scoped authorization)** — accepted; `config.ts` confirmed
  boxes are full-URL entities and the dev router puts many boxes on one
  origin. Plan revised: match patterns and background checks use full
  `boxUrl` prefix.
- **2 (session identity)** — accepted; `script-env.ts` confirmed no
  session id reaches the agent env, and `forSession`'s null-wildcard is
  real. Plan revised: new `BBX_CHAT_SESSION_ID` set at agent spawn,
  required by the command (no most-active fallback), exact-session
  matching in the frontend handler. The reviewer's further suggestion of
  server-side single-client *selection* was not adopted — first-wins
  across same-session tabs matches the shipped last-audio contract and
  avoids a client-registry; noted as a revisit if multi-tab viewport
  ambiguity shows up in practice.
- **3 (ack phase)** — accepted; plan revised to a two-phase protocol
  (ack → `no-client` vs `timeout` split).
- **4 (last-audio reuse; drop 2560 resize)** — accepted in full; the
  plan's biggest miss. B0 now extracts a shared
  `pending-browser-request.ts`; Track A uses the existing 1920px pipeline
  unmodified.
- **5 (cut in-thread persistence)** — accepted; replaced with an
  ephemeral indicator row + tmp file, transcript persistence explicitly
  NOT in scope.
- **6 (trust model; stateless worker)** — accepted; trust model now
  explicit (same-origin script is trusted within the box), background is
  stateless, queue removed (`busy` + page-side fallback).
- **7 (failure reclassifications)** — accepted; all four rows updated
  (network `error` outcome, abort-cancels-pending, screenshot-path toast,
  frame-readiness wait).
- **8 (citations)** — accepted; all corrected or softened in the revised
  plan.
