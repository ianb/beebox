// # The pinned dashboard bundle still has the shape the rewrite expects
//
// docs/plans/shared-browser.md, Track C ("What will hold this after it ships")
// and the Failure-modes row on rewrite drift. Starts the real pinned
// agent-browser dashboard on a temp socket directory, fetches the page and
// every `/_next/static` script and stylesheet it names, and checks two things:
// the number of root-absolute path sites is the number observed at the pinned
// version (an upgrade that changes the bundle changes the count and fails
// here), and after the rewrite no unprefixed site remains.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import { freePort } from "../../../src/lib/free-port.js";
import { countDashboardPathSites, rewriteDashboardBody } from "../../../src/core/browser/rewrite.js";

const execFileP = promisify(execFile);

const AGENT_BROWSER = path.join(PACKAGE_ROOT, "..", "node_modules", ".bin", "agent-browser");
const PREFIX = "/test1/browser";
const START_TIMEOUT_MS = 30_000;
/** Path sites in the pinned agent-browser 0.39.2 dashboard (page, scripts, stylesheets). */
const PINNED_PATH_SITES = 59;

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} returned ${String(response.status)}`);
  return await response.text();
}

async function waitForPage(base: string): Promise<string> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  for (;;) {
    try {
      return await fetchText(`${base}/`);
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

void test("The pinned dashboard's path sites are the counted ones, and the rewrite prefixes all of them", async (t) => {
  const socketDir = await fs.mkdtemp("/tmp/bbxdash-");
  const port = await freePort();
  const env = { ...process.env, AGENT_BROWSER_SOCKET_DIR: socketDir };
  t.teardown(async () => {
    await execFileP(AGENT_BROWSER, ["dashboard", "stop"], { env }).catch(() => 0);
    await fs.rm(socketDir, { recursive: true, force: true });
  });
  await execFileP(AGENT_BROWSER, ["dashboard", "start", "--port", String(port)], { env });
  const base = `http://127.0.0.1:${String(port)}`;
  const html = await waitForPage(base);
  const assetPaths = [...new Set([...html.matchAll(/\/_next\/static\/[^\s"')\\]+?\.(?:js|css)/g)].map((m) => m[0]))].toSorted();
  const bodies = [html];
  for (const asset of assetPaths) bodies.push(await fetchText(`${base}${asset}`));
  // One entry per body: the page, then its 13 scripts and stylesheets.
  t.check(bodies.map((body) => countDashboardPathSites(body)), [46, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 10, 0, 1]);
  t.check(bodies.reduce((sum, body) => sum + countDashboardPathSites(body), 0), PINNED_PATH_SITES);
  t.check(bodies.map((body) => countDashboardPathSites(rewriteDashboardBody(body, PREFIX))), bodies.map(() => 0));
  // No `/_next/` or `/api/` occurs in a form the pattern misses.
  t.check(bodies.reduce((sum, body) => sum + (body.match(/\/_next\/|\/api\//g) ?? []).length, 0), PINNED_PATH_SITES);
  t.check(bodies.map((body) => /(["'(`]|\\")\/(_next|api)\//.test(rewriteDashboardBody(body, PREFIX))), bodies.map(() => false));
});
