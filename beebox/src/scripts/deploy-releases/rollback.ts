// Rolling back to the previous release; see cli.ts.
import * as fs from "node:fs";
import * as path from "node:path";
import { FAILED_MARK, ReleaseRefusedError, isComplete, liveRelease, previousRelease, realOrNull, switchRelease, type Layout } from "./layout.ts";
import { isPlainObject } from "./prepare.ts";

/** Migration names a release's engine knows, or null when it cannot be read. */
export function migrationNames(release: string): string[] | null {
  const file = path.join(release, "beebox", "src", "core", "migrations.ts");
  if (!fs.existsSync(file)) return null;
  return [...fs.readFileSync(file, "utf8").matchAll(/\bname: "([^"]+)"/g)].map((m) => m[1] ?? "");
}

/**
 * Migration names any box under `boxesRoot` recorded as applied
 * (`<root>/<slug>/box/_config/migrations.jsonl`), or null when a manifest
 * cannot be read. A box with no manifest has applied nothing.
 */
export function appliedMigrations(boxesRoot: string): Set<string> | null {
  const applied = new Set<string>();
  if (!fs.existsSync(boxesRoot)) return applied;
  for (const slug of fs.readdirSync(boxesRoot).toSorted()) {
    const manifest = path.join(boxesRoot, slug, "box", "_config", "migrations.jsonl");
    if (!fs.existsSync(manifest)) continue;
    try {
      for (const line of fs.readFileSync(manifest, "utf8").split("\n")) {
        if (line.trim() === "") continue;
        const entry: unknown = JSON.parse(line);
        if (!isPlainObject(entry) || typeof entry.name !== "string") return null;
        applied.add(entry.name);
      }
    } catch (e) {
      console.error(`  cannot read ${manifest}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }
  return applied;
}

export type RollbackDecision = { ok: true; from: string; to: string } | { ok: false; reason: string };

export interface RollbackOptions {
  /** The release the caller believes is live; refuse when it is not. */
  expectedFrom: string | null;
  /** The directory holding `<slug>/box` for every box on the host. */
  boxesRoot: string;
}

export function decideRollback(layout: Layout, options: RollbackOptions): RollbackDecision {
  const { expectedFrom, boxesRoot } = options;
  const from = liveRelease(layout);
  if (from === null) return { ok: false, reason: `${layout.installDir} is not a release link` };
  if (expectedFrom !== null && realOrNull(expectedFrom) !== from) {
    return { ok: false, reason: `the live release is ${from}, not ${expectedFrom}` };
  }
  const to = previousRelease(layout);
  if (to === null) return { ok: false, reason: "there is no previous release" };
  if (to === from) return { ok: false, reason: "the previous release is the live one" };
  if (fs.existsSync(path.join(to, FAILED_MARK))) return { ok: false, reason: `the previous release ${to} already failed and was rolled back` };
  if (!isComplete(to)) return { ok: false, reason: `the previous release ${to} is incomplete` };
  const toNames = migrationNames(to);
  if (toNames === null) return { ok: false, reason: `the previous release ${to} has no readable migration list` };
  const applied = appliedMigrations(boxesRoot);
  if (applied === null) return { ok: false, reason: "a box's migration manifest could not be read" };
  const known = new Set(toNames);
  const unknown = [...applied].filter((name) => !known.has(name)).toSorted();
  if (unknown.length > 0) {
    // An older engine ignores migrations it does not know and would run
    // against data already migrated forward (the Ghost lesson, upgrade.ts).
    return { ok: false, reason: `boxes applied migrations the previous release does not know (${unknown.join(", ")}); fix forward or deploy a chosen commit with deploy.sh --ref` };
  }
  return { ok: true, from, to };
}

/** Switch back to the previous release and mark the one it leaves as failed. */
export function rollbackRelease(layout: Layout, options: RollbackOptions): { from: string; to: string } {
  const decision = decideRollback(layout, options);
  if (!decision.ok) throw new ReleaseRefusedError({ kind: "rollback", reason: decision.reason });
  fs.writeFileSync(path.join(decision.from, FAILED_MARK), `${new Date().toISOString()}\n`);
  switchRelease(layout, decision.to);
  return { from: decision.from, to: decision.to };
}
