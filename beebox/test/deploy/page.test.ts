// # The deploy page
//
// While a production deploy has the hub stopped, nginx serves a page that says
// an update is running (`deploy/nginx/beebox.conf`). The page is public, so it
// states only when the update started and how long updates usually take. Its
// words come from `deployPageText`, and they stop promising a quick return once
// a deploy overruns.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { deployPageText } from "../../src/shared/deploy-page-text.js";
import { PLACEHOLDERS, renderDeployPageTemplate } from "../../src/scripts/build-deploy-page.js";

const started = Date.UTC(2026, 8, 18, 21, 41);
const minute = 60_000;
const text = (elapsedMs: number, typicalSeconds: number | null) =>
  deployPageText({ startedMs: started, nowMs: started + elapsedMs, typicalSeconds, startedLabel: "9:41 PM" });

// A deploy in its usual window says so, with the recorded typical duration.
void test("A deploy in its usual window says so, with the recorded typical duration.", async (t) => {
  // doctest:L24
  t.check(text(3 * minute, 228).headline, "This site is updating");

  // doctest:L27
  t.check(text(3 * minute, 228).detail, "The update started at 9:41 PM, 3 minutes ago. Updates usually take about 4 minutes. This page reloads when the site is back.");
});

// The elapsed time counts in seconds while the update could still be running
// normally. The estimate rounds up to the next whole minute, so 162 seconds is
// "about 3 minutes".
void test("The elapsed time counts in seconds while the update could still be running no...", async (t) => {
  // doctest:L36
  t.check(text(2 * minute + 14_000, 162).detail, "The update started at 9:41 PM, 2 minutes 14 seconds ago. Updates usually take about 3 minutes. This page reloads when the site is back.");

  // doctest:L39
  t.check(text(61_000, 181).detail, "The update started at 9:41 PM, 1 minute 1 second ago. Updates usually take about 4 minutes. This page reloads when the site is back.");

  // doctest:L42
  t.check(text(45_000, 162).detail, "The update started at 9:41 PM, 45 seconds ago. Updates usually take about 3 minutes. This page reloads when the site is back.");
});

// With no recorded window yet, the estimate is vague instead of invented. A
// viewer whose clock runs behind the server's never sees a negative time.
void test("With no recorded window yet, the estimate is vague instead of invented.", async (t) => {
  // doctest:L50
  t.check(text(-2 * minute, null).detail, "The update started at 9:41 PM, just now. Updates usually take a few minutes. This page reloads when the site is back.");
});

// Past ten minutes the page says the update is late.
void test("Past ten minutes the page says the update is late.", async (t) => {
  // doctest:L57
  t.check(text(12 * minute, 228).headline, "This update is taking longer than usual");

  // doctest:L60
  t.check(text(12 * minute, 228).detail, "It started at 9:41 PM, 12 minutes ago. Updates usually take about 4 minutes. This page reloads when the site is back.");
});

// Past an hour, which is where a page stranded by a killed deploy ends up, it
// says something has probably gone wrong.
void test("Past an hour, which is where a page stranded by a killed deploy ends up, it s...", async (t) => {
  // doctest:L68
  t.check(text(3 * 60 * minute, 228).headline, "This site is down");

  // doctest:L71
  t.check(text(3 * 60 * minute, 228).detail, "An update started at 9:41 PM, 3 hours ago, and has not finished. Updates normally take about 4 minutes, so something has probably gone wrong.");
});

// ## The built page
//
// `deploy/deploy.sh` runs `src/scripts/build-deploy-page.ts` with plain `node`
// (no tsx), whose type stripping does not map a `.js` import to its `.ts` file;
// every relative import that script reaches must name the `.ts` file. Loading it
// the same way proves that.
void test("deploy/deploy.sh runs src/scripts/build-deploy-page.ts with plain node (no ts...", async (t) => {
  // doctest:L83
  const { execFileSync } = await import("node:child_process");
  t.check(execFileSync("node", ["--input-type=module", "-e", "await import('./src/scripts/build-deploy-page.ts')"], { encoding: "utf8" }), "");
});

// `src/scripts/build-deploy-page.ts` bundles the browser code into one
// self-contained HTML template. The server helper fills its placeholders with
// `sed`, so the helper must use the same three names.
void test("src/scripts/build-deploy-page.ts bundles the browser code into one self-conta...", async (t) => {
  // doctest:L93
  const template = await renderDeployPageTemplate();
  const helper = await readFile("deploy/server-bin/bbx-deploy-window", "utf8");
  t.check(Object.values(PLACEHOLDERS).map((p) => [template.split(p).length - 1, helper.includes(p)]), [
    [
      1,
      true,
    ],
    [
      1,
      true,
    ],
    [
      1,
      true,
    ],
  ]);

  // Above the text hangs the same paper sign the hub shows for a closed box
  // (`src/lib/closed-sign.ts`): it swings once on load and holds still under
  // reduced motion. Its words hold for every state the text below can reach.

  // doctest:L104
  await t.checkText(JSON.stringify({ sign: template.match(/<div class="bbx-sign swing">[\S\s]*?<strong class="bbx-sign-title">([^<]*)<\/strong><p>([^<]*)<\/p>/)?.slice(1), stillWhenReduced: /prefers-reduced-motion: reduce\) { \.bbx-sign\.swing { animation: none/.test(template) }), "{\"sign\":[\"Closed\",\"for an update\"],\"stillWhenReduced\":true}");

  // The filled page, run with a stub DOM, rewrites the text in the reader's time
  // and reloads as soon as the site answers without the deploy header.

  // doctest:L112
  const page = template
    .replace(PLACEHOLDERS.startedMs, String(Date.now() - 3 * minute))
    .replace(PLACEHOLDERS.startedUtc, "2026-09-18 21:41 UTC")
    .replace(PLACEHOLDERS.typicalSeconds, "228");
  const scripts = [...page.matchAll(/<script(?: type="application\/json" id="(\w[\w-]*)")?>([\S\s]*?)<\/script>/g)];
  const nodes: Record<string, { textContent: string }> = {
    "bbx-deploy": { textContent: scripts[0]![2]! },
    "bbx-headline": { textContent: "" },
    "bbx-detail": { textContent: "" },
  };
  let reloads = 0;
  let deployHeader = true;
  const sandbox = {
    document: { getElementById: (id: string) => nodes[id] ?? null },
    location: { href: "https://box.example.com/a/b", reload: () => { reloads += 1; } },
    fetch: async () => ({ headers: new Headers(deployHeader ? { "X-Beebox-Deploy": "in-progress" } : {}) }),
    setInterval: () => 0,
    console,
  };
  runInNewContext(scripts[1]![2]!, sandbox);
  await new Promise((resolve) => setTimeout(resolve, 0));
  t.check([nodes["bbx-headline"]!.textContent, nodes["bbx-detail"]!.textContent.includes("3 minutes"), reloads], [
    "This site is updating",
    true,
    0,
  ]);

  // doctest:L136
  deployHeader = false;
  runInNewContext(scripts[1]![2]!, sandbox);
  await new Promise((resolve) => setTimeout(resolve, 0));
  t.check(reloads, 1);
});
