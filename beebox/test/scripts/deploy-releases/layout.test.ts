// Release switching: the install dir becomes a link to one complete release,
// `previous` names the release it replaced, and pruning keeps both plus any
// release a running process started from.
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { ReleaseRefusedError, pruneReleases, releasesNamedIn, switchRelease } from "../../../src/scripts/deploy-releases/layout.js";
import { linkTarget, makeHost, makeRelease } from "./fixture.js";

function refusalKind(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof ReleaseRefusedError) return e.refusal.kind;
    throw e;
  }
  return "no refusal";
}

void test("the first switch moves the legacy tree aside and makes it the rollback target", async (t) => {
  const host = makeHost();
  t.teardown(host.cleanup);
  fs.mkdirSync(path.join(host.layout.installDir, "beebox"), { recursive: true });
  fs.writeFileSync(path.join(host.layout.installDir, "beebox", "deploy-history.json"), "[]");
  const release = makeRelease(host, { name: "r1", migrations: [] });

  const from = switchRelease(host.layout, release);

  const legacy = path.basename(from ?? "");
  t.check({
    legacyNamed: /^legacy-\d{8}T\d{6}Z$/.test(legacy),
    live: linkTarget(host, host.layout.installDir),
    previous: linkTarget(host, host.layout.previousLink),
    legacyKept: fs.existsSync(path.join(host.layout.releasesDir, legacy, "beebox", "deploy-history.json")),
  }, { legacyNamed: true, live: "opt/beebox.releases/r1", previous: `opt/beebox.releases/${legacy}`, legacyKept: true });
});

void test("a switch between releases records the old one as previous", async (t) => {
  const host = makeHost();
  t.teardown(host.cleanup);
  switchRelease(host.layout, makeRelease(host, { name: "r1", migrations: [] }));
  switchRelease(host.layout, makeRelease(host, { name: "r2", migrations: [] }));
  t.check({ live: linkTarget(host, host.layout.installDir), previous: linkTarget(host, host.layout.previousLink) },
    { live: "opt/beebox.releases/r2", previous: "opt/beebox.releases/r1" });
});

void test("an empty install dir from provisioning is replaced and leaves no rollback target", async (t) => {
  const host = makeHost();
  t.teardown(host.cleanup);
  fs.mkdirSync(host.layout.installDir);
  t.check(switchRelease(host.layout, makeRelease(host, { name: "r1", migrations: [] })), null);
  t.check(linkTarget(host, host.layout.previousLink), null);
});

void test("a switch refuses an incomplete release or one outside the releases dir", async (t) => {
  const host = makeHost();
  t.teardown(host.cleanup);
  const incomplete = makeRelease(host, { name: "r1", migrations: [] });
  fs.rmSync(path.join(incomplete, "node_modules"), { recursive: true });
  const outside = path.join(host.root, "elsewhere");
  fs.mkdirSync(outside);
  t.check([refusalKind(() => switchRelease(host.layout, incomplete)), refusalKind(() => switchRelease(host.layout, outside))],
    ["incomplete", "outside-releases"]);
  t.check(fs.existsSync(host.layout.installDir), false);
});

void test("pruning keeps the live, previous and in-use releases", async (t) => {
  const host = makeHost();
  t.teardown(host.cleanup);
  for (const name of ["r1", "r2", "r3", "r4"]) makeRelease(host, { name, migrations: [] });
  switchRelease(host.layout, path.join(host.layout.releasesDir, "r3"));
  switchRelease(host.layout, path.join(host.layout.releasesDir, "r4"));
  fs.symlinkSync("r4", path.join(host.layout.releasesDir, ".beebox.tmp-1"));

  t.check(pruneReleases(host.layout, new Set(["r1"])), [".beebox.tmp-1", "r2"]);
  t.check(fs.readdirSync(host.layout.releasesDir).toSorted(), ["previous", "r1", "r3", "r4"]);
});

void test("a process's command line names the release it runs from, through either spelling of the dir", async (t) => {
  const cmdlines = [
    "node\0--enable-source-maps\0/opt/beebox.releases/r2/beebox/dist/cli.mjs\0engine\0backup\0",
    "node\0/real/opt/beebox.releases/r3/beebox/dist/cli.mjs\0",
    "bash\0/opt/beebox/beebox/bin/bbx\0",
    "ls\0/opt/beebox.releases/\0",
  ];
  t.check([...releasesNamedIn(cmdlines, ["/opt/beebox.releases", "/real/opt/beebox.releases"])].toSorted(), ["r2", "r3"]);
});
