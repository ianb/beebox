// # What Settings shows for this browser and this phone
//
// A browser that blocks the site reads as blocked even when the box still holds
// its endpoint, because nothing would appear. A browser the box dropped reads as
// off even though the browser keeps its subscription.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { browserPushState, phonePushState } from "../../src/lib/push-support.js";

const supported = { kind: "supported" } as const;
const base = { support: supported, permission: "default", subscribed: false, publicKey: "key" } as const;

void test("browser states", (t) => {
  t.check(browserPushState({ ...base, support: null }), "checking");
  t.check(browserPushState({ ...base, support: { kind: "unsupported" } }), "unsupported");
  t.check(browserPushState({ ...base, support: { kind: "needs-install" } }), "needs-install");
  t.check(browserPushState({ ...base, permission: "denied", subscribed: true }), "blocked");
  t.check(browserPushState({ ...base, subscribed: null }), "checking");
  t.check(browserPushState({ ...base, permission: "granted", subscribed: true }), "on");
  t.check(browserPushState({ ...base, permission: "granted" }), "off");
  t.check(browserPushState({ ...base, publicKey: undefined }), "checking");
  t.check(browserPushState({ ...base, publicKey: null }), "no-server-key");
  t.check(browserPushState({ ...base, subscribed: true, publicKey: null }), "no-server-key");
  t.end();
});

void test("phone states", (t) => {
  const phone = { paired: true, turnedOff: false, registered: false, apnsConfigured: true };
  t.check(phonePushState({ ...phone, paired: false }), "not-paired");
  t.check(phonePushState({ ...phone, apnsConfigured: false }), "unregistered-no-server-key");
  t.check(phonePushState({ ...phone, registered: true, apnsConfigured: false }), "no-server-key");
  t.check(phonePushState(phone), "unregistered");
  t.check(phonePushState({ ...phone, registered: true, turnedOff: true }), "turned-off");
  t.check(phonePushState({ ...phone, paired: false, turnedOff: true }), "not-paired");
  t.check(phonePushState({ ...phone, registered: true }), "registered");
  t.end();
});
