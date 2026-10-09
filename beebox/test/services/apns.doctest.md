# APNs service

`ApnsService.send` pushes one notification to one phone and answers `{ ok }`,
`{ gone }` for a token APNs says is dead, or throws. The real service wraps
`@parse/node-apn`.

```ts setup
import { classifyApnsFailure, ApnsSendError } from "../../src/services/apns.js";

/** One library failure, classified. */
function show(failure) {
  const result = classifyApnsFailure(failure);
  return result instanceof ApnsSendError ? `error: ${result.message}` : `gone: ${result.reason}`;
}
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
  show({ device: "aa11", error: new Error("socket hang up") }),
].join("\n")
=>
gone: Unregistered
gone: BadDeviceToken
error: APNs refused the push (400 BadCollapseId)
error: APNs refused the push (no status socket hang up)
```
