// # Codex's sandbox on the server
//
// Codex runs the `bwrap` on PATH; the AppArmor file grants user namespaces to
// that binary by path, and the deploy helper limits it to box users. A path or
// mode that drifts is a Codex sandbox that fails before running anything.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { readFile } from "node:fs/promises";

const apparmor = await readFile("deploy/apparmor/beebox-codex", "utf8");
const helper = await readFile("deploy/server-bin/bbx-codex-sandbox-install", "utf8");
const deploy = await readFile("deploy/deploy.sh", "utf8");
const cloudInit = await readFile("deploy/hetzner/cloud-init.yaml", "utf8");

void test("The AppArmor profile grants user namespaces to the bwrap the helper installs", (t) => {
  const profiles = [...apparmor.matchAll(/^profile (\S+) (\S+) flags=\(unconfined\) {\n {2}userns,\n}/gm)].map((m) => ({ name: m[1], path: m[2] }));
  t.check(profiles, [{ name: "beebox-codex-bwrap", path: "/usr/bin/bwrap" }]);
  t.check(helper, any(String).includes("readonly BWRAP=/usr/bin/bwrap"));
  t.check(helper, any(String).includes("^beebox-codex-bwrap "));
  t.end();
});

void test("Only box users may run the exempt bwrap", (t) => {
  t.check(helper, any(String).includes('dpkg-statoverride --add root beebox-boxes 0750 "$BWRAP"'));
  t.end();
});

void test("Every deploy runs the helper and a new host gets bubblewrap", (t) => {
  t.check(deploy, any(String).includes('< "$CHECKOUT/beebox/deploy/server-bin/bbx-codex-sandbox-install"'));
  t.check(cloudInit, any(String).includes("\n  - bubblewrap\n"));
  t.end();
});
