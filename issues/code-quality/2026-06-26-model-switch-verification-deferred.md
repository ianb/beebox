---
title: "model switch verification deferred"
workstream: unknown
area: beebox
---

> **Naming note (2026-10-18):** doctests (`*.doctest.md`) are now `.test.ts` files with `t.check`, in the same directory under the same base name, and `agent-doctest` is now `tap-check/` (`@ianbicking/tap-check`). See `beebox/docs/implemented-plans/retire-doctest.md`.

Mid-conversation model switching (`src/webapp/routes/chat-session-routes.ts`) has
no test coverage and recent "model-picker desync" fixes suggest it was flaky.
It's worth exercising, but a meaningful test needs a real Claude invocation
(drive a session, switch models, confirm context survives) rather than a mock —
so it's a manual verification task, not an automated one. Not started.

## Next-action check (2026-09-24)

Reconfirmed 2026-09-24: still unverified. `chat-session-routes.ts` is gone; `setModel` is now at `beebox/src/webapp/trpc/routers/chat/control-procedures.ts:246` (moved in `16ba427d5`, whose message also defers the same in-app smoke test). `test/webapp/trpc-model-policy.doctest.md` (moved to `beebox/test/webapp/trpc/routers/chat.model-policy.test.ts`) passes but covers policy and validation against a fake server only. No test switches the model in a live session and checks that the context survives.

## Audit 2026-10-22

Still unverified: no test switches the model in a live session. The `setModel` procedure is now at `beebox/src/webapp/trpc/routers/chat/control-procedures.ts:270`. The policy test is `beebox/test/webapp/trpc/routers/chat.model-policy.test.ts`.

Re-reviewed 2026-10-30: setModel is now at control-procedures.ts:275; still no live-session switch test.
