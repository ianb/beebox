# `bbx pairing register-fake-push`: an APNs audience with no iPhone

Pairs a stand-in phone with a fake `sandbox` APNs token so the `apns` channel
has someone to send to on a dev box. It refuses where a fake device could reach
Apple (real APNs keys outside fake mode) or sit beside a real phone (a device
registered for production). `runRegisterFakePush(boxRoot, { label })` is
driven directly and returns the exit code.

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { runRegisterFakePush } from "../../src/cli/commands/pairing.js";
import {
  createMobilePairingTicket,
  devicePushRegistrations,
  listMobileDevices,
  redeemMobilePairingTicket,
  registerDevicePush,
} from "../../src/core/mobile/pairing.js";

const ENV = ["BBX_NOTIFY_FAKE", "BBX_PUSH_FAKE", "BBX_APNS_KEY_PATH", "BBX_APNS_KEY_ID", "BBX_APNS_TEAM_ID", "BBX_APNS_BUNDLE_ID"];
for (const name of ENV) delete process.env[name];
const KEYS = { BBX_APNS_KEY_PATH: "/keys/AuthKey.p8", BBX_APNS_KEY_ID: "KEY", BBX_APNS_TEAM_ID: "TEAM", BBX_APNS_BUNDLE_ID: "app.example" };

async function run(box, label) {
  const out = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { out.push(args.join(" ")); };
  console.error = (...args) => { out.push(`stderr: ${args.join(" ")}`); };
  let code;
  try {
    code = await runRegisterFakePush(box.root, { label });
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return [...out.map((line) => line.replace(/\([\da-f-]{36}\)/, "(<id>)")), `exit ${code}`].join("\n");
}
```

## On a dev box it pairs a fake phone

```ts
const box = await makeTmpBox();
await run(box, "dev phone")
=>
Paired fake device "dev phone" (<id>) with a sandbox APNs token. Unpair it from Settings like any phone.
exit 0
```

The device is paired to nobody, so only the owner sees and unpairs it, and it
is in the `apns` audience with a token that says what it is:

```ts continue
const [device] = listMobileDevices(box.root);
const [registration] = devicePushRegistrations(box.root);
JSON.stringify([device.label, device.createdBy, device.push?.environment, registration.token.startsWith("fake-")])
=> ["dev phone",null,"sandbox",true]
```

```ts cleanup
await box.cleanup();
```

## It refuses where a fake device could do harm

With real APNs keys and no fake mode, a push to the fake token would go to
Apple. Fake mode makes it safe again:

```ts
const box = await makeTmpBox();
Object.assign(process.env, KEYS);
const withKeys = await run(box, "dev phone");
process.env.BBX_NOTIFY_FAKE = "1";
const withKeysFake = await run(box, "dev phone");
for (const name of ENV) delete process.env[name];
[withKeys, withKeysFake].join("\n")
=>
stderr: Refused: APNs keys are configured (BBX_APNS_*), so a push to a fake device would go to Apple. Run with BBX_NOTIFY_FAKE=1, or on a box without the keys.
exit 1
Paired fake device "dev phone" (<id>) with a sandbox APNs token. Unpair it from Settings like any phone.
exit 0
```

A box where a phone registered for production APNs is a real box:

```ts continue
const ticket = createMobilePairingTicket(box.root, { createdBy: "owner@example.com" });
const phone = await redeemMobilePairingTicket(box.root, { pairingToken: ticket.token, deviceLabel: "Jamie's iPhone" });
await registerDevicePush(box.root, { deviceId: phone.deviceId, token: "a1".repeat(32), environment: "production" });
[await run(box, "another"), await run(box, "  ")].join("\n")
=>
stderr: Refused: this box has a phone registered for production APNs ("Jamie's iPhone"); fake devices are for dev boxes.
exit 1
stderr: Error: a label is required
exit 2
```

```ts cleanup
await box.cleanup();
```
