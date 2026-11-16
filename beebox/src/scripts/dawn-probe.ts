/**
 * Dawn probe: can Dawn (the `webgpu` package) open a GPU device here?
 *
 *   node dawn-probe.ts <dir>
 *
 * `webgpu` is resolved from <dir> as Node would from a file in it, so <dir>
 * may be the engine (`/opt/beebox/beebox`, with the hoisted workspace
 * `node_modules` above it), a packed install's `node_modules/beebox` (its
 * real path holds its dependencies), or any directory with a `webgpu` install.
 * Prints one line, `adapter: <description>, type: <cpu|gpu>`, and exits 0;
 * with no adapter or no device it prints the reason to stderr and exits 1.
 *
 * Plain TypeScript run by Node's type stripping, with no beebox imports, so
 * it runs on its own: `bbx-figure-gpu-install` runs it as a box user every
 * deploy, and it can be copied to a host before the engine has `webgpu`.
 */
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

class DawnProbeError extends Error {
  constructor(options: { detail: string }) {
    super(options.detail);
    this.name = "DawnProbeError";
  }
}

/** The part of WebGPU the probe uses; beebox's typecheck has no WebGPU types. */
interface ProbeAdapter {
  readonly info: { readonly description: string; readonly vendor: string; readonly architecture: string };
  requestDevice(): Promise<{ destroy(): void }>;
}
interface Dawn {
  create: (flags: string[]) => { requestAdapter(): Promise<ProbeAdapter | null> };
  globals: object;
}

function isDawn(mod: unknown): mod is Dawn {
  return typeof mod === "object" && mod !== null && typeof Reflect.get(mod, "create") === "function" && typeof Reflect.get(mod, "globals") === "object";
}

async function probe(dir: string): Promise<string> {
  const resolved = createRequire(path.join(realpathSync(dir), "dawn-probe.js")).resolve("webgpu");
  const mod: unknown = await import(pathToFileURL(resolved).href);
  if (!isDawn(mod)) throw new DawnProbeError({ detail: `${resolved} does not export create and globals` });
  Object.assign(globalThis, mod.globals);
  const gpu = mod.create([]);
  const adapter = await gpu.requestAdapter();
  if (adapter === null) {
    throw new DawnProbeError({ detail: "no GPU adapter: Dawn found none. On Linux, check that a Vulkan driver is installed (Mesa's mesa-vulkan-drivers) and that this user can load it" });
  }
  const device = await adapter.requestDevice();
  const { description, vendor, architecture } = adapter.info;
  const type = /llvmpipe|lavapipe|swiftshader|software/iu.test(`${description} ${architecture}`) ? "cpu" : "gpu";
  device.destroy();
  return `adapter: ${description === "" ? `${vendor} ${architecture}`.trim() : description}, type: ${type}`;
}

const dir = process.argv[2];
if (dir === undefined || process.argv.length !== 3) {
  process.stderr.write("usage: node dawn-probe.ts <dir from which webgpu resolves>\n");
  process.exit(64);
}
try {
  process.stdout.write(`${await probe(dir)}\n`);
  // Dawn's instance keeps the event loop alive; the answer is printed.
  process.exit(0);
} catch (error) {
  process.stderr.write(`dawn-probe: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
