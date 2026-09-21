---
title: "`bbx chat ui` always returns no-client on the ios-native channel, so an agent can never describe or point at a control for an iPhone-app user"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
---

On a chat session with `channel="ios-native"`, running `bbx chat ui` returned
`no-client: no client is attached to this chat session`. This left the agent
unable to see or name any on-screen control at all, so it could not tell an
iPhone-app user which button to use for a task (attaching a photo), and its
only fallback was web-derived advice that may not even apply to the native
app's chrome.

## Mechanism

`bbx chat ui` (`beebox/src/cli/commands/chat-ui.ts`) POSTs to
`/api/chat/ui/request`, which parks the request and broadcasts a transient
`ui-scan-request` bus event, waiting for the browser tab holding that chat
session to answer (`beebox/src/webapp/routes/chat-ui-routes.ts`). The answer
comes from a listener in the web frontend bundle
(`beebox/src/frontend/src/components/chat/ui-scan-request-handler.ts`, wired
into `InteractiveChat-ws.ts:157`). Nothing in this path is channel-aware: it
either gets an answer from *a* connected web client or times out as
`no-client`.

The product's own instructions
(`beebox/src/core/chat/session/prompts.ts:117`) describe `ios-native` as a
channel "the user is in the iPhone app: the composer, mic and capture
controls are native chrome around the page, not part of the web page
itself" — i.e., on this channel the controls an agent most needs to describe
are specifically the ones outside the web page's own DOM, which is exactly
what a page-side scan handler cannot see even when a WebView is present and
connected.

## Why the fix is not obvious

- If the iOS app's WebView does run the same frontend bundle, it may be
  possible for the native shell to answer the scan request with the native
  chrome it renders around the page — but that requires the native app to
  participate in the `ui-scan-request` protocol, which is new native-side
  work, not just a web-side fix.
- If no client is realistically ever going to answer this request on
  `ios-native` (because the composer genuinely lives outside anything a page
  script can introspect), the more honest fix is for the CLI/route to
  recognize the channel and fail with something like `unsupported-channel:
  ios-native has native chrome this scan cannot enumerate — describe the
  action instead of pointing at a control`, rather than the generic
  `no-client`, which reads as "nobody is listening right now" instead of
  "this will never work here."
- Distinguishing those two directions needs to know whether the iOS app's
  WebView is wired to the chat-session websocket the same way a desktop/mobile
  browser tab is; this was not investigated as part of this triage pass.
