---
title: "agent-browser's origin-scoped header injection may not cover WebSocket upgrades (browse-key sessions)"
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — investigating the stuck "Agent is working…" field-test finding
labels: [field-test-findings, harness]
resolution: implemented
---

Resolved by seeding the browse key in Chromium's cookie jar before navigation.
The initial WebSocket and a forced reconnect now authenticate through the same
browser cookie.

## Evidence from field-test run #2 (2026-08-09, onboarding re-run)

Now strongly supported by the `first-contact` item in a dedicated onboarding
field-test run. This was the session's first message:

- The server answered in **18 seconds** — user message 18:12:10Z, complete
  assistant reply 18:12:28Z in the session transcript, turn marker written
  18:12:28Z.
- The operator's UI showed "Agent is working…" with **zero partial text**
  for ~7 minutes across four pixel-identical screenshots
  (`screenshots/first-contact/06,07,09,11`), then the operator gave up;
  debrief outcome `blocked`.
- So BOTH WS-fed paths (`events.turnStream` frames and the
  `chat-complete`→REFRESH broadcast) delivered nothing while HTTP worked
  fine — consistent only with the WS channel never connecting in the
  browse-key environment.
- The stream watchdog (`processing-status-display.ts`) could not rescue it:
  first message of a "new" session → `sessionId` null until `system/init`
  arrives on the very stream that is dead. That documented "accepted gap"
  (see the close note on
  [chat-status-lies-after-completion](2026-08-08-chat-status-lies-after-completion.md))
  is therefore NOT a rare corner in this environment — it is every first
  message — and it is equally reachable by any real user whose socket dies
  on message one. The remaining recovery gap is tracked in
  [new-session-dead-socket-status-never-recovers](../../bugs/2026-08-09-new-session-dead-socket-status-never-recovers.md).

The measured harness-side fix delivers the browse key as a real cookie
(agent-browser `cookies set` supports `--url`/`--domain`/`--path` scoping)
instead of per-origin header injection, so it rides WS upgrades natively;
the implementation and its profile-lifetime tradeoff are recorded below.

The browse-key credential (`cb_browse_key`) is not a real browser cookie in
`bin/browse` sessions: `browse/src/worktree.ts` (`authHeaderFor`) sends it as
an origin-scoped header via agent-browser's `open <url> --headers <json>`,
deliberately avoiding the profile's cookie jar. Server-side WS auth is wired
correctly (`src/webapp/server-box-scope.ts` `createContext` calls
`verifyBrowseKey(req.headers)` on the upgrade). The open question is the
CLIENT side: CDP/Playwright-style header injection commonly covers document
navigation and fetch/XHR but NOT WebSocket handshakes — and agent-browser is
a compiled binary, so this can't be settled by reading source here.

If WS upgrades (or only *reconnect* upgrades) go out without the header, every
tRPC WS connect 401s at `createContext`, `wsLink` retries forever at capped
backoff, and the operator's tab never receives turn frames — one plausible
trigger for the stuck-status finding
([chat-status-lies-after-completion](2026-08-08-chat-status-lies-after-completion.md);
the client-side stream watchdog now self-heals the symptom regardless).

How to settle it: run `cb serve` with a browse key, open the box via
`bin/browse`, and log/inspect WS upgrade requests server-side (does the
upgrade carry the header? does it succeed?), including after a forced
disconnect. If reconnects are naked, field-test operator sessions run
permanently without the live channel — worth knowing even with the watchdog
in place, since streaming text and live refresh would still be absent for the
operator's whole session.

## Confirmed and fixed (2026-08-09)

A raw logging proxy in front of this worktree's running box confirmed the
client-side gap. With the old `open --headers` mechanism, the document loaded
but the initial tRPC WebSocket upgrade and every retry arrived without
`cb_browse_key`; the server therefore never held a live subscription socket.

Seeding Chromium's cookie jar before navigation fixed both cases. From a
cleared profile, the initial tRPC upgrade carried the browse cookie and stayed
connected. After the proxy forcibly destroyed that socket, the automatic
reconnect also carried the cookie. This makes browse-driven realtime testing
trustworthy again for streaming, live refresh, and turn frames.

The implementation uses one auth mechanism rather than retaining header
injection: a host-only, HttpOnly, SameSite=Strict cookie with a 30-minute
expiry in the isolated browse profile. Cookies are not
port-scoped, so this can reach another local server on the same hostname during
that window; profile isolation limits which browser can send it. An own-origin
open with no configured key expires any stale cookie. It must use path `/`;
a cookie scoped to the externally visible router prefix was not attached to
the app's internally based tRPC socket URL in the measured browser flow.
Worktree teardown already removes the whole profile. Server-side auth and
`verifyBrowseKey` were unchanged.
