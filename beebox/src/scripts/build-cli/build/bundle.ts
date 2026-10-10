// Bundles the CLI (src/cli/entry/run.ts) into a single dist/cli.mjs for fast
// cold starts — collapsing our ~hundreds of source modules into one file
// removes the per-module ESM loader-hook overhead that dominates tsx startup.
//
// node_modules are externalized (`packages: "external"`): native addons like
// better-sqlite3 can't be bundled, and loading deps from disk keeps their own
// __dirname / asset resolution intact.
//
// An external sourcemap (cli.mjs.map) gives real stack traces under
// `node --enable-source-maps` without slowing startup — node loads the map
// lazily, only when formatting an error.
//
// Every output is built into a temp dir and renamed into dist/ at the end, so
// a concurrent reader never sees a half-written file. That reader can be a
// `bbx` invocation (bin/bbx self-heals on staleness) or a test: the suite
// rebuilds the bundle mid-run (hub.e2e.doctest.md) while other tests exec the
// CLI, which loads dist/exports/* and dist/view-widgets/* at runtime. When
// only cli.mjs was renamed, `view test` under that overlap failed on a
// partly written export.
import { build } from "esbuild";
import { buildPublicationWorker } from "./pub-worker.mjs";
import { buildPluginBundles } from "./plugins.ts";
import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const root = join(import.meta.dirname, "..", "..", "..", "..");
const distDir = join(root, "dist");
const tmpDir = join(distDir, `.build-${process.pid}`);

const t = process.hrtime.bigint();
await build({
  entryPoints: [join(root, "src/cli/entry/run.ts")],
  // Every output is built under tmpDir with its dist/ path and basename, so the emitted
  // //# sourceMappingURL (relative, e.g. "cli.mjs.map") stays correct in dist/.
  outfile: join(tmpDir, "cli.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
  logLevel: "warning",
});

// Also build the public card-primitive layer (the `beebox/cards` export)
// to a single bundled dist/exports/cards.js. Box-local schema files import
// this specifier; it must be plain JS with no TS-source `.js` re-exports,
// because the CLI loads box schemas with Node's native type-stripping (under
// the dist/cli.mjs bundle) which does NOT remap `./schema.js` → `schema.ts`.
// Bundling collapses src/cards/{schema,frontmatter,lint-format,errors}.ts into
// one file, so there are no internal `.js` specifiers to resolve; zod/yaml stay
// external (resolved from node_modules at runtime). Outfile matches the tsc
// tree's emit path (dist/exports/cards.js), same pattern as schema/server below.
await build({
  entryPoints: [join(root, "src/exports/cards.ts")],
  outfile: join(tmpDir, "exports", "cards.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
  logLevel: "warning",
});

// Also build the public schema-deps layer (the `beebox/schema` export):
// z and yaml helpers re-exported so a box's only dependency is beebox.
// zod/yaml stay external (resolved from beebox's node_modules at runtime).
// Outfile matches the tsc tree's emit path (dist/exports/schema.js) so the
// export map target is valid after EITHER build — same pattern as cards above.
await build({
  entryPoints: [join(root, "src/exports/schema.ts")],
  outfile: join(tmpDir, "exports", "schema.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
  logLevel: "warning",
});

// Also build the public server layer (the `beebox/server` export): the
// programmatic createServer/startServer entry for the hub and embedders. The
// graph is large (whole webapp) but it's the same graph already inside
// dist/cli.mjs; bundling it separately keeps the export side-effect-free.
// Same tsc-tree path alignment as schema above.
await build({
  entryPoints: [join(root, "src/exports/server.ts")],
  outfile: join(tmpDir, "exports", "server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  jsx: "automatic",
  packages: "external",
  sourcemap: true,
  logLevel: "warning",
});

// Also build the public view-widgets layer (the `beebox/view-widgets`
// export) to dist/view-widgets/index.js. Box-authored views import this
// specifier for <CardLink>/<CardRef>/<Markdown>; `bbx view test` resolves it via the
// package `exports` map (the temp-dir node_modules/beebox symlink in
// src/cli/commands/view/command.ts), and wraps the rendered view in the bundle's
// NodeViewHostProvider. Only React (incl. its runtime entry points) stays
// external, so it shares the one instance react-dom/server uses — everything
// else this graph touches (tailwind-merge, clsx, the UI primitives it pulls
// in transitively via CardRef's <Badge>/<Text>) gets bundled in, because
// those aren't `beebox`'s own dependencies and a consuming box has no
// reason to have them installed (a released tarball proved this: `packages:
// "external"` here left `import "tailwind-merge"` unresolved for every
// external box — see the F1 release smoke test).
await build({
  entryPoints: [join(root, "src/frontend/src/exports/view-widgets.tsx")],
  outfile: join(tmpDir, "view-widgets", "index.js"),
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
  join(tmpDir, "view-widgets", "index.d.ts"),
);

// Every plugin's `beebox/plugins/<name>` and `beebox/plugins/<name>/view`
// export (dist/plugins/<name>/{index,view}.js); see plugins.ts.
await buildPluginBundles({ root, outDir: tmpDir });

// Package the exact module Worker uploaded by server-managed publications.
await buildPublicationWorker(join(tmpDir, "pub-worker.js"));

// Move every staged file into dist/, maps first, so a file never references a
// not-yet-present map. rename() is atomic within the same filesystem.
const staged = (await readdir(tmpDir, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => relative(tmpDir, join(entry.parentPath, entry.name)))
  .toSorted((a, b) => Number(b.endsWith(".map")) - Number(a.endsWith(".map")));
for (const relPath of staged) {
  await mkdir(dirname(join(distDir, relPath)), { recursive: true });
  await rename(join(tmpDir, relPath), join(distDir, relPath));
}
await rm(tmpDir, { recursive: true, force: true });

const ms = Number(process.hrtime.bigint() - t) / 1e6;
process.stderr.write(`built dist/cli.mjs in ${ms | 0}ms\n`);
