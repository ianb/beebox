# Inbound connector response validation

`validateResponse` (`src/services/connector-response.ts`) runs a narrow zod
schema over a raw third-party API response and throws `ConnectorResponseError`
— naming the service and operation — the moment the shape drifts. The schemas
(`google-gmail-schemas.ts`, `google-calendar-schemas.ts`,
`telegram-schemas.ts`) are drift-tolerant: extra keys are ignored,
open-ended enum fields stay strings.

```ts setup
import { validateResponse, ConnectorResponseError } from "../src/services/connector-response.js";
import { gmailMessageSchema } from "../src/services/google-gmail-schemas.js";
import { calendarEventSchema } from "../src/services/google-calendar-schemas.js";
import { telegramUpdateSchema, telegramUpdatesSchema } from "../src/services/telegram-schemas.js";
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
=> ["id: Invalid input: expected string, received undefined"]
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

## Telegram: message updates parse, non-message updates pass, bad types fail

A normal message update validates:

```ts
const upd = { update_id: 5, message: { message_id: 1, date: 1700000000, chat: { id: 42, type: "private" }, text: "hi" } };
telegramUpdateSchema.safeParse(upd).success
=> true
```

A non-message update (e.g. a callback query) has no `message`/`edited_message`
and still validates — it's simply ignored downstream:

```ts
telegramUpdateSchema.safeParse({ update_id: 6, callback_query: { id: "c1" } }).success
=> true
```

A message whose `chat.id` is the wrong type is rejected:

```ts
telegramUpdateSchema.safeParse({ update_id: 7, message: { message_id: 1, date: 1, chat: { id: "not-a-number", type: "private" } } }).success
=> false
```

## Telegram polling — getUpdates validates the whole batch

`services/telegram.ts`'s `getUpdates()` runs the raw polling response through
`validateResponse` with `telegramUpdatesSchema` (an array of updates) before the
ingest pipeline sees it. A well-shaped batch passes:

```ts
const batch = [
  { update_id: 10, message: { message_id: 1, date: 1700000000, chat: { id: 1, type: "private" }, text: "hi" } },
  { update_id: 11, callback_query: { id: "c1" } },
];
validateResponse(batch, { schema: telegramUpdatesSchema, service: "telegram", operation: "getUpdates" });
"ok"
=> ok
```

A malformed element (here a non-numeric `update_id`) throws, naming the service,
operation, and the offending path — a drift in the Telegram API surfaces loudly
here instead of as silent `undefined`s downstream:

```ts
const bad = vErr([{ update_id: "nope" }], { schema: telegramUpdatesSchema, service: "telegram", operation: "getUpdates" });
JSON.stringify({ service: bad?.service, operation: bad?.operation, issues: bad?.issues })
=> {"service":"telegram","operation":"getUpdates","issues":["0.update_id: Invalid input: expected number, received string"]}
```
