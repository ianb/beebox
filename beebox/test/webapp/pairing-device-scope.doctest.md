# Paired devices are scoped to the person asking

Anyone with box access may pair their own phone, so anyone with box access may
see and unpair their own phone. `pairing.devices` and `pairing.revokeDevice` are
`authedProcedure` and decide scope themselves rather than offering the UI a
choice of two procedures: the owner reaches every device on the box, and a
member reaches the devices they paired. The rule itself is pinned in
`test/core/mobile/device-visibility.doctest.md`; this is the gate over HTTP.

```ts setup
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTestServer } from "../helpers/doctest-server.js";
import { signSession } from "../../src/webapp/auth.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../src/core/mobile/pairing.js";

const authDir = await mkdtemp(join(tmpdir(), "bbx-pairing-scope-"));
const ORIGINAL_AUTH = process.env.BBX_AUTH_FILE;
const ORIGINAL_OWNER = process.env.BBX_OWNER_EMAIL;
process.env.BBX_AUTH_FILE = join(authDir, "auth.json");
process.env.BBX_OWNER_EMAIL = "priya@example.com";

const ctx = await makeTestServer({ openAccess: false });
await ctx.seed("_config/box.json", JSON.stringify({ allowedEmails: ["tomas@example.com"] }));

/** Pair a phone as `who`, the way `createTicket` records the pairer. */
async function pair(who: string | null, label: string): Promise<string> {
  const ticket = createMobilePairingTicket(ctx.boxRoot, { createdBy: who });
  const device = await redeemMobilePairingTicket(ctx.boxRoot, { pairingToken: ticket.token, deviceLabel: label });
  if (!device) throw new Error("the ticket did not redeem");
  return device.deviceId;
}

async function devicesAs(email: string) {
  const cookie = `bbx_session=${signSession({ email, name: email })}`;
  const response = await ctx.request({ method: "GET", url: "/api/trpc/pairing.devices", headers: { cookie } });
  return { status: response.statusCode, payload: response.body.result?.data };
}

await pair("priya@example.com", "owner phone");
await pair("tomas@example.com", "member phone");
await pair(null, "a phone paired before pairers were recorded");
```

## The owner sees the whole box

```ts
const owner = await devicesAs("priya@example.com");
`${owner.status} ${owner.payload.scope} ${owner.payload.devices.map((d) => d.label).join(" | ")}`
=> 200 box owner phone | member phone | a phone paired before pairers were recorded
```

## A member sees their own phone, and is told that is what they are seeing

`scope: "own"` is what lets the panel head the list "Your paired devices"
instead of implying a one-line list is every device on the box.

```ts continue
const member = await devicesAs("tomas@example.com");
`${member.status} ${member.payload.scope} ${member.payload.devices.map((d) => d.label).join(" | ")}`
=> 200 own member phone
```

## A member cannot unpair a device that is not theirs

The refusal is NOT_FOUND rather than FORBIDDEN: a distinct code would confirm
the id exists on this box.

```ts continue
const ownerDeviceId = owner.payload.devices.find((d) => d.label === "owner phone").id;
const memberDeviceId = member.payload.devices[0].id;
const memberCookie = `bbx_session=${signSession({ email: "tomas@example.com", name: "tomas" })}`;

async function unpairAsMember(deviceId: string) {
  const response = await ctx.request({
    method: "POST",
    url: "/api/trpc/pairing.revokeDevice",
    headers: { cookie: memberCookie, "content-type": "application/json" },
    payload: { deviceId },
  });
  return response.body.error ? response.body.error.data.code : "ok";
}

`somebody else's: ${await unpairAsMember(ownerDeviceId)}, their own: ${await unpairAsMember(memberDeviceId)}`
=> somebody else's: NOT_FOUND, their own: ok
```

```ts cleanup
await ctx.cleanup();
if (ORIGINAL_AUTH === undefined) delete process.env.BBX_AUTH_FILE; else process.env.BBX_AUTH_FILE = ORIGINAL_AUTH;
if (ORIGINAL_OWNER === undefined) delete process.env.BBX_OWNER_EMAIL; else process.env.BBX_OWNER_EMAIL = ORIGINAL_OWNER;
```
