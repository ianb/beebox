# Quick chat wire contract: shared fixtures

The iOS box screen and App Intent call `quickChat.submit`, `choose`, `discard`, and `home`
directly with the device token. The request and response shapes are pinned by
golden fixtures in `test/mobile-contract/fixtures/quick-chat/`, which the
native `QuickChatAPI` tests decode and encode too, so a change on either side
fails the other's suite.

- `*-request.json` is the exact POST body of one mutation (tRPC, not batched).
  External input includes both `origin: "external"` and its platform `source`.
- `view-*.json` is one non-batched tRPC response envelope whose `data` is a
  `QuickChatView`, one file per face the box screen draws.
- `home.json` is the envelope of the `home` query.

```ts setup
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { quickChatViewSchema } from "../../../../src/core/chat/routing/quick-chat-record.js";
import {
  quickChatChooseInput, quickChatDiscardInput, quickChatHomeSchema, quickChatSubmitInput,
} from "../../../../src/webapp/trpc/routers/quick-chat.js";
import { makeTestServer } from "../../../helpers/doctest-server.js";

const DIR = "test/mobile-contract/fixtures/quick-chat";
async function fixture(name) {
  return JSON.parse(await readFile(join(DIR, name), "utf-8"));
}

/** Parse with the server's schema; a field the schema would drop is a mismatch too. */
function check(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return `invalid: ${parsed.error.issues[0]?.message}`;
  return isDeepStrictEqual(parsed.data, value) ? "ok" : "has fields the server does not send";
}
```

The generic external origin requires an allowlisted platform source, and typed
or voice messages cannot claim an external source.

```ts
const validBase = { id: "5f0c2a9e-3b1d-4c7a-9e2f-8d6b1a4c3e70", message: "x" };
[
  quickChatSubmitInput.safeParse({ ...validBase, origin: "external" }).success,
  quickChatSubmitInput.safeParse({ ...validBase, origin: "typed", source: "apple-app-intents" }).success,
]
=> [false, false]
```

Every fixture in the directory is one of the three kinds, and each parses with
the schema the router uses, field for field.

```ts
const names = (await readdir(DIR)).toSorted();
const results = {};
for (const name of names) {
  const body = await fixture(name);
  if (name.endsWith("request.json") && name.startsWith("submit-")) results[name] = check(quickChatSubmitInput, body);
  else if (name === "choose-request.json") results[name] = check(quickChatChooseInput, body);
  else if (name === "discard-request.json") results[name] = check(quickChatDiscardInput, body);
  else if (name === "home.json") results[name] = check(quickChatHomeSchema, body.result.data);
  else if (name.startsWith("view-")) results[name] = check(quickChatViewSchema, body.result.data);
  else results[name] = "unknown fixture kind";
}
results
=> {
  "choose-request.json": "ok",
  "discard-request.json": "ok",
  "home.json": "ok",
  "submit-external-request.json": "ok",
  "submit-request.json": "ok",
  "view-discarded.json": "ok",
  "view-needs-choice-destination-gone.json": "ok",
  "view-needs-choice-routing-unavailable.json": "ok",
  "view-needs-choice-uncertain.json": "ok",
  "view-sending-expired.json": "ok",
  "view-sending-not-delivered.json": "ok",
  "view-sent-no-session.json": "ok",
  "view-sent-queued.json": "ok",
  "view-sent.json": "ok",
}
```

The view fixtures cover each state and reason the box screen distinguishes.

```ts
const faces = [];
for (const name of (await readdir(DIR)).filter((file) => file.startsWith("view-")).toSorted()) {
  const { state, reason, lastError, expired, queued, destination } = (await fixture(name)).result.data;
  faces.push([state, reason ?? null, lastError === undefined ? null : "lastError", expired ?? null, queued ?? null, destination?.sessionId === undefined ? null : "session"]);
}
faces
=> [
  ["discarded", null, null, null, null, null],
  ["needs-choice", "destination-gone", null, null, null, null],
  ["needs-choice", "routing-unavailable", null, null, null, null],
  ["needs-choice", "uncertain", null, null, null, null],
  ["sending", null, "lastError", true, null, "session"],
  ["sending", null, "lastError", null, null, "session"],
  ["sent", null, null, null, null, null],
  ["sent", null, null, null, true, "session"],
  ["sent", null, null, null, null, "session"],
]
```

The request fixtures go over the real HTTP tRPC adapter as the phone sends
them. With no OpenRouter key the submitted thought is stored as
`routing-unavailable`, its response envelope parses as a view, and the discard
fixture ends it. `home` answers an envelope that parses as the home schema.

```ts
const server = await makeTestServer();
const submit = await server.request({ method: "POST", url: "/api/trpc/quickChat.submit", payload: await fixture("submit-request.json") });
[submit.statusCode, check(quickChatViewSchema, submit.body.result.data), submit.body.result.data.state, submit.body.result.data.reason]
=> [200, "ok", "needs-choice", "routing-unavailable"]

const home = await server.request({ method: "GET", url: "/api/trpc/quickChat.home" });
[home.statusCode, check(quickChatHomeSchema, home.body.result.data), home.body.result.data.open.length]
=> [200, "ok", 1]

const discard = await server.request({ method: "POST", url: "/api/trpc/quickChat.discard", payload: await fixture("discard-request.json") });
[discard.statusCode, discard.body.result.data.state]
=> [200, "discarded"]
```

```ts cleanup
await server.cleanup();
```
