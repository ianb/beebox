// Bundles the CLI (src/cli/index.ts) into a single dist/cli.mjs for fast
// cold starts — collapsing our ~hundreds of source modules into one file
// removes the per-module ESM loader-hook overhead that dominates tsx startup.
//
// node_modules are externalized (`packages: "external"`): native addons like
// better-sqlite3 can't be bundled, and loading deps from disk keeps their own
// __dirname / asset resolution intact. cardworks resolves to its built dist.
//
// An external sourcemap (cli.mjs.map) gives real stack traces under
// `node --enable-source-maps` without slowing startup — node loads the map
// lazily, only when formatting an error. We build into a temp dir and rename
// both files in, so a concurrent `cb` invocation (bin/cb self-heals on
// staleness) never sees a half-written bundle.
import { build } from "esbuild";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const distDir = join(root, "dist");
const tmpDir = join(distDir, `.build-${process.pid}`);

const t = process.hrtime.bigint();
await build({
  entryPoints: [join(root, "src/cli/index.ts")],
  // Build "cli.mjs" inside a temp dir so the emitted //# sourceMappingURL is
  // the relative "cli.mjs.map", which stays correct after we move both into dist/.
  outfile: join(tmpDir, "cli.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
  logLevel: "warning",
});

// Move the map first, then the .mjs, so the bundle never references a
// not-yet-present map. rename() is atomic within the same filesystem.
await rename(join(tmpDir, "cli.mjs.map"), join(distDir, "cli.mjs.map"));
await rename(join(tmpDir, "cli.mjs"), join(distDir, "cli.mjs"));
await rm(tmpDir, { recursive: true, force: true });

const ms = Number(process.hrtime.bigint() - t) / 1e6;
process.stderr.write(`built dist/cli.mjs in ${ms | 0}ms\n`);
