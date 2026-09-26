# `POST /api/pairing/push-token`: the phone's APNs registration

The iPhone app posts its APNs device token and the environment its build was
signed for on every launch (contract §5.9). The route is authenticated by the
device bearer, and the registration lands on that device's record. The raw
token never leaves the server: the device list shows only `push: {
environment, registeredAt }`.

```ts setup
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestServer } from "../../helpers/doctest-server.js";
import {
  createMobilePairingTicket,
  devicePushRegistrations,
  listMobileDevices,
  redeemMobilePairingTicket,
  revokeMobileDevice,
} from "../../../src/core/mobile/pairing.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../mobile-contract/fixtures/push-token");
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), "utf-8"));

const ctx = await makeTestServer({ openAccess: false });

async function pair(label) {
  const ticket = createMobilePairingTicket(ctx.boxRoot, { createdBy: "owner@example.com" });
  const device = await redeemMobilePairingTicket(ctx.boxRoot, { pairingToken: ticket.token, deviceLabel: label });
  if (!device) throw new Error("the ticket did not redeem");
  return device;
}

async function register(deviceToken, body) {
  const headers = deviceToken === null ? {} : { authorization: `Bearer ${deviceToken}` };
  const response = await ctx.rawRequest({ method: "POST", url: "/api/pairing/push-token", headers, payload: body });
  return response.payload === "" ? `${response.statusCode}` : `${response.statusCode} ${response.payload}`;
}

/** What the server holds: label, environment, and the token's first 8 characters. */
function held() {
  return devicePushRegistrations(ctx.boxRoot).map((r) => `${r.label} ${r.environment} ${r.token.slice(0, 8)}`).join("\n") || "none";
}
```

## A paired phone registers

The request body is the shared contract fixture, posted verbatim.

```ts
const phone = await pair("Jamie's iPhone");
await register(phone.deviceToken, fixture("request-sandbox.json").input)
=> 204

held()
=> Jamie's iPhone sandbox 01234567
```

## Registering again replaces the token

Tokens change on reinstall with no signal, so the phone posts every launch and
the latest post wins. An uppercase token is stored lowercase.

```ts continue
await register(phone.deviceToken, fixture("request-production-uppercase.json").input)
=> 204

await register(phone.deviceToken, { token: "ABCDEF0123456789", environment: "sandbox" })
=> 204

held()
=> Jamie's iPhone sandbox abcdef01
```

## The device list shows the registration without the token

```ts continue
const [listed] = listMobileDevices(ctx.boxRoot);
JSON.stringify([listed.label, listed.push?.environment, typeof listed.push?.registeredAt, "apns" in listed, JSON.stringify(listed).includes("abcdef0123456789")])
=> ["Jamie's iPhone","sandbox","string",false,false]
```

## One token, one phone

A phone paired a second time keeps its APNs token, so registering it on the new
device clears it from the old record; otherwise every push would arrive twice.

```ts continue
const repaired = await pair("Jamie's iPhone (re-paired)");
await register(repaired.deviceToken, { token: "abcdef0123456789", environment: "sandbox" })
=> 204

held()
=> Jamie's iPhone (re-paired) sandbox abcdef01
```

## Refusals

A bad body is 400, and the registration is unchanged. The fixtures are the
contract's refused bodies.

```ts continue
await register(repaired.deviceToken, fixture("error-400-environment.json").input)
=> 400 {"error":"Invalid option: expected one of \"sandbox\"|\"production\""}

await register(repaired.deviceToken, fixture("error-400-token-not-hex.json").input)
=> 400 {"error":"token must be the APNs device token in hex"}
```

No bearer, a bad bearer, and a revoked device are all 401. The box's auth
wall refuses them before the route runs.

```ts continue
const body = { token: "abcdef0123456789", environment: "sandbox" };
await revokeMobileDevice(ctx.boxRoot, phone.deviceId);
[
  await register(null, body),
  await register("not-a-device-token", body),
  await register(phone.deviceToken, body),
].join("\n")
=>
401 {"error":"Not authenticated"}
401 {"error":"Not authenticated"}
401 {"error":"Not authenticated"}
```

A request that clears the wall some other way, such as a web session, has no
device to register for, and the route refuses it with the contract's error
body.

```ts continue
const open = await makeTestServer({ openAccess: true });
const response = await open.rawRequest({ method: "POST", url: "/api/pairing/push-token", payload: body });
await open.cleanup();
`${response.statusCode} ${response.payload === JSON.stringify(fixture("error-401.json").expected)}`
=> 401 true
```

```ts cleanup
await ctx.cleanup();
```
