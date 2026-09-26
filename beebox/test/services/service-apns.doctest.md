# APNs service

`ApnsService.send` pushes one notification to one phone and answers `{ ok }`,
`{ gone }` for a token APNs says is dead, or throws. The real service wraps
`@parse/node-apn`; the fake records sends and can be told which tokens are gone
or failing.

```ts setup
import { classifyApnsFailure, createFakeApns, ApnsSendError } from "../../src/services/apns.js";

const HEADERS = { "apns-push-type": "alert", "apns-topic": "app.example" };

/** One library failure, classified. */
function show(failure) {
  const result = classifyApnsFailure(failure);
  return result instanceof ApnsSendError ? `error: ${result.message}` : `gone: ${result.reason}`;
}
```

## The fake records what it delivered

```ts
const apns = createFakeApns({ goneTokens: ["dead"], failTokens: ["flaky"] });
const ok = await apns.send({ token: "aa11", environment: "sandbox", payload: { aps: { badge: 1 } }, headers: HEADERS });
const gone = await apns.send({ token: "dead", environment: "production", payload: { aps: { badge: 1 } }, headers: HEADERS });
const failed = await apns.send({ token: "flaky", environment: "sandbox", payload: {}, headers: HEADERS }).then(
  () => "delivered",
  (e) => e.message,
);
JSON.stringify([ok, gone, failed])
=> [{"ok":true},{"gone":true,"reason":"Unregistered"},"fake transient APNs failure"]

apns.describe()
=>
FakeApns: 1 sent
  sandbox aa11 → {"aps":{"badge":1}}
```

## Which library failures mean "prune the token"

`@parse/node-apn` resolves a failed send with `{ device, status, response: {
reason } }` for an HTTP answer and `{ device, error }` for a transport failure.
410 Unregistered and 400 BadDeviceToken (also what a sandbox token gets from
the production host) are `gone`; anything else is an `ApnsSendError`, whose
message names the status and reason but never the token.

```ts
[
  show({ device: "aa11", status: 410, response: { reason: "Unregistered" } }),
  show({ device: "aa11", status: 400, response: { reason: "BadDeviceToken" } }),
  show({ device: "aa11", status: 400, response: { reason: "BadCollapseId" } }),
  show({ device: "aa11", status: 403, response: { reason: "InvalidProviderToken" } }),
  show({ device: "aa11", error: new Error("socket hang up") }),
].join("\n")
=>
gone: Unregistered
gone: BadDeviceToken
error: APNs refused the push (400 BadCollapseId)
error: APNs refused the push (403 InvalidProviderToken)
error: APNs refused the push (no status socket hang up)
```
