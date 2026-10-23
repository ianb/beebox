/**
 * `pnpm perf:test-floor` — what one test process costs to start and exit,
 * layer by layer.
 *
 *   pnpm perf:test-floor                 # 7 runs of each layer
 *   pnpm perf:test-floor --file <path>   # also time one real test file with the same preloads
 *
 * Every test file is its own Node process, and each pays Node boot, the tsx
 * loader, and the `.taprc` preloads, which import tap (through
 * `@ianbicking/tap-check/tap`). Each row is a whole process, start to exit.
 * The layers are cumulative, so each row's increase over the one above is
 * that layer's cost; the last row adds a tap test body and tap's end-of-run
 * work. The node arguments come from `.taprc`, so the probe follows it.
 *
 * The tsx row also reports the size of tsx's shared transform cache. tsx
 * before 4.23.15 listed that whole directory at startup, about 470 ms per
 * process at 166,000 entries. See `docs/development/performance.md`.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { PACKAGE_ROOT } from "../../../lib/package-root.js";
import { median } from "../report.js";

const taprcSchema = z.object({ "node-arg": z.array(z.string()) });

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Wall time of one `node` run in ms; a failed run aborts the probe, since its time means nothing. */
function timeNode(args: string[]): number {
  const t0 = performance.now();
  const result = spawnSync(process.execPath, args, { cwd: PACKAGE_ROOT, stdio: ["ignore", "ignore", "pipe"] });
  const ms = performance.now() - t0;
  if (result.status !== 0) {
    fail(`node ${args.join(" ")} exited ${result.status ?? result.signal}:\n${result.stderr.toString()}`);
  }
  return Math.round(ms);
}

/** tsx's transform cache directory, as tsx computes it. */
function tsxCacheDir(): string {
  return path.join(os.tmpdir(), `tsx-${os.userInfo().uid}`);
}

async function countEntries(dir: string): Promise<number | undefined> {
  try {
    return (await fs.readdir(dir)).length;
  } catch (_e) {
    return undefined;
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { runs: { type: "string", default: "7" }, file: { type: "string" } } });
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1) fail(`--runs must be a positive integer, not ${values.runs}`);
  const taprc = taprcSchema.parse(parseYaml(await fs.readFile(path.join(PACKAGE_ROOT, ".taprc"), "utf-8")));
  const preloads = taprc["node-arg"];
  const tsxIndex = preloads.indexOf("--import=tsx");
  if (tsxIndex === -1) fail(".taprc node-arg no longer has --import=tsx; update this probe");

  // The probe files live under the package so that `tap` resolves from them.
  const probeDir = path.join(PACKAGE_ROOT, "dist", ".perf-test-floor");
  await fs.mkdir(probeDir, { recursive: true });
  const empty = path.join(probeDir, "empty.ts");
  const floor = path.join(probeDir, "floor.test.ts");
  await fs.writeFile(empty, "export {};\n");
  await fs.writeFile(floor, 'import { test } from "tap";\n\nvoid test("floor", async (t) => {\n  t.pass();\n});\n');

  const layers: { name: string; args: string[] }[] = [
    { name: "node", args: ["-e", "0"] },
    { name: "+ tsx (one .ts file)", args: [...preloads.slice(0, tsxIndex + 1), empty] },
    { name: "+ .taprc preloads", args: [...preloads, empty] },
    { name: "+ one-assertion tap test", args: [...preloads, floor] },
  ];
  if (values.file !== undefined) layers.push({ name: path.relative(PACKAGE_ROOT, path.resolve(values.file)), args: [...preloads, path.resolve(values.file)] });

  // One untimed pass warms tsx's cache for the probe files and the OS file cache.
  for (const layer of layers) timeNode(layer.args);
  const times: number[][] = layers.map(() => []);
  // Interleave the layers so a change in machine load hits all of them alike.
  for (let i = 0; i < runs; i++) for (const [j, layer] of layers.entries()) times[j]?.push(timeNode(layer.args));

  const entries = await countEntries(tsxCacheDir());
  console.log(`per-process test floor (${runs} runs each, load average ${os.loadavg()[0]?.toFixed(1)})`);
  console.log(`  ${"layer".padEnd(40)}${"median".padStart(8)}${"min".padStart(8)}${"max".padStart(8)}`);
  for (const [j, layer] of layers.entries()) {
    const ms = times[j] ?? [];
    console.log(`  ${layer.name.padEnd(40)}${String(median(ms)).padStart(8)}${String(Math.min(...ms)).padStart(8)}${String(Math.max(...ms)).padStart(8)}`);
  }
  console.log(`\ntsx cache: ${tsxCacheDir()} (${entries === undefined ? "absent" : `${entries} entries`})`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
