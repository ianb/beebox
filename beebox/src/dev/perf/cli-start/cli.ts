/**
 * `pnpm perf:cli-start` — time a short `bbx` verb from load to exit.
 *
 *   pnpm perf:cli-start                       # `bbx --version` in the worktree test1 clone, 7 runs
 *   pnpm perf:cli-start -- ls _config         # another verb (arguments after --)
 *   pnpm perf:cli-start --cpu-prof            # plus a CPU profile of the last run, summarized by source owner
 *
 * Box agents run `bbx` verbs many times per turn, and each run loads the whole
 * bundled CLI (`dist/cli.mjs`): every command module and the npm packages they
 * import at top level. `--version` does no work, so its time is the load
 * cost. The run uses the bundle the way `bin/bbx` does (compile cache, source
 * maps) but skips the wrapper's staleness check. See
 * `docs/development/performance.md`.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { PACKAGE_ROOT } from "../../../lib/package-root.js";
import { summarizeProfile } from "../serve-start/cpu-profile.js";
import { ensurePerfBox, perfResultsDir } from "../local-hub.js";
import { median } from "../report.js";

const bundle = path.join(PACKAGE_ROOT, "dist", "cli.mjs");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function runOnce({ box, verb, nodeFlags }: { box: string; verb: string[]; nodeFlags?: string[] }): number {
  const t0 = performance.now();
  const result = spawnSync(process.execPath, [...(nodeFlags ?? []), "--disable-warning=DEP0040", "--enable-source-maps", bundle, ...verb], {
    cwd: box,
    env: { ...process.env, NODE_COMPILE_CACHE: path.join(PACKAGE_ROOT, "dist", ".compile-cache") },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const ms = Math.round(performance.now() - t0);
  if (result.status !== 0) {
    fail(`bbx ${verb.join(" ")} exited ${result.status ?? result.signal}:\n${result.stderr.toString()}`);
  }
  return ms;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: { box: { type: "string" }, runs: { type: "string", default: "7" }, "cpu-prof": { type: "boolean" } },
    allowPositionals: true,
  });
  const verb = positionals.length > 0 ? positionals : ["--version"];
  const box = path.resolve(values.box ?? (await ensurePerfBox(false)) ?? fail("no worktree test box clone to copy; pass --box <path>"));
  runOnce({ box, verb }); // warm the compile cache and the OS file cache
  const times: number[] = [];
  for (let i = 0; i < Number(values.runs); i++) times.push(runOnce({ box, verb }));
  console.log(`bbx ${verb.join(" ")} in ${box} (${times.length} runs, load average ${os.loadavg()[0]?.toFixed(1)})`);
  console.log(`  median ${median(times)} ms, min ${Math.min(...times)}, max ${Math.max(...times)}`);
  if (values["cpu-prof"] !== true) return;

  const profileDir = path.join(perfResultsDir(), `cli-start-${Date.now()}`);
  await fs.mkdir(profileDir, { recursive: true });
  runOnce({ box, verb, nodeFlags: ["--cpu-prof", `--cpu-prof-dir=${profileDir}`] });
  const profile = (await fs.readdir(profileDir)).find((f) => f.endsWith(".cpuprofile"));
  if (profile === undefined) fail(`no CPU profile written to ${profileDir}`);
  const summary = await summarizeProfile(path.join(profileDir, profile), { [pathToFileURL(bundle).href]: `${bundle}.map` });
  console.log(`\nCPU time by owner (${summary.totalMs} ms sampled, ${path.join(profileDir, profile)}):`);
  console.log(`  ${"self".padStart(10)}${"attributed".padStart(12)}  owner (attributed: node-internal and native time charged to its caller)`);
  for (const o of summary.attributed.slice(0, 30)) {
    const self = summary.byOwner.find((x) => x.owner === o.owner)?.ms ?? 0;
    console.log(`  ${String(self).padStart(10)}${String(o.ms).padStart(12)}  ${o.owner}`);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
