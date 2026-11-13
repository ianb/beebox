// Rollback switches to the previous release only when that engine knows every
// migration a box has applied, the previous release did not already fail, and
// the live release is the one the caller expects.
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { FAILED_MARK, switchRelease } from "../../../src/scripts/deploy-releases/layout.js";
import { decideRollback, rollbackRelease } from "../../../src/scripts/deploy-releases/rollback.js";
import { linkTarget, makeBox, makeHost, makeRelease, type Host } from "./fixture.js";

/** r1 (knows m1) is previous, r2 (knows m1, m2) is live. */
function twoReleases(): Host {
  const host = makeHost();
  switchRelease(host.layout, makeRelease(host, { name: "r1", migrations: ["m1"] }));
  switchRelease(host.layout, makeRelease(host, { name: "r2", migrations: ["m1", "m2"] }));
  return host;
}

function reason(host: Host, expectedFrom: string | null): string {
  const decision = decideRollback(host.layout, { expectedFrom, boxesRoot: host.boxesRoot });
  return decision.ok ? "ok" : decision.reason.replaceAll(host.root, "<root>");
}

void test("a rollback whose boxes applied only known migrations switches back and marks the release it leaves", async (t) => {
  const host = twoReleases();
  t.teardown(host.cleanup);
  makeBox(host, { slug: "alpha", manifest: { applied: ["m1"] } });
  const live = path.join(host.layout.releasesDir, "r2");

  rollbackRelease(host.layout, { expectedFrom: live, boxesRoot: host.boxesRoot });

  t.check({
    live: linkTarget(host, host.layout.installDir),
    previous: linkTarget(host, host.layout.previousLink),
    marked: fs.existsSync(path.join(live, FAILED_MARK)),
  }, { live: "opt/beebox.releases/r1", previous: "opt/beebox.releases/r2", marked: true });
  // A second rollback would return to the release that just failed.
  t.check(reason(host, null), "the previous release <root>/opt/beebox.releases/r2 already failed and was rolled back");
});

void test("a new migration no box applied does not block a rollback", async (t) => {
  const host = twoReleases();
  t.teardown(host.cleanup);
  makeBox(host, { slug: "alpha", manifest: { applied: ["m1"] } });
  makeBox(host, { slug: "bravo", manifest: { applied: [] } });
  t.check(reason(host, null), "ok");
});

void test("a migration a box applied that the previous engine does not know refuses", async (t) => {
  const host = twoReleases();
  t.teardown(host.cleanup);
  makeBox(host, { slug: "alpha", manifest: { applied: ["m1", "m2"] } });
  t.check(reason(host, null), "boxes applied migrations the previous release does not know (m2); fix forward or deploy a chosen commit with deploy.sh --ref");
});

void test("an unreadable manifest or migration list refuses", async (t) => {
  const host = twoReleases();
  t.teardown(host.cleanup);
  makeBox(host, { slug: "alpha", manifest: { raw: "{not json\n" } });
  t.check(reason(host, null), "a box's migration manifest could not be read");
  // A box with no manifest at all: what it holds is unknown.
  fs.rmSync(path.join(host.boxesRoot, "alpha", "box", "_config", "migrations.jsonl"));
  t.check(reason(host, null), "a box's migration manifest could not be read");
  // A directory that is not a box (no .git) is not consulted.
  fs.rmSync(path.join(host.boxesRoot, "alpha", "box", ".git"), { recursive: true });
  t.check(reason(host, null), "ok");
  fs.rmSync(path.join(host.boxesRoot, "alpha"), { recursive: true });
  fs.rmSync(path.join(host.layout.releasesDir, "r1", "beebox", "src", "core", "migrations.ts"));
  t.check(reason(host, null), "the previous release <root>/opt/beebox.releases/r1 has no readable migration list");
});

void test("a rollback refuses when the live release is not the expected one, or there is no previous", async (t) => {
  const host = twoReleases();
  t.teardown(host.cleanup);
  t.check(reason(host, path.join(host.layout.releasesDir, "r1")),
    "the live release is <root>/opt/beebox.releases/r2, not <root>/opt/beebox.releases/r1");
  fs.rmSync(host.layout.previousLink);
  t.check(reason(host, null), "there is no previous release");
});
