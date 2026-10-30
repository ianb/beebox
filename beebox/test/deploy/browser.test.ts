// # The box browser's server install
//
// docs/plans/shared-browser.md, Track F. The engine looks for Chrome and the
// launcher at fixed paths (`src/core/browser/install.ts`,
// `src/core/browser/host/namespace.ts`); the deploy helper installs them there
// and the AppArmor file grants them user namespaces by path. A path that drifts
// in one of the three is a browser that does not start, or a Chrome that
// silently loses its sandbox, so these checks tie the files to the constants.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { UNIT_HOST_BROWSER_PATH } from "../../src/core/browser/install.js";
import { NAMESPACE_PASTA, NAMESPACE_UNSHARE } from "../../src/core/browser/host/namespace.js";
import { sandboxPageSaysSandboxed } from "../../src/core/browser/host/sandbox-check.js";

const apparmor = await readFile("deploy/apparmor/beebox-browser", "utf8");
const helper = await readFile("deploy/server-bin/bbx-browser-install", "utf8");
const deploy = await readFile("deploy/deploy.sh", "utf8");
const cloudInit = await readFile("deploy/hetzner/cloud-init.yaml", "utf8");

const browserRoot = path.dirname(UNIT_HOST_BROWSER_PATH);

void test("The AppArmor profiles name the launcher's unshare and the Chrome the deploy links", (t) => {
  const profiles = [...apparmor.matchAll(/^profile (\S+) (\S+) flags=\(unconfined\) {\n {2}userns,\n}/gm)].map((m) => ({ name: m[1], path: m[2] }));
  t.check(profiles, [
    { name: "beebox-browser-unshare", path: NAMESPACE_UNSHARE },
    { name: "beebox-browser-chrome", path: `${browserRoot}/.agent-browser/browsers/*/chrome` },
  ]);
  t.end();
});

void test("The helper installs to the paths the engine reads", (t) => {
  t.check(helper, any(String).includes(`readonly ROOT=${browserRoot}`));
  t.check(helper, any(String).includes('readonly LINK="$ROOT/chrome"'));
  t.check(`${browserRoot}/chrome`, UNIT_HOST_BROWSER_PATH);
  t.check(helper, any(String).includes('readonly UNSHARE="$ROOT/bin/unshare"'));
  t.check(`${browserRoot}/bin/unshare`, NAMESPACE_UNSHARE);
  // Only box users may run the copy AppArmor exempts.
  t.check(helper, any(String).includes("install -o root -g beebox-boxes -m 0750 /usr/bin/unshare"));
  // The Chrome glob in the profile matches what the helper links.
  t.check(helper, any(String).includes("-path '*/chrome-*/chrome'"));
  t.end();
});

void test("Every deploy runs the helper and a new host gets pasta", (t) => {
  t.check(deploy, any(String).includes('< "$CHECKOUT/beebox/deploy/server-bin/bbx-browser-install"'));
  t.check(NAMESPACE_PASTA, "/usr/bin/pasta");
  t.check(cloudInit, any(String).includes("\n  - passt\n"));
  t.end();
});

// chrome://sandbox says "You are not adequately sandboxed." when it is not.
void test("The sandbox check passes only on the positive sentence", (t) => {
  t.check(
    ["You are adequately sandboxed.", "You are not adequately sandboxed.", ""].map(sandboxPageSaysSandboxed),
    [true, false, false],
  );
  t.end();
});
