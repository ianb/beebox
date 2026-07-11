/**
 * Engine + box-schema health checks — the "does this box's code surface
 * actually load" family, split from health.ts for its line budget.
 *
 * Exists because of a real incident (2026-07-04..10): every local box's
 * bootstrap engine symlink (`node_modules/callback-box` → an absolute
 * engine-checkout path, created by `scaffoldPackageRoot`) went dead when the
 * engine checkout was renamed, and box-local schemas silently stopped
 * loading — the only signal was a per-schema stderr warning. See
 * `issues/2026-07-10-boxes-dead-callback-box-symlinks.md` (monorepo root).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxShapeOrLegacyFallback } from "../../../lib/box-shape.js";
import { getInstalledEngineVersion } from "../../../core/engine-version.js";
import { loadBoxSchemas } from "../../../schemas/registry.js";
import { listSchemaLoadFailures } from "../../../schemas/schema-load-status.js";
import type { HealthCheck } from "./health.js";

const MAX_FAILURES_SHOWN = 3;

/**
 * `engine-link` (v2 boxes): the box's `node_modules/callback-box` must
 * resolve to a readable engine, and — for a box that isn't itself a worktree
 * clone — shouldn't point into a transient worktree checkout.
 * `box-schemas` (all boxes): every declared box-local schema file loaded.
 */
export async function engineHealthChecks(boxRoot: string): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];
  const shape = await getBoxShapeOrLegacyFallback(boxRoot);

  if (shape.shapeVersion >= 2) {
    const linkPath = path.join(shape.packageRoot, "node_modules", "callback-box");
    let target: string | null = null;
    try {
      target = await fs.readlink(linkPath);
    } catch (_e) {
      // Not a symlink: a real installed directory (fine) or missing
      // entirely (the version read below distinguishes).
    }
    const installed = await getInstalledEngineVersion(boxRoot);
    if (installed === null) {
      checks.push({
        name: "engine-link",
        ok: false,
        message:
          target !== null
            ? `node_modules/callback-box is a dead symlink (→ ${target}) — box-local schemas and templates will not load. Repoint it: ln -sfn <engine-checkout>/callback-box ${linkPath}`
            : `node_modules/callback-box is missing or unreadable at ${linkPath} — box-local schemas and templates will not load. Run pnpm install, or symlink an engine checkout there.`,
        severity: "error",
      });
    } else {
      // A box that is not itself a worktree clone must not pin a worktree
      // checkout — the link goes dead when that worktree is removed (how
      // test1 broke in the incident above).
      const worktreePinned =
        target !== null
        && target.includes(`${path.sep}callback-worktrees${path.sep}`)
        && !shape.packageRoot.includes(`${path.sep}box-worktrees${path.sep}`);
      checks.push({
        name: "engine-link",
        ok: !worktreePinned,
        message: worktreePinned
          ? `node_modules/callback-box points into a worktree (→ ${target}) — it will go dead when that worktree is removed. Repoint at the main checkout.`
          : `engine dependency resolves (callback-box ${installed})`,
        severity: "warning",
      });
    }
  }

  // Box-local schema load failures. Keep-last-good means a broken schema
  // file never blanks a working card type, which also makes the failure
  // invisible without this check. loadBoxSchemas populates the per-process
  // failure map, so load before reading — same as `cb status`.
  await loadBoxSchemas(boxRoot);
  const failures = listSchemaLoadFailures(boxRoot);
  const shown = failures.slice(0, MAX_FAILURES_SHOWN).map((f) => `${f.file}: ${f.message}`);
  const more = failures.length - shown.length;
  checks.push({
    name: "box-schemas",
    ok: failures.length === 0,
    message:
      failures.length === 0
        ? "box-local schemas load cleanly"
        : `${String(failures.length)} box-local schema file(s) failed to load — their card types are missing or stale: ${shown.join("; ")}${more > 0 ? ` (+${String(more)} more)` : ""}`,
    severity: "error",
  });

  return checks;
}
