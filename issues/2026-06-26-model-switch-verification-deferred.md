---
area: callback-box
---

# Deferred: model-switch verification (audit [69])

Mid-conversation model switching (`src/webapp/routes/chat-session-routes.ts`) has
no test coverage and recent "model-picker desync" fixes suggest it was flaky.
It's worth exercising, but a meaningful test needs a real Claude invocation
(drive a session, switch models, confirm context survives) rather than a mock —
so it's a manual verification task, not an automated one. Not started.
