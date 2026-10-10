/**
 * Plugin bundles (`docs/implemented-plans/plugins.md`, Track 1). Every
 * `src/plugins/<name>/plugin.ts` becomes `dist/plugins/<name>/plugin.js` (the
 * `beebox/plugins/<name>` export: Node, packages external, like `cards`; its
 * imports of `src/exports/{cards,schema}.ts` become the public `beebox/cards`
 * and `beebox/schema` specifiers, see `publicExportsExternal`) and
 * every `src/plugins/<name>/view.tsx` becomes `dist/plugins/<name>/view.js`
 * (the `beebox/plugins/<name>/view` export: browser, everything bundled
 * except React, `react-dom` and `beebox/view-widgets`, like the view-widgets
 * bundle). The host modules stay external through one shim module per
 * specifier (see `hostModuleShim`), so a CommonJS `require("react")` inside a
 * bundled dependency gets a real module object instead of esbuild's throwing
 * `__require`. A stylesheet a view imports is inlined as a `<style>` element
 * appended once at module load, so the box's view compiler needs no CSS path.
 *
 * Imported by `bundle.ts` (`build:cli`) and run on its own after `tsc` in
 * `pnpm build`, where the view modules are outside the tsc program. Runs
 * under plain `node`, so it imports nothing from the source tree.
 */
import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build, type Plugin } from "esbuild";

export interface PluginEntry {
  name: string;
  /** Absolute path of `plugin.ts`, or null when the directory has none. */
  index: string | null;
  /** Absolute path of `view.tsx`, or null when the plugin has no view. */
  view: string | null;
}

async function fileOrNull(path: string): Promise<string | null> {
  try {
    await access(path);
    return path;
  } catch (_e) {
    return null;
  }
}

/** Every directory under `<root>/src/plugins`, sorted by name, with the entry modules it holds. */
export async function listPluginEntries(root: string): Promise<PluginEntry[]> {
  const pluginsDir = join(root, "src", "plugins");
  let names: string[];
  try {
    names = (await readdir(pluginsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (_e) {
    return [];
  }
  const entries: PluginEntry[] = [];
  for (const name of names.toSorted()) {
    entries.push({
      name,
      index: await fileOrNull(join(pluginsDir, name, "plugin.ts")),
      view: await fileOrNull(join(pluginsDir, name, "view.tsx")),
    });
  }
  return entries;
}

/** The dist-relative files an entry builds: the targets of the `./plugins/<*>` and `./plugins/<*>/view` exports. */
export function pluginOutfiles(entry: PluginEntry): string[] {
  const out: string[] = [];
  if (entry.index !== null) out.push(`plugins/${entry.name}/plugin.js`);
  if (entry.view !== null) out.push(`plugins/${entry.name}/view.js`);
  return out;
}

export const PLUGIN_CSS_ATTRIBUTE = "data-bbx-plugin-css";

function styleInjectionModule(css: string): string {
  const hash = createHash("sha1").update(css).digest("hex");
  return [
    `var css = ${JSON.stringify(css)};`,
    `var hash = ${JSON.stringify(hash)};`,
    `if (typeof document !== "undefined" && document.head.querySelector('style[${PLUGIN_CSS_ATTRIBUTE}="' + hash + '"]') === null) {`,
    '  var style = document.createElement("style");',
    `  style.setAttribute(${JSON.stringify(PLUGIN_CSS_ATTRIBUTE)}, hash);`,
    "  style.textContent = css;",
    "  document.head.appendChild(style);",
    "}",
    "",
  ].join("\n");
}

/**
 * Turns `import "x.css"` into JavaScript that appends one
 * `<style data-bbx-plugin-css="<sha1 of the content>">` to `document.head`
 * at module load. The attribute is the guard: a second module (another
 * plugin view, or the same view compiled into two box views) carrying the
 * same stylesheet finds the element and appends nothing.
 */
export function cssInlinePlugin(): Plugin {
  return {
    name: "bbx-plugin-css-inline",
    setup(pluginBuild) {
      pluginBuild.onLoad({ filter: /\.css$/ }, async (args) => {
        const css = await readFile(args.path, "utf8");
        return { contents: styleInjectionModule(css), loader: "js" };
      });
    },
  };
}

/**
 * The modules a plugin view takes from its host rather than bundling. The box
 * view compiler resolves them: in the browser to the `window.__bbxReact` /
 * `window.__bbxReactDOM` shims, in Node (`bbx view test`) to the box's own
 * copies, so the view shares the host's React instance and dispatcher.
 */
export const VIEW_HOST_MODULES = ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client"];

class HostModuleNamespaceError extends Error {
  constructor(specifier: string) {
    super(`import(${JSON.stringify(specifier)}) did not produce a module namespace`);
    this.name = "HostModuleNamespaceError";
  }
}

/**
 * The names a host module's shim re-exports: every public export of the copy
 * installed here, read at build time. React 18 and 19 differ (`react-dom`
 * loses `render` and `createRoot`), so the list follows the installed version
 * instead of a hand-written one. Node reports a CommonJS module's exports as
 * the namespace keys plus `default`; `__SECRET_INTERNALS…` is not public.
 */
export async function hostModuleExportNames(specifier: string): Promise<string[]> {
  const namespace: unknown = await import(specifier);
  if (typeof namespace !== "object" || namespace === null) throw new HostModuleNamespaceError(specifier);
  return Object.keys(namespace)
    .filter((name) => name !== "default" && !name.startsWith("__") && /^[$A-Z_a-z][\w$]*$/.test(name))
    .toSorted();
}

const HOST_MODULE_FILTER = /^react(-dom)?(\/.*)?$/;

/**
 * Routes every import of a host module, ESM or CommonJS, to one shim module
 * per specifier that imports the real module as its default export (the
 * external import the box compiler later resolves) and re-exports each public
 * name. esbuild marks a plain external `require("react")` as unsupported
 * (`__require` throws at load); through the shim the require resolves to a
 * bundled ESM module, and esbuild's CommonJS interop hands the dependency an
 * object with the named exports it reads (`React.useSyncExternalStore`,
 * `createPortal`). Only the shim's own import of the specifier is left
 * external. A `react*` subpath outside `exportNames` is not a host module and
 * resolves normally.
 */
export function hostModuleShim(exportNames: Map<string, string[]>): Plugin {
  const namespace = "bbx-host-module";
  return {
    name: namespace,
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: HOST_MODULE_FILTER }, (args) => {
        if (!exportNames.has(args.path)) return null;
        return args.namespace === namespace ? { path: args.path, external: true } : { path: args.path, namespace };
      });
      pluginBuild.onLoad({ filter: /.*/, namespace }, (args) => ({
        contents: [
          `import Host from ${JSON.stringify(args.path)};`,
          "export default Host;",
          ...(exportNames.get(args.path) ?? []).map((name) => `export const ${name} = Host.${name};`),
          "",
        ].join("\n"),
        loader: "js",
      }));
    },
  };
}

/**
 * A plugin's `plugin.ts` imports `src/exports/cards.ts` and `schema.ts` by
 * relative path (the import boundary allows only those engine files). Bundling
 * them in would give `plugin.js` a private copy of `cardSchema` and its
 * `body()` marker, whose `Symbol("beebox.bodyField")` the box's own
 * `beebox/cards` copy does not recognize: a schema stub built on the plugin's
 * base then failed with `expected a Zod schema` at `body`. The two files are
 * the `beebox/cards` and `beebox/schema` exports, so the bundle imports those
 * specifiers (Node resolves them through the package's own `exports` map) and
 * shares the one copy the box loads.
 */
export function publicExportsExternal(root: string): Plugin {
  const specifiers = new Map<string, string>([
    [join(root, "src", "exports", "cards.ts"), "beebox/cards"],
    [join(root, "src", "exports", "schema.ts"), "beebox/schema"],
  ]);
  return {
    name: "bbx-public-exports-external",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /\/exports\/(cards|schema)\.js$/ }, (args) => {
        const resolved = resolve(args.resolveDir, args.path).replace(/\.js$/, ".ts");
        const specifier = specifiers.get(resolved);
        return specifier === undefined ? null : { path: specifier, external: true };
      });
    },
  };
}

/** The host-module shim for every member of `VIEW_HOST_MODULES`, with the export names of the copies installed here. */
export async function hostModuleShims(): Promise<Plugin> {
  const exportNames = new Map<string, string[]>();
  for (const specifier of VIEW_HOST_MODULES) {
    exportNames.set(specifier, await hostModuleExportNames(specifier));
  }
  return hostModuleShim(exportNames);
}

/** Bundle every plugin's entry modules under `outDir` (a `dist/` or a staging copy of it). */
export async function buildPluginBundles(params: { root: string; outDir: string }): Promise<void> {
  const entries = await listPluginEntries(params.root);
  const viewPlugins = entries.some((e) => e.view !== null) ? [await hostModuleShims(), cssInlinePlugin()] : [];
  for (const entry of entries) {
    if (entry.index !== null) {
      await build({
        entryPoints: [entry.index],
        outfile: join(params.outDir, "plugins", entry.name, "plugin.js"),
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node22",
        packages: "external",
        plugins: [publicExportsExternal(params.root)],
        sourcemap: true,
        logLevel: "warning",
      });
    }
    if (entry.view !== null) {
      await build({
        entryPoints: [entry.view],
        outfile: join(params.outDir, "plugins", entry.name, "view.js"),
        bundle: true,
        platform: "browser",
        format: "esm",
        target: "es2022",
        jsx: "automatic",
        external: ["beebox/view-widgets"],
        plugins: viewPlugins,
        sourcemap: true,
        logLevel: "warning",
      });
    }
  }
}

// CLI: `node plugins.ts [outDir]`. `pnpm build` runs it without an argument
// (bundles land in dist/); the test helper passes a staging directory.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const root = join(import.meta.dirname, "..", "..", "..", "..");
  const outDir = process.argv[2] === undefined ? join(root, "dist") : resolve(process.argv[2]);
  await buildPluginBundles({ root, outDir });
}
