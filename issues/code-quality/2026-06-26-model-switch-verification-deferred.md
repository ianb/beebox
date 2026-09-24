---
title: "model switch verification deferred"
workstream: unknown
area: beebox
---

Mid-conversation model switching (`src/webapp/routes/chat-session-routes.ts`) has
no test coverage and recent "model-picker desync" fixes suggest it was flaky.
It's worth exercising, but a meaningful test needs a real Claude invocation
(drive a session, switch models, confirm context survives) rather than a mock —
so it's a manual verification task, not an automated one. Not started.

## Next-action check (2026-09-24)

Reconfirmed 2026-09-24: still unverified. `chat-session-routes.ts` is gone; `setModel` is now at `beebox/src/webapp/trpc/routers/chat-control-procedures.ts:246` (moved in `16ba427d5`, whose message also defers the same in-app smoke test). `test/webapp/trpc-model-policy.doctest.md` passes but covers policy and validation against a fake server only. No test switches the model in a live session and checks that the context survives.
