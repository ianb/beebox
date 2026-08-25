// Bundles the CLI (src/cli/index.ts) into a single dist/cli.mjs for fast
// cold starts — collapsing our ~hundreds of source modules into one file
// removes the per-module ESM loader-hook overhead that dominates tsx startup.
//
// node_modules are externalized (`packages: "external"`): native addons like
// better-sqlite3 can't be bundled, and loading deps from disk keeps their own
// __dirname / asset resolution intact.
//
// An external sourcemap (cli.mjs.map) gives real stack traces under
// `node --enable-source-maps` without slowing startup — node loads the map
// lazily, only when formatting an error. We build into a temp dir and rename
// both files in, so a concurrent `cb` invocation (bin/cb self-heals on
// staleness) never sees a half-written bundle.
import { build } from "esbuild";
import { copyFile, rename, rm } from "node:fs/promises";
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

// Also build the public card-primitive layer (the `callback-box/cards` export)
// to a single bundled dist/cards/index.js. Box-local schema files import this
// specifier; it must be plain JS with no TS-source `.js` re-exports, because
// the CLI loads box schemas with Node's native type-stripping (under the
// dist/cli.mjs bundle) which does NOT remap `./schema.js` → `schema.ts`.
// Bundling collapses src/cards/{schema,frontmatter,lint-format,errors}.ts into
// one file, so there are no internal `.js` specifiers to resolve; zod/yaml stay
// external (resolved from node_modules at runtime).
await build({
  entryPoints: [join(root, "src/cards/index.ts")],
  outfile: join(distDir, "cards", "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
  logLevel: "warning",
});

// Also build the public schema-deps layer (the `callback-box/schema` export):
// z and yaml helpers re-exported so a box's only dependency is callback-box.
// zod/yaml stay external (resolved from callback-box's node_modules at runtime).
// Outfile matches the tsc tree's emit path (dist/exports/schema.js) so the
// export map target is valid after EITHER build — same pattern as cards/.
await build({
  entryPoints: [join(root, "src/exports/schema.ts")],
  outfile: join(distDir, "exports", "schema.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
  logLevel: "warning",
});

// Also build the public server layer (the `callback-box/server` export): the
// programmatic createServer/startServer entry for the hub and embedders. The
// graph is large (whole webapp) but it's the same graph already inside
// dist/cli.mjs; bundling it separately keeps the export side-effect-free.
// Same tsc-tree path alignment as schema above.
await build({
  entryPoints: [join(root, "src/exports/server.ts")],
  outfile: join(distDir, "exports", "server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  jsx: "automatic",
  packages: "external",
  sourcemap: true,
  logLevel: "warning",
});

// Also build the public view-widgets layer (the `callback-box/view-widgets`
// export) to dist/view-widgets/index.js. Box-authored views import this
// specifier for <CardLink>/<CardRef>; `cb view test` resolves it via the
// package `exports` map (the temp-dir node_modules/callback-box symlink in
// src/cli/commands/view.ts), and wraps the rendered view in the bundle's
// NodeViewHostProvider. Only React (incl. its runtime entry points) stays
// external, so it shares the one instance react-dom/server uses — everything
// else this graph touches (tailwind-merge, clsx, the UI primitives it pulls
// in transitively via CardRef's <Badge>/<Text>) gets bundled in, because
// those aren't `callback-box`'s own dependencies and a consuming box has no
// reason to have them installed (a released tarball proved this: `packages:
// "external"` here left `import "tailwind-merge"` unresolved for every
// external box — see the F1 release smoke test).
await build({
  entryPoints: [join(root, "src/frontend/src/components/view-widgets/node-entry.tsx")],
  outfile: join(distDir, "view-widgets", "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  sourcemap: true,
  logLevel: "warning",
});

// Ship the checked-in view-widgets type surface as the bundle's sibling
// index.d.ts (plus the exports-map `types` condition) so external boxes can
// typecheck their imports — the esbuild bundle itself emits no declarations.
await copyFile(
  join(root, "src/exports/view-widgets.d.ts"),
  join(distDir, "view-widgets", "index.d.ts"),
);

const ms = Number(process.hrtime.bigint() - t) / 1e6;
process.stderr.write(`built dist/cli.mjs in ${ms | 0}ms\n`);
