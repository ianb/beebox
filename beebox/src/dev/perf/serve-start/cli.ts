/**
 * `pnpm perf:serve-start` — time a cold `bbx engine serve` of one box, phase by
 * phase, the way the hub starts it on a box's first request.
 *
 *   pnpm perf:serve-start                    # worktree test1 clone, 5 runs
 *   pnpm perf:serve-start --cpu-prof         # plus a CPU profile of each start, summarized by source owner
 *
 * The phases come from the child's own `/healthz` (`lib/startup-timing.ts`).
 * Spawn-to-listening is measured here with a 5 ms connect poll, finer than the
 * hub's readiness probe. See `docs/development/performance.md`.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { PACKAGE_ROOT } from "../../../lib/package-root.js";
import { summarizeProfile } from "./cpu-profile.js";
import { PERF_DIAG_KEY, bbxBin, ensurePerfBox, perfHubEnv, perfResultsDir } from "../local-hub.js";
import { median } from "../report.js";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

/** A live `bbx serve` for this box would be killed by the new one (with a 1 s wait), skewing the timing. */
async function assertBoxNotServed(box: string): Promise<void> {
  const pidFile = path.join(box, ".bbx-serve.pid");
  if (!existsSync(pidFile)) return;
  const pid = Number((await fs.readFile(pidFile, "utf-8")).trim());
  try {
    process.kill(pid, 0);
  } catch (_e) {
    return; // stale pid file: the process is gone
  }
  fail(`${box} is being served (pid ${pid}); stop it first (\`pnpm perf:hub down\`, or wait for the dev router to idle it)`);
}

const healthSchema = z.object({ startup: z.array(z.object({ phase: z.string(), atMs: z.number() })) });

interface StartRun {
  listeningMs: number;
  phases: { phase: string; atMs: number }[];
  profile: string | undefined;
}

async function oneStart(box: string, profileDir: string | undefined): Promise<StartRun> {
  await assertBoxNotServed(box);
  const port = await freePort();
  const env = { ...perfHubEnv(), ...(profileDir === undefined ? {} : { NODE_OPTIONS: `--cpu-prof --cpu-prof-dir=${profileDir}` }) };
  const before = profileDir === undefined ? [] : await fs.readdir(profileDir);
  const t0 = performance.now();
  const child = spawn(bbxBin(), ["engine", "serve", box, "--slug", path.basename(box), "--port", String(port), "--host", "127.0.0.1"], { env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  while (!(await isListening(port))) {
    if (child.exitCode !== null) fail(`bbx serve exited early:\n${stderr}`);
    await new Promise((r) => setTimeout(r, 5));
  }
  const listeningMs = Math.round(performance.now() - t0);
  const res = await fetch(`http://127.0.0.1:${port}/healthz`, { headers: { authorization: `Bearer ${PERF_DIAG_KEY}` } });
  const { startup } = healthSchema.parse(await res.json());
  child.kill("SIGTERM");
  await exited;
  const after = profileDir === undefined ? [] : await fs.readdir(profileDir);
  const created = after.find((f) => !before.includes(f) && f.endsWith(".cpuprofile"));
  return { listeningMs, phases: startup, profile: created === undefined || profileDir === undefined ? undefined : path.join(profileDir, created) };
}

function phaseTable(runs: StartRun[]): string {
  const names = runs[0]?.phases.map((p) => p.phase) ?? [];
  const lines = [`  ${"phase (ms from process start)".padEnd(34)}${"median".padStart(8)}${"min".padStart(8)}${"max".padStart(8)}`];
  const row = (name: string, values: number[]): string => `  ${name.padEnd(34)}${String(median(values)).padStart(8)}${String(Math.min(...values)).padStart(8)}${String(Math.max(...values)).padStart(8)}`;
  for (const name of names) lines.push(row(name, runs.map((r) => r.phases.find((p) => p.phase === name)?.atMs ?? 0)));
  lines.push(row("spawn → listening (outside view)", runs.map((r) => r.listeningMs)));
  return lines.join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { box: { type: "string" }, runs: { type: "string", default: "5" }, "cpu-prof": { type: "boolean" } } });
  const box = values.box ?? (await ensurePerfBox(false)) ?? fail("no worktree test box clone to copy; pass --box <path>");
  const profileDir = values["cpu-prof"] === true ? path.join(perfResultsDir(), `serve-start-${Date.now()}`) : undefined;
  if (profileDir !== undefined) await fs.mkdir(profileDir, { recursive: true });
  const runs: StartRun[] = [];
  for (let i = 0; i < Number(values.runs); i++) runs.push(await oneStart(path.resolve(box), profileDir));
  console.log(`bbx engine serve ${box} (${runs.length} cold starts)\n${phaseTable(runs)}`);
  const lastProfile = runs.findLast((r) => r.profile !== undefined)?.profile;
  if (lastProfile === undefined) return;
  const bundle = path.join(PACKAGE_ROOT, "dist", "cli.mjs");
  const summary = await summarizeProfile(lastProfile, { [pathToFileURL(bundle).href]: `${bundle}.map` });
  console.log(`\nCPU self time of the last start (${summary.totalMs} ms sampled, ${lastProfile}):`);
  console.log(`  ${"self".padStart(10)}${"attributed".padStart(12)}  owner (attributed: node-internal and native time charged to its caller)`);
  for (const o of summary.attributed.slice(0, 30)) {
    const self = summary.byOwner.find((x) => x.owner === o.owner)?.ms ?? 0;
    console.log(`  ${String(self).padStart(10)}${String(o.ms).padStart(12)}  ${o.owner}`);
  }
  console.log("\nTop functions:");
  for (const f of summary.byFunction.slice(0, 20)) console.log(`  ${String(f.ms).padStart(7)} ms  ${f.name}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
