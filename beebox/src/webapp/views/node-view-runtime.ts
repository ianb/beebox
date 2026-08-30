/**
 * Shared filesystem setup for running a node-target-compiled view module:
 * write the compiled output to a temp location with a `node_modules` such
 * that its bare `react`/`react/jsx-runtime`/`beebox/view-widgets`
 * imports resolve to a real, single-instance copy — dedup is by realpath, so
 * symlinking in the one host copy is what keeps hooks/dispatcher identity
 * intact instead of loading a second React.
 *
 * Two callers share this: `bbx view test` (renders in-process) and the view
 * compiler's metadata extractor (imports in a subprocess). Both just need a
 * file on disk they can `import()`; this module only does the filesystem
 * part.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import type { BoxShape } from "../../lib/box-shape.js";

/**
 * Where a node-target-compiled view resolves its `react`/`beebox`
 * imports from — the two genuinely distinct resolution modes:
 *
 * - `box-package` — a real box package carries its own `node_modules`
 *   (`node_modules/beebox` plus the `react` it imports directly);
 *   resolve straight through it.
 * - `engine-hosted` — there is no box package (the engine itself hosts the
 *   compile, e.g. a compiler caller that doesn't pass a box); resolve through
 *   the running beebox's own copies (`PACKAGE_ROOT`).
 *
 * This is an explicit choice, not a box shape: it names which of the two
 * filesystem dances `writeNodeViewModule` performs.
 */
export type ViewHostContext =
  | { kind: "box-package"; packageRoot: string }
  | { kind: "engine-hosted" };

/** Map a resolved box shape to its `box-package` view-host context. */
export function boxPackageHost(shape: BoxShape): ViewHostContext {
  return { kind: "box-package", packageRoot: shape.packageRoot };
}

export interface NodeViewModule {
  /** `file://` URL of the written compiled module — pass to `import()`. */
  moduleUrl: string;
  /** Directory containing the module — place sibling runner scripts here so
   * their own relative/bare imports resolve through the same node_modules. */
  dir: string;
  cleanup(): Promise<void>;
}

/**
 * Write a node-target-compiled view module (`output`, from
 * `compileView(path, { target: "node" })`) to a temp dir with `node_modules`
 * wired up for the given view-host context:
 *
 * - `engine-hosted` — no box package hosts the compile, so resolve through the
 *   running beebox's own copies (`PACKAGE_ROOT`), same as `bbx view test`
 *   has always done. Two levels are needed here because `PACKAGE_ROOT`'s own
 *   `node_modules` is itself a symlink into the shared workspace tree in dev, so
 *   `beebox` (self-reference, for `beebox/view-widgets`) can't live
 *   inside it — it gets its own inner `node_modules` instead.
 * - `box-package` — a real box package carries a `node_modules/beebox`
 *   (and, since box `src/` code imports React directly, a real
 *   `node_modules/react` beside it) — resolve straight through the box
 *   package's OWN `node_modules`, no synthetic per-package symlink needed.
 */
export async function writeNodeViewModule(output: string, host: ViewHostContext): Promise<NodeViewModule> {
  const tmpDir = path.join(os.tmpdir(), `bbx-view-${randomUUID()}`);
  const innerDir = path.join(tmpDir, "view");
  await fs.mkdir(path.join(innerDir, "node_modules"), { recursive: true });
  const tmpFile = path.join(innerDir, "view.mjs");
  try {
    if (host.kind === "engine-hosted") {
      const reactNodeModules = path.dirname(
        path.dirname(
          createRequire(path.join(PACKAGE_ROOT, "package.json")).resolve("react/package.json"),
        ),
      );
      await fs.symlink(reactNodeModules, path.join(tmpDir, "node_modules"), "dir");
      await fs.symlink(PACKAGE_ROOT, path.join(innerDir, "node_modules", "beebox"), "dir");
    } else {
      await fs.symlink(path.join(host.packageRoot, "node_modules"), path.join(tmpDir, "node_modules"), "dir");
    }
    await fs.writeFile(tmpFile, output, "utf-8");
    return {
      moduleUrl: pathToFileURL(tmpFile).href,
      dir: innerDir,
      cleanup: () => fs.rm(tmpDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    throw e;
  }
}
