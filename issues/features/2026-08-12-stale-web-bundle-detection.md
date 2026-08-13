---
title: "Web client should notice a newer deployed bundle and reload (stale WKWebView tested old code)"
workstream: unattached
area: frontend
needs: [design]
labels: [mobile, deploy, webview]
filed-by: agent
discovered-by: Ian
discovered-in: streaming-scroll worktree session — iOS scroll field probe
---

The iOS app's WKWebView (and any long-lived pinned tab) keeps running whatever
JS bundle it loaded last, possibly for days. After the streaming-scroll fix
deployed, the boxholder's phone kept exhibiting the old behavior because the
webview never reloaded — the fix was reported "not fixed," and it cost a full
debugging round (plus an instrumentation deploy) before force-quitting the app
revealed the fix had worked all along. A stale client is indistinguishable
from a failed fix, for the boxholder and the agent both.

Direction: a version handshake. The client already talks to the backend
constantly (tRPC, WebSocket, history fetches); the server knows its own bundle
identity (e.g. the built `index.html` asset hash or the deploy's git SHA).
When the client learns the server has moved on, it should reload — or at least
say so.

Design questions to settle:

- **Transport**: piggyback the version on an existing response header or the
  WS hello, vs. a poll on `visibilitychange`/foreground. Foreground-check
  matches the actual failure mode (app resumed days later) and costs nothing
  in steady state.
- **When to act**: auto-reload is only safe when nothing is in flight — never
  mid-stream, mid-composition (composer text lives in an external store and
  would be lost), or mid-upload. Otherwise a visible "new version — tap to
  reload" affordance.
- **iOS specifics**: the native shell could also force a reload on foreground
  when the page is older than some threshold, independent of the web-side
  handshake (`cb-ios-overlap` territory — the webview lifecycle is native
  code).
- A mismatch line in the client debug log even without any UI would already
  help the agent rule stale bundles in/out during a field probe.
