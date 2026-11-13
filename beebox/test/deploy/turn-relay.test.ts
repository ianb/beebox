// # The call relay on a cloud server
//
// One coturn per host (docs/plans/self-hosted-turn.md). Every deploy runs
// bbx-turn-install, and the ports the config uses are the ports the origin
// firewall opens. A drifted relay range is a relay whose media the firewall
// drops. The helper itself is exercised against a real coturn by
// deploy/server-bin/bbx-turn-install.smoke.sh.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { readFile } from "node:fs/promises";

const conf = await readFile("deploy/coturn/turnserver.conf", "utf8");
const firewall = await readFile("deploy/hetzner/origin-firewall.sh", "utf8");
const deploy = await readFile("deploy/deploy.sh", "utf8");

void test("the firewall opens the relay's listening port and relay range", (t) => {
  const settings = new Map(conf.split("\n").map((l) => l.split("=", 2)).filter((kv): kv is [string, string] => kv.length === 2));
  const setting = (name: string) => settings.get(name);
  const ports = { listening: setting("listening-port"), relay: `${setting("min-port") ?? ""}-${setting("max-port") ?? ""}` };
  t.check(ports, { listening: "3478", relay: "49160-49999" });
  t.check(firewall, any(String).includes(`{"direction": "in", "protocol": "udp", "port": "${ports.relay}", "source_ips": everyone}`));
  t.end();
});

void test("only signed credentials are accepted, and peers exclude loopback and private ranges", (t) => {
  const lines = conf.split("\n").filter((l) => /^(use-auth-secret|no-tcp-relay|denied-peer-ip=(127|10|::1$|::ffff))/.test(l));
  t.check(lines, [
    "use-auth-secret",
    "no-tcp-relay",
    "denied-peer-ip=10.0.0.0-10.255.255.255",
    "denied-peer-ip=100.64.0.0-100.127.255.255",
    "denied-peer-ip=127.0.0.0-127.255.255.255",
    "denied-peer-ip=::1",
    "denied-peer-ip=::ffff:0.0.0.0-::ffff:255.255.255.255",
  ]);
  // A bare "::" denies every peer in coturn 4.6.1 (found on the packaged build).
  t.check(conf.split("\n").filter((l) => l === "denied-peer-ip=::"), []);
  t.end();
});

void test("every deploy configures the relay", (t) => {
  t.check(deploy, any(String).includes('< "$CHECKOUT/beebox/deploy/server-bin/bbx-turn-install"'));
  t.end();
});
