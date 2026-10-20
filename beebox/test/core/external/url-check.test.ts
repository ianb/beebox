// # external-url-check: git-based new-URL detection + verdict cache
//
// `checkExternalUrls` only HEADs a URL the **first time it appears**: a URL already
// present in the base git version is never re-checked. The network checker is
// injected here so the git detection + the gitignored verdict cache are exercised
// offline.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as path from "node:path";
import { checkExternalUrls, UrlCheckRunningError } from "../../../src/core/external/url-check/core.js";
import { acquireLock, releaseLock } from "../../../src/lib/file-lock.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import type { UrlVerdict } from "../../../src/core/external/url-check/fetch.js";

// A stub checker: records what it was asked to check, and reports any URL in
// `broken` as a hard 404, everything else as ok.
function stubChecker(broken: Set<string>, log: string[][]) {
  return (urls: string[]): Promise<UrlVerdict[]> => {
    log.push([...urls].toSorted());
    return Promise.resolve(
      urls.map((url) => ({
        url,
        reason: broken.has(url) ? "broken" : "ok",
        status: broken.has(url) ? 404 : 200,
        method: "HEAD",
        detail: broken.has(url) ? "HTTP 404" : "HTTP 200",
      })),
    );
  };
}

const NOW = "2026-06-28T00:00:00.000Z";

// Commit a doc with one URL, then add a second URL without committing. A working-
// tree check (base = HEAD) sees only the *new* URL — the committed one is never
// handed to the checker:
void test("Commit a doc with one URL, then add a second URL without committing.", async (t) => {
  const box = await makeTmpBox({ git: true });
  await box.write("notes.md", "[old](https://host-a.linkcheck.dev/a)\n");
  box.commitAll("seed");
  await box.write(
    "notes.md",
    "[old](https://host-a.linkcheck.dev/a)\n[new](https://host-b.linkcheck.dev/b)\n",
  );

  const log: string[][] = [];
  const r1 = await checkExternalUrls(box.root, {
    mode: { kind: "working" },
    now: NOW,
    check: stubChecker(new Set(), log),
  });
  t.check({ checkedThisRun: log[0], reportChecked: r1.checked, broken: r1.broken }, {
    checkedThisRun: [
      "https://host-b.linkcheck.dev/b",
    ],
    reportChecked: 1,
    broken: [],
  });

  // Now make a newly-added URL broken. It's reported, and recorded in the gitignored
  // cache so it keeps surfacing — and a *good* URL is stored nowhere:

  await box.write(
    "notes.md",
    "[old](https://host-a.linkcheck.dev/a)\n[bad](https://host-c.linkcheck.dev/c)\n",
  );
  const r2 = await checkExternalUrls(box.root, {
    mode: { kind: "working" },
    now: NOW,
    check: stubChecker(new Set(["https://host-c.linkcheck.dev/c"]), []),
  });
  const cache = JSON.parse(await box.read(".beebox/url-checks.json"));
  await t.checkText(
    JSON.stringify(
      { broken: r2.broken.map((b) => b.url), cacheBroken: Object.keys(cache.broken), cachePending: Object.keys(cache.pending) },
      null,
      2,
    ),
    `{
  "broken": [
    "https://host-c.linkcheck.dev/c"
  ],
  "cacheBroken": [
    "https://host-c.linkcheck.dev/c"
  ],
  "cachePending": []
}`,
  );

  // A known-bad URL is re-checked even though it's no longer "new" (it's now in
  // HEAD's base set) — and once it returns ok it's dropped from the cache and the
  // report goes clean:

  box.commitAll("commit the bad link");
  const log3: string[][] = [];
  const r3 = await checkExternalUrls(box.root, {
    mode: { kind: "working" },
    now: NOW,
    check: stubChecker(new Set(), log3), // c now resolves ok
  });
  const cache3 = JSON.parse(await box.read(".beebox/url-checks.json"));
  t.check({ recheckedThisRun: log3[0], broken: r3.broken, cacheBroken: Object.keys(cache3.broken) }, {
    recheckedThisRun: [
      "https://host-c.linkcheck.dev/c",
    ],
    broken: [],
    cacheBroken: [],
  });

  await box.cleanup();
});

// ## One check per box at a time
//
// The post-commit hook starts a detached check on every commit. A check that
// finds another one running for the same box checks nothing and says so, so a
// burst of commits cannot pile them up (82 at once on 2026-09-05,
// issues/closed/bugs/2026-09-05-background-url-check-spins-forever-after-commit.md).
void test("A second concurrent check for the same box does not start", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await box.write("notes.md", "no links yet\n");
  box.commitAll("seed");
  await box.write("notes.md", "[a](https://host-a.linkcheck.dev/a)\n");

  const lockPath = path.join(box.root, ".beebox/url-check.lock");
  await acquireLock(lockPath, { purpose: "url-check" });
  const log: string[][] = [];
  const blocked = await checkExternalUrls(box.root, { mode: { kind: "working" }, now: NOW, check: stubChecker(new Set(), log) })
    .then(() => "ran", (e: unknown) => e instanceof UrlCheckRunningError ? e.message : e);
  t.check({ blocked, log }, {
    blocked: `Another URL check is running for this box (pid ${String(process.pid)}); not starting a second.`,
    log: [],
  });

  // Once the other check releases, the next one runs:

  await releaseLock(lockPath);
  const report = await checkExternalUrls(box.root, { mode: { kind: "working" }, now: NOW, check: stubChecker(new Set(), log) });
  t.check({ checked: report.checked, log }, { checked: 1, log: [["https://host-a.linkcheck.dev/a"]] });
});

// </content>
