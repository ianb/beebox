---
title: "agent-browser's origin-scoped header injection may not cover WebSocket upgrades (browse-key sessions)"
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — investigating the stuck "Agent is working…" field-test finding
labels: [field-test-findings, harness]
---

## Evidence from field-test run #2 (2026-08-09, onboarding re-run)

Now strongly supported, live. Run
`~/src/boxes/field-runs/onboarding-first-days-2026-08-09T18-10-43`,
item `first-contact` (the session's FIRST message, session
`713992ee-c468-4846-a1ee-b6f95338461d`):

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
  [chat-status-lies-after-completion](../closed/bugs/2026-08-08-chat-status-lies-after-completion.md))
  is therefore NOT a rare corner in this environment — it is every first
  message — and it is equally reachable by any real user whose socket dies
  on message one. Needs a fallback (e.g. `statusAll`/bootstrap re-poll when
  streaming with a null id).

Candidate harness-side fix: deliver the browse key as a REAL cookie
(agent-browser `cookies set` supports `--url`/`--domain`/`--path` scoping)
instead of per-origin header injection, so it rides WS upgrades natively;
`browse/src/worktree.ts` chose header injection to keep the profile cookie
jar clean, which `--url` scoping may satisfy.

(Being worked separately by another session — this note is the handoff.)

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
([chat-status-lies-after-completion](../closed/bugs/2026-08-08-chat-status-lies-after-completion.md);
the client-side stream watchdog now self-heals the symptom regardless).

How to settle it: run `cb serve` with a browse key, open the box via
`bin/browse`, and log/inspect WS upgrade requests server-side (does the
upgrade carry the header? does it succeed?), including after a forced
disconnect. If reconnects are naked, field-test operator sessions run
permanently without the live channel — worth knowing even with the watchdog
in place, since streaming text and live refresh would still be absent for the
operator's whole session.
