/**
 * Vite plugin: resolves the Node built-ins that libheif-js's Emscripten glue
 * `require`s (`fs`, `path`, `crypto`) to an empty module.
 *
 * The glue calls them only on its Node branch, which a browser worker never
 * takes (`lib/heif/decoder/worker.ts`). Without this, Vite substitutes its own
 * browser stub and prints a "has been externalized for browser compatibility"
 * warning for each one on every build. Scoped to importers inside libheif-js,
 * so any other browser import of a Node built-in still warns.
 */
import type { Plugin } from "vite";

const STUB_ID = "\0libheif-node-builtin-stub";
const STUBBED: ReadonlySet<string> = new Set(["fs", "path", "crypto"]);

export function libheifNodeBuiltinsStub(): Plugin {
  return {
    name: "bbx-libheif-node-builtins-stub",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer?.includes("/node_modules/libheif-js/") === true && STUBBED.has(source)) return STUB_ID;
      return null;
    },
    load(id) {
      return id === STUB_ID ? "export default {};" : null;
    },
  };
}
