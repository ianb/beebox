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
import * as ts from "typescript";
import { listViews } from "../../webapp/views/compiler.js";
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
    // the actual interface, not a copy that could drift.
    let viewProps = path
      .relative(tmpDir, path.join(PACKAGE_ROOT, "src", "types", "views"))
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
      const fileName = d.file?.fileName ?? "";
      // Only our harness + view copy; ignore lib/react/ViewProps-source diagnostics.
      if (!fileName.startsWith(tmpDir)) continue;
      const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      let loc = "";
      if (d.file && d.start !== undefined) {
        const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
        const where = fileName.endsWith("view.tsx") ? `${slug}.tsx` : "export";
        loc = `${where}:${String(line + 1)}:${String(character + 1)}: `;
      }
      errors.push(`${loc}${message}`);
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
  const views: ViewTypecheckResult[] = [];
  for (const meta of metas) {
    const viewPath = path.join(boxRoot, "views", `${meta.slug}.tsx`);
    views.push(await typecheckOneView({ viewPath, slug: meta.slug }));
  }
  return { ok: views.every((v) => v.ok), views };
}
