// # Where a box's browser keeps its files, and which Chromium it runs
//
// docs/plans/shared-browser.md, Track B. The profile holds the person's
// logins, so it sits outside the box repository and outside `_tmp/`; two
// boxes on one machine never share one, even two dev clones with the same
// slug; and a socket path over the Unix limit fails here, naming the path,
// instead of deep inside agent-browser.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { boxRootKey, BrowserPathTooLongError, browserPaths } from "../../../src/core/browser/paths.js";
import { resolveBrowserExecutable, UNIT_HOST_BROWSER_PATH } from "../../../src/core/browser/install.js";

const STATE = "/Users/me/.local/share/beebox";

void test("Each box gets its own directory under the state directory", (t) => {
  const key = boxRootKey("/Users/me/boxes/kitchen");
  t.check(key, "9cdeb62e");
  t.check(browserPaths({ boxRoot: "/Users/me/boxes/kitchen", slug: "kitchen", stateDir: STATE }), {
    root: `${STATE}/browser/kitchen-${key}`,
    profile: `${STATE}/browser/kitchen-${key}/profile`,
    socketDir: `${STATE}/browser/kitchen-${key}/sock`,
    relaySocket: `${STATE}/browser/kitchen-${key}/dashboard.sock`,
    cliSocket: `${STATE}/browser/kitchen-${key}/cli.sock`,
    downloads: `${STATE}/browser/kitchen-${key}/downloads`,
    log: `${STATE}/browser/kitchen-${key}/host.log`,
    config: `${STATE}/browser/kitchen-${key}/agent-browser.json`,
  });
  t.end();
});

// Two dev worktrees each have a clone named test1 under one OS user. Keyed by
// slug alone they would share logins and stop each other's browser
// (cross-model review, 2026-10-30).
void test("Two boxes with the same slug in different places get different directories", (t) => {
  const a = browserPaths({ boxRoot: "/Users/me/src/box-worktrees/alpha/test1", slug: "test1", stateDir: STATE });
  const b = browserPaths({ boxRoot: "/Users/me/src/box-worktrees/beta/test1", slug: "test1", stateDir: STATE });
  t.check([a.root, b.root], [`${STATE}/browser/test1-3caf1411`, `${STATE}/browser/test1-f860c15e`]);
  t.end();
});

// The daemon socket `<root>/sock/box.sock` is the longer of the two sockets.
void test("A socket path over 100 bytes is refused with the path in the message", async (t) => {
  const longSlug = "a-box-with-a-rather-long-name-for-testing";
  const box = { boxRoot: "/x", slug: longSlug, stateDir: "/Users/you/a-rather-deep/state/.local/share/beebox" };
  await t.checkThrows(() => browserPaths(box), "BrowserPathTooLongError");
  try {
    browserPaths(box);
  } catch (err) {
    t.check(err instanceof BrowserPathTooLongError ? err.socketPath : err, `/Users/you/a-rather-deep/state/.local/share/beebox/browser/${longSlug}-b3d1db31/sock/box.sock`);
  }
});

void test("On a unit host the browser is the deploy's link, or nothing", (t) => {
  t.check(resolveBrowserExecutable({ unitHost: true, env: {}, exists: () => true }), { ok: true, executablePath: UNIT_HOST_BROWSER_PATH });
  t.check(resolveBrowserExecutable({ unitHost: true, env: {}, exists: () => false }), {
    ok: false,
    reason: `the server has no browser installed (${UNIT_HOST_BROWSER_PATH} is missing; the deploy installs it)`,
  });
  t.end();
});

void test("Off a unit host agent-browser chooses, unless the environment names a binary", (t) => {
  t.check(resolveBrowserExecutable({ unitHost: false, env: {}, exists: () => false }), { ok: true, executablePath: undefined });
  t.check(resolveBrowserExecutable({ unitHost: false, env: { AGENT_BROWSER_EXECUTABLE_PATH: "/opt/chrome" }, exists: () => true }), {
    ok: true,
    executablePath: "/opt/chrome",
  });
  // A named binary that is not there is an error, never a silent fallback.
  t.check(resolveBrowserExecutable({ unitHost: true, env: { AGENT_BROWSER_EXECUTABLE_PATH: "/opt/chrome" }, exists: () => false }), {
    ok: false,
    reason: "AGENT_BROWSER_EXECUTABLE_PATH names /opt/chrome, which does not exist",
  });
  t.end();
});
