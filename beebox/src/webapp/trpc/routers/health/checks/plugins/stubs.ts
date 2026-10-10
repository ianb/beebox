/**
 * Health checks for the box's **plugin stubs**: box files under `src/schemas/`,
 * `src/views/`, and `src/tricks/scripts/<trick>/index.ts` that import `beebox/plugins/<name>`
 * (`docs/plugins.md`, "Health").
 *
 * - `plugin-stub-inactive` (warning): the stub's plugin is installed but not
 *   in the box's `plugins` list. The cards validate (the stub defines the
 *   type) but the plugin's skill and lint hooks are off.
 * - `plugin-stub-missing` (error): the stub names a plugin this engine does
 *   not have, or the schema loader reported that the stub failed to load
 *   (`schema-load-status.ts`); keep-last-good hides that at the console.
 *
 * Detection is a regex over static import specifiers, read without executing
 * the file, the same approach as `readDescription` in `cli/commands/trick.ts`.
 * The courseware README says stubs use static imports; a dynamic import is
 * not seen (accepted, `docs/plans/plugins.md` failure modes).
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { boxCodePaths, getBoxShape } from "../../../../../../lib/box-shape.js";
import type { SchemaLoadFailure } from "../../../../../../schema-load-status.js";
import type { HealthCheck } from "../../router.js";

export interface StubImport {
  /** Box-relative POSIX path of the stub file. */
  readonly file: string;
  /** The `<name>` in `beebox/plugins/<name>`. */
  readonly plugin: string;
}

/** One static `import`/`export ... from` statement whose specifier starts with `beebox/plugins/`. */
const PLUGIN_IMPORT = /^\s*(?:import|export)\s[^;]*?["']beebox\/plugins\/([^"'/]+)[^"']*["']/gm;

/** Every plugin import in the box's stub files, in file order. */
export async function scanStubImports(boxRoot: string): Promise<StubImport[]> {
  const shape = await getBoxShape(boxRoot);
  const { schemasDir, viewsDir, tricksDir } = boxCodePaths(shape);
  const files = [
    ...(await glob("*.ts", { cwd: schemasDir, nodir: true, absolute: true })),
    ...(await glob("*.tsx", { cwd: viewsDir, nodir: true, absolute: true })),
    ...(await glob("scripts/*/index.ts", { cwd: tricksDir, nodir: true, absolute: true })),
  ].toSorted();
  const imports: StubImport[] = [];
  for (const abs of files) {
    const file = path.relative(shape.boxRoot, abs).split(path.sep).join("/");
    const content = await readFile(abs, "utf8");
    for (const match of content.matchAll(PLUGIN_IMPORT)) {
      const plugin = match[1];
      if (plugin !== undefined) imports.push({ file, plugin });
    }
  }
  return imports;
}

export interface StubImportCheckInput {
  readonly imports: ReadonlyArray<StubImport>;
  /** Registry keys. */
  readonly installed: ReadonlySet<string>;
  readonly active: ReadonlySet<string>;
  /** The schema loader's current failures for this box; `file` is the name within `src/schemas/`. */
  readonly failures: ReadonlyArray<SchemaLoadFailure>;
}

/** `plugin-stub-inactive` and `plugin-stub-missing` over scanned imports; one ok row per check when quiet. */
export function stubImportChecks(input: StubImportCheckInput): HealthCheck[] {
  const { imports, installed, active, failures } = input;
  const checks: HealthCheck[] = [];
  const failureByFile = new Map(failures.map((f) => [`src/schemas/${f.file}`, f.message]));
  const inactive = imports.filter((i) => installed.has(i.plugin) && !active.has(i.plugin));
  const unknown = imports.filter((i) => !installed.has(i.plugin));
  const failedStubs = [...new Set(imports.map((i) => i.file))].filter((file) => failureByFile.has(file));

  for (const { file, plugin } of inactive) {
    checks.push({
      name: "plugin-stub-inactive",
      ok: false,
      message: `${file} imports beebox/plugins/${plugin}, which is installed but not active: its skill and lint are off. Add "${plugin}" to plugins in _config/box.json, or remove the stub.`,
      severity: "warning",
    });
  }
  if (inactive.length === 0) {
    checks.push({ name: "plugin-stub-inactive", ok: true, message: "Every plugin a stub imports is active", severity: "warning" });
  }

  for (const { file, plugin } of unknown) {
    checks.push({
      name: "plugin-stub-missing",
      ok: false,
      message: `${file} imports beebox/plugins/${plugin}, which this engine does not provide: \`bbx plugins list\` names the installed plugins. Its cards have no schema until the stub is fixed or removed.`,
      severity: "error",
    });
  }
  for (const file of failedStubs) {
    checks.push({
      name: "plugin-stub-missing",
      ok: false,
      message: `${file} failed to load, so its card type is missing or stale: ${failureByFile.get(file) ?? ""}`,
      severity: "error",
    });
  }
  if (unknown.length === 0 && failedStubs.length === 0) {
    checks.push({ name: "plugin-stub-missing", ok: true, message: "Every plugin stub names an installed plugin and loads", severity: "error" });
  }
  return checks;
}
