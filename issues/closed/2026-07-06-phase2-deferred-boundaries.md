---
resolution: implemented
---

# Phase-2 deferrals: remaining clock migrations + inbound schemas

**Closed 2026-07-09:** all three items done — clock migrations (transcribe,
todos, location, box-init) in c8e2a91b; Drive inbound zod schemas
(`services/google-drive-schemas.ts`, 6 boundaries incl. the recursive
document schema) in c8b2603e; Telegram polling validation (schema moved down
to `services/telegram-schemas.ts`, duplicate `TelegramUpdate` type killed) in
5c93f7a9. Plan: `callback-box/docs/plans/architectural-review-followups.md`
Track 4.

Deferred with reasons from the architectural-review implementation
(`callback-box/docs/implemented-plans/architectural-review.md`, Tracks P.2/D.2):

- **Four domain-time sites classified MIGRATE but deferred** — transcribe,
  todos, location, box-init each need `boxRoot` threaded through helper
  signatures to reach `getBoxTimeISO`; mechanical but signature churn.
- **Drive inbound zod schemas** — services/google-drive responses are still
  trusted; lower priority (not card-writing on the inbound path). Gmail,
  Calendar, and the Telegram webhook are done (`services/connector-response.ts`
  is the pattern).
- **Telegram polling-path validation** — validating grammy's typed responses
  inside `services/` would invert the services→connectors layering; needs a
  design decision, not a drive-by.
