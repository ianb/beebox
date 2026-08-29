/**
 * Static type-check of box views against the real ViewProps.
 *
 * Catches removed/renamed field use that COMPILES (esbuild strips types) and
 * RENDERS without throwing but is silently wrong — e.g. `c.tagName` after the
 * card-shape cleanup. Split from view.ts to keep that file under the line cap.
 */

import * as path from "node:path";
import * as os from "node:os";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type * as ts from "typescript";
import { listViews, resolveViewsDir } from "../../webapp/views/compiler.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";

/** Per-view outcome from `cb view typecheck`. */
export interface ViewTypecheckResult {
  slug: string;
  ok: boolean;
  /** Type errors (formatted `loc: message`); absent when `ok`. */
  errors?: string[];
}

/**
 * Type-check one view against the real `ViewProps`. Box views resolve nothing
 * from the box dir, so we check in a tmp dir: a node_modules symlink (react +
 * @types/react), a copy of the view, and a harness asserting the default export
 * is `ComponentType<ViewProps>`.
 *
 * Teeth depend on annotation: it catches views typed against the real types
 * (then `c.tagName` errors) and views whose stale LOCAL type declares a removed
 * field as required (the assertion fails). It can NOT see through `as any` or
 * fully-unannotated props — those pass, and the render/textual gates backstop.
 */
async function typecheckOneView(args: { viewPath: string; slug: string }): Promise<ViewTypecheckResult> {
  const { viewPath, slug } = args;
  // Loaded here, not at module scope: the whole TypeScript compiler is ~8 MB of
  // JS, and `cli/index.ts` imports every command module eagerly — so a static
  // import made EVERY `cb` invocation, `--version` included, pay for it. Only
  // this command needs it. (docs/plans/commit-performance.md, phase 1b.)
  const ts = await import("typescript");
  const reactNodeModules = path.dirname(
    path.dirname(
      createRequire(path.join(PACKAGE_ROOT, "package.json")).resolve("react/package.json"),
    ),
  );
  const tmpDir = path.join(os.tmpdir(), `cb-viewtc-${randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  try {
    await fs.symlink(reactNodeModules, path.join(tmpDir, "node_modules"), "dir");
    await fs.copyFile(viewPath, path.join(tmpDir, "view.tsx"));

    // Relative import to the real ViewProps source, so the assertion is against
    // the actual interface, not a copy that could drift. The release tarball
    // ships this file and its type closure (package.json `files`) for the
    // same reason; `pnpm smoke` fails at `cb view typecheck` if that drifts.
    let viewProps = path
      .relative(tmpDir, path.join(PACKAGE_ROOT, "src", "core", "views", "types"))
      .replaceAll(path.sep, "/");
    if (!viewProps.startsWith(".")) viewProps = `./${viewProps}`;
    const harnessPath = path.join(tmpDir, "harness.ts");
    await fs.writeFile(
      harnessPath,
      "import View from \"./view\";\n" +
        `import type { ViewProps } from "${viewProps}";\n` +
        "import type { ComponentType } from \"react\";\n" +
        "const _assert: ComponentType<ViewProps> = View;\n",
      "utf-8",
    );

    const options: ts.CompilerOptions = {
      noEmit: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2020,
      lib: ["lib.es2020.d.ts", "lib.dom.d.ts"],
      skipLibCheck: true,
      // Lenient — we want field/assignability errors (which fire regardless),
      // not implicit-any noise from loosely-typed view code.
      strict: false,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      types: [],
    };
    const program = ts.createProgram([harnessPath], options);
    const errors: string[] = [];
    for (const d of ts.getPreEmitDiagnostics(program)) {
      // Report ONLY the boundary-assertion errors (in harness.ts), not the
      // view body. Box views can't import the real ViewCard (it's not a public
      // export), so a card-shape problem always surfaces at the boundary (the
      // view's local card type vs ViewProps). Checking the whole view body
      // instead would flag unrelated internal type noise — e.g. Float32Array
      // lib-variance — that has nothing to do with the migration.
      if (path.basename(d.file?.fileName ?? "") !== "harness.ts") continue;
      errors.push(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    }
    return errors.length === 0 ? { slug, ok: true } : { slug, ok: false, errors };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Type-check every view in the box against the real ViewProps. A static gate
 * that catches silent field breakage the render gate (`cb view check`) misses.
 */
export async function typecheckViews(boxRoot: string): Promise<{ ok: boolean; views: ViewTypecheckResult[] }> {
  const metas = await listViews(boxRoot);
  const { viewsDir } = await resolveViewsDir(boxRoot);
  const views: ViewTypecheckResult[] = [];
  for (const meta of metas) {
    const viewPath = path.join(viewsDir, `${meta.slug}.tsx`);
    views.push(await typecheckOneView({ viewPath, slug: meta.slug }));
  }
  return { ok: views.every((v) => v.ok), views };
}
