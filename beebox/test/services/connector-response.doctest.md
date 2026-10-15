# Inbound connector response validation

`validateResponse` (`src/services/connector-response.ts`) runs a narrow zod
schema over a raw third-party API response and throws `ConnectorResponseError`
— naming the service and operation — the moment the shape drifts. The schemas
(`google-gmail-schemas.ts`, `google-calendar-schemas.ts`) are drift-tolerant: extra keys are ignored,
open-ended enum fields stay strings.

```ts setup
import { validateResponse, ConnectorResponseError } from "../../src/services/connector-response.js";
import { gmailMessageSchema } from "../../src/services/google-gmail/schemas.js";
import { calendarEventSchema } from "../../src/services/google-calendar/schemas.js";
import type { z } from "zod";

// Capture a ConnectorResponseError so examples can inspect it.
function vErr(raw: unknown, ctx: { schema: z.ZodType; service: string; operation: string }): ConnectorResponseError | null {
  try { validateResponse(raw, ctx); return null; } catch (e) { return e instanceof ConnectorResponseError ? e : null; }
}
```

## A well-shaped response validates and passes through

A Gmail message with the fields we consume (plus extra keys Google sends)
passes — unknown keys are ignored, not rejected.

```ts
const msg = { id: "m1", threadId: "t1", labelIds: ["INBOX"], internalDate: "1700000000000", extraKey: "ignored" };
validateResponse(msg, { schema: gmailMessageSchema, service: "gmail", operation: "getMessage" });
"ok"
=> ok
```

## Drift throws, naming the service and operation

A message missing its `id` is real drift — a loud error, not a silent
`undefined` in a card.

```ts
const bad = vErr({ threadId: "t1" }, { schema: gmailMessageSchema, service: "gmail", operation: "getMessage" });
JSON.stringify({ service: bad?.service, operation: bad?.operation })
=> {"service":"gmail","operation":"getMessage"}
```

The error names the failing field but never echoes the raw payload (it may hold
personal mail content):

```ts continue
JSON.stringify(bad?.issues)
=> ["id: «*»"]
```

## Enum-ish fields stay drift-tolerant

A calendar event with a `status` value we've never seen still validates — a new
Google status must not break a sync.

```ts
const ev = { id: "e1", status: "someFutureStatus" };
validateResponse(ev, { schema: calendarEventSchema, service: "calendar", operation: "listEvents" });
"ok"
=> ok
```
