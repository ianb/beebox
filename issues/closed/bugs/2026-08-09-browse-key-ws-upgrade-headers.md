---
title: "agent-browser's origin-scoped header injection may not cover WebSocket upgrades (browse-key sessions)"
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — investigating the stuck "Agent is working…" field-test finding
labels: [field-test-findings, harness]
---

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
