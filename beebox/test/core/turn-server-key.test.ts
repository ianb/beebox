// # The host's own TURN relay
//
// A cloud server runs one coturn for all its boxes (plan:self-hosted-turn).
// The box server signs credentials with coturn's TURN REST scheme; coturn checks
// them with the same secret. The stored value is strict: a malformed one reads as
// "no relay" with a warning, never a crash and never a half-working relay.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTurnServerKey, restCredentials, stunUrlsFor } from "../../src/core/turn-server-key.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

const secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

void test("credentials follow coturn's TURN REST scheme", async (t) => {
  // Expected value from `openssl dgst -sha1 -hmac <secret> -binary | base64` over the username.
  t.check(restCredentials({ secret, nowMs: 1_700_000_000_500, ttlSeconds: 10_800, id: "birch" }), {
    username: "1700010800:birch",
    credential: "LABfflV7VjK+F93SLftpn0STSqI=",
  });
});

void test("STUN runs on each TURN host once", async (t) => {
  t.check(
    stunUrlsFor(["turn:203.0.113.5:3478?transport=udp", "turn:203.0.113.5:3478?transport=tcp", "turn:[2001:db8::5]:3478?transport=udp"]),
    ["stun:203.0.113.5:3478", "stun:[2001:db8::5]:3478"],
  );
});

void test("only a well-formed, granted value configures the relay", async (t) => {
  process.env.BBX_SECRETS_FILE = join(await mkdtemp(join(tmpdir(), "bbx-secrets-")), "secrets.json");
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const read = () => getTurnServerKey(box.root, { observe: false });
  const good = { secret, urls: ["turn:203.0.113.5:3478?transport=udp", "turn:[2001:db8::5]:3478?transport=udp"] };

  await setSecret({ name: "turn-server", value: JSON.stringify(good) });
  // Present on the machine but not granted: no relay.
  t.check(await read(), null);
  await grantSecret({ slug: await boxSlug(box.root), name: "turn-server", access: "server" });
  t.check(await read(), good);

  const bad = [
    { ...good, secret: "short" },
    { ...good, urls: [] },
    { ...good, urls: ["turns:203.0.113.5:5349?transport=tcp"] },
    { ...good, urls: ["turn:turn.example.com:3478?transport=udp"] },
    // The install check allocates over IPv4, so an IPv6-only value is refused.
    { ...good, urls: ["turn:[2001:db8::5]:3478?transport=udp"] },
  ];
  const warn = console.warn;
  console.warn = () => {};
  t.teardown(() => {
    console.warn = warn;
  });
  for (const value of bad) {
    await setSecret({ name: "turn-server", value: JSON.stringify(value) });
    t.check({ value, read: await read() }, { value, read: null });
  }
});
