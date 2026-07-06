# Phase-2 deferrals: remaining clock migrations + inbound schemas

Deferred with reasons from the architectural-review implementation
(`callback-box/docs/plans/architectural-review.md`, Tracks P.2/D.2):

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
