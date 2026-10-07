/**
 * `pnpm perf:load` — measure box page loads in a real browser and report the
 * first-load milestones. See `docs/development/performance.md`.
 *
 *   pnpm perf:load                                  # local perf hub, 4G, 4x CPU, cold cache, 5 runs
 *   pnpm perf:load --box-state cold                 # restart the hub before each run: box cold start
 *   pnpm perf:load --cache warm --profile slow4g    # a repeat visit on a slow connection
 *   pnpm perf:load --target prod --box <slug>       # production, through the real edge
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { PACKAGE_ROOT } from "../../../lib/package-root.js";
import { CdpConnection } from "./cdp.js";
import { PERF_DIAG_KEY, makeBoxCold, perfResultsDir, perfSessionCookie, readDaemonPid, readPerfHubConfig } from "../local-hub.js";
import { NETWORK_PROFILES, measurePageLoad, type PageLoadOptions } from "./page-load.js";
import { DEFAULT_UNTIL_MARK } from "./page-metrics.js";
import { formatSummary, formatWaterfall, medianRun, type ResultFile, type RunRecord, type ServerStart } from "../report.js";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const REPO_ROOT = path.dirname(PACKAGE_ROOT);

interface Target {
  name: string;
  url: string;
  cookie: string;
  /** Local only: the hub port, for reading box start timings. */
  hubPort: number | undefined;
}

async function localTarget(values: { path?: string; raw?: boolean }): Promise<Target> {
  const config = await readPerfHubConfig();
  if (!config || (await readDaemonPid()) === undefined) fail("perf hub is not running; start it with `pnpm perf:hub up`");
  const port = values.raw === true ? config.hubPort : config.edgePort;
  return { name: values.raw === true ? "local-raw" : "local", url: `http://127.0.0.1:${port}/${config.slug}${values.path ?? "/"}`, cookie: perfSessionCookie(), hubPort: config.hubPort };
}

function prodTarget(values: { path?: string; box?: string; url?: string }): Target {
  if (values.box === undefined) fail("--target prod needs --box <slug>");
  const minted = z.object({ publicUrl: z.string(), cookie: z.string() }).parse(JSON.parse(execFileSync(path.join(PACKAGE_ROOT, "deploy", "prod-session-cookie"), { encoding: "utf-8" })));
  const origin = values.url ?? minted.publicUrl;
  if (origin === "") fail("no production URL: set BBX_DEPLOY_PUBLIC_URL in target.env or pass --url");
  return { name: "prod", url: `${origin.replace(/\/$/, "")}/${values.box}${values.path ?? "/"}`, cookie: minted.cookie, hubPort: undefined };
}

const hubHealth = z.object({ boxes: z.array(z.object({ slug: z.string(), port: z.number().optional(), lastStart: z.object({ spawnMs: z.number(), readyMs: z.number() }).optional() })) });
const childHealth = z.object({ startup: z.array(z.object({ phase: z.string(), atMs: z.number() })).optional() });

/** Reads the hub's last launch timing and the child's boot phases (both diag-key gated). */
async function readServerStart(hubPort: number): Promise<ServerStart> {
  const auth = { headers: { authorization: `Bearer ${PERF_DIAG_KEY}` } };
  const hub = hubHealth.parse(await (await fetch(`http://127.0.0.1:${hubPort}/healthz`, auth)).json());
  const box = hub.boxes[0];
  if (box?.port === undefined) return { hub: box?.lastStart, phases: undefined };
  const child = childHealth.parse(await (await fetch(`http://127.0.0.1:${box.port}/healthz`, auth)).json());
  return { hub: box.lastStart, phases: child.startup };
}

function cdpUrl(explicit: string | undefined): string {
  if (explicit !== undefined) return explicit;
  // The browse skill's browser (bin/browse); starts its daemon when needed.
  const out = execFileSync(path.join(REPO_ROOT, "bin", "browse"), ["get", "cdp-url"], { encoding: "utf-8" });
  const url = out.trim().split("\n").findLast((l) => l.startsWith("ws://"));
  return url ?? fail(`could not read a CDP URL from bin/browse: ${out}`);
}

function gitDescribe(): string {
  const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: REPO_ROOT, encoding: "utf-8" }).trim() !== "";
  return dirty ? `${head}+dirty` : head;
}

const OPTIONS = {
  target: { type: "string", default: "local" },
  path: { type: "string" },
  box: { type: "string" },
  url: { type: "string" },
  raw: { type: "boolean" },
  profile: { type: "string", default: "4g" },
  cpu: { type: "string", default: "4" },
  cache: { type: "string", default: "cold" },
  "box-state": { type: "string", default: "warm" },
  runs: { type: "string", default: "5" },
  until: { type: "string", default: DEFAULT_UNTIL_MARK },
  label: { type: "string" },
  trace: { type: "boolean" },
  verbose: { type: "boolean" },
  cdp: { type: "string" },
} as const;

async function main(): Promise<void> {
  const { values } = parseArgs({ options: OPTIONS });
  const target = values.target === "prod" ? prodTarget(values) : await localTarget(values);
  const profile = NETWORK_PROFILES[values.profile];
  if (profile === undefined) fail(`unknown --profile ${values.profile}; one of ${Object.keys(NETWORK_PROFILES).join(", ")}`);
  if (values.cache !== "cold" && values.cache !== "warm") fail("--cache is cold or warm");
  const boxCold = values["box-state"] === "cold";
  if (boxCold && target.hubPort === undefined) fail("--box-state cold needs the local perf hub (production boxes cannot be stopped from here)");
  const runs = Number(values.runs);
  const label = values.label ?? `${target.name}-${values.profile}-cpu${values.cpu}-${values.cache}cache${boxCold ? "-coldbox" : ""}`;
  const stamp = new Date().toISOString().replaceAll(/[.:]/g, "-");
  await fs.mkdir(perfResultsDir(), { recursive: true });
  // A warm-box measurement must not pay a cold start: wake the box first.
  if (!boxCold && target.hubPort !== undefined) await fetch(target.url, { headers: { cookie: `bbx_session=${target.cookie}` } });
  const cdp = await CdpConnection.connect(cdpUrl(values.cdp));
  const records: RunRecord[] = [];
  try {
    for (let i = 0; i < runs; i++) {
      if (boxCold) await makeBoxCold();
      const tracePath = values.trace === true ? path.join(perfResultsDir(), `${stamp}-${label}-run${i + 1}.trace.json`) : undefined;
      const options: PageLoadOptions = { url: target.url, sessionCookie: target.cookie, profile, cpuRate: Number(values.cpu), cache: values.cache, untilMark: values.until, timeoutMs: 120_000, tracePath };
      const result = await measurePageLoad(cdp, options);
      const serverStart = boxCold && target.hubPort !== undefined ? await readServerStart(target.hubPort) : undefined;
      records.push({ ...result, serverStart });
      process.stderr.write(`run ${i + 1}/${runs}: history=${result.marks[DEFAULT_UNTIL_MARK] ?? "-"}ms${tracePath === undefined ? "" : ` trace=${tracePath}`}\n`);
    }
  } finally {
    cdp.close();
  }
  const file: ResultFile = {
    meta: { label, at: new Date().toISOString(), git: gitDescribe(), target: target.name, url: new URL(target.url).pathname, profile: values.profile, cpuRate: Number(values.cpu), cache: values.cache, boxState: boxCold ? "cold" : "warm" },
    runs: records,
  };
  const out = path.join(perfResultsDir(), `${stamp}-${label}.json`);
  await fs.writeFile(out, `${JSON.stringify(file, null, 2)}\n`);
  console.log(formatSummary(file));
  const representative = medianRun(records);
  if (values.verbose === true && representative) console.log(`\nmedian run waterfall (ms from navigation):\n${formatWaterfall(representative)}`);
  console.log(`\nresults: ${out}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
