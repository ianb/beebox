/**
 * Node.js loader hooks for .doctest.md files.
 *
 * Transforms markdown files with code examples into tap test modules.
 * Registered via doctest-loader.ts using node:module register().
 *
 * Format:
 *   - ```ts setup blocks are inserted at module scope (imports, helpers)
 *   - ``` blocks contain examples: expression => expected (multiple per block OK)
 *   - check() is always available (via tap-check.ts --import)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
// This file is Node's actual module-customization hook: `register()` in
// doctest-loader.ts loads it directly via Node's native ESM loader thread,
// which does NOT go through tsx's `.js`→`.ts` extension-probing (unlike the
// main thread, which runs under `--import=tsx`). Its own relative imports
// must therefore name the real `.ts` extension so Node's native loader can
// find them — which is why this package's tsconfig sets
// `allowImportingTsExtensions`.
import { tsxOnlyFallback } from "./resolve-rules.ts";
import { generateTestSource } from "./doctest-generate.ts";

export {
  type CodeBlock,
  parseCodeBlocks,
  type Example,
  type ThrowsExample,
  parseExamples,
  parseExample,
  generateTestSource,
} from "./doctest-generate.ts";

// ── Loader hooks ────────────────────────────────────────────────────────────
//
// These interfaces are deliberately narrower than Node's actual resolve/load
// hook contracts (`node:module`'s `ResolveHookContext`/`LoadHookContext` carry
// more fields, e.g. `conditions`, `importAttributes`) — they cover only what
// this loader reads or produces. Node's real caller supplies a superset at
// runtime, which is structurally compatible; declaring the full contract here
// would gain nothing and would force every direct-call test fixture to
// fabricate fields it never uses.

/** The subset of Node's ESM resolve-hook context this loader reads. */
interface ResolveContext {
  parentURL?: string;
}

/** The subset of Node's ESM resolve-hook result shape this loader produces. */
interface ResolveResult {
  url: string;
  shortCircuit?: boolean;
}

type NextResolve = (
  specifier: string,
  context: ResolveContext,
) => ResolveResult | Promise<ResolveResult>;

// eslint-disable-next-line max-params -- Node's module-customization hook API calls resolve() positionally with exactly these three arguments (specifier, context, nextResolve); the arity is dictated by node:module, not by this code.
export async function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve,
): Promise<ResolveResult> {
  if (specifier.endsWith(".doctest.md")) {
    const url = new URL(specifier, context.parentURL || "file:///").href;
    return { url, shortCircuit: true };
  }

  // The unambiguous TSX-only case, resolved here rather than depending on
  // tsx's downstream extension-probe sequence (which has intermittently
  // stopped at the missing .ts candidate under heavy parallel startup).
  // The rule itself lives in resolve-rules.ts so that a static consumer of
  // the same import graph cannot disagree with the runner about it.
  const tsxUrl = tsxOnlyFallback(specifier, context.parentURL);
  if (tsxUrl !== null) return { url: tsxUrl, shortCircuit: true };

  return nextResolve(specifier, context);
}

/** The subset of Node's ESM load-hook context this loader reads. */
interface LoadContext {
  format?: string | null;
}

/** The subset of Node's ESM load-hook result shape this loader produces. */
interface LoadResult {
  format: string | null;
  source?: string | ArrayBuffer | NodeJS.TypedArray;
  shortCircuit?: boolean;
}

type NextLoad = (url: string, context: LoadContext) => LoadResult | Promise<LoadResult>;

// eslint-disable-next-line max-params -- Node's module-customization hook API calls load() positionally with exactly these three arguments (url, context, nextLoad); the arity is dictated by node:module, not by this code.
export async function load(
  url: string,
  context: LoadContext,
  nextLoad: NextLoad,
): Promise<LoadResult> {
  if (url.endsWith(".doctest.md")) {
    const filePath = fileURLToPath(url);
    const markdown = readFileSync(filePath, "utf-8");
    const tsSource = generateTestSource(markdown, filePath);
    const { code } = transformSync(tsSource, {
      loader: "ts",
      format: "esm",
      sourcefile: filePath,
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
