---
title: "A relayed call fails after three hours: the page never refreshes its TURN credentials"
workstream: unattached
area: beebox
labels: [calls, webrtc, turn]
filed-by: agent
discovered-by: agent
discovered-in: worktree-self-hosted-turn
---

`chatCall.iceServers` mints TURN credentials that expire after three hours
(`TURN_TTL_SECONDS` in `beebox/src/webapp/trpc/routers/chat-call.ts`). The
page fetches them once, when it joins (`join` in
`beebox/src/frontend/src/lib/call/engine.ts`). Links opened later, including
after a WebSocket reconnect rejoins the call, reuse the cached list
(`openLink`). A relayed connection that needs a new allocation after expiry
fails, and the person sees a generic "Can't connect" until someone leaves and
rejoins. Both relays behave this way: Cloudflare's and the host's own coturn
(coturn refuses an expired username at allocation; checked on 4.6.1).

The router comment used to say a long call "reconnects with fresh credentials";
the self-hosted-turn workstream corrected the comment, not the behavior.

Possible fix: re-fetch `iceServers` before opening a link when the cached
credentials are near expiry, and call `setConfiguration` on open links.
