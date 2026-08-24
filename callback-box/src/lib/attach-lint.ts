/**
 * Lint rules for the `.attach/` layout.
 *
 * Two box-wide rules:
 *
 * 1. **No basename collisions.** Two cards in the same directory may not share
 *    a basename (the part before `.<type>.card`). The shared basename would
 *    make `<basename>.attach/` ambiguous — which card owns it?
 *
 * 2. **No literal `attach` name outside an attach scope.** Anywhere in the box
 *    (other than inside an existing `<basename>.attach/` scope) a directory or
 *    file named exactly `attach` is forbidden — the name conflicts with the
 *    `attach/` virtual prefix used in refs. Names like `attachments/`,
 *    `attach-things/`, or `.attach` are fine; only the bare `attach` is
 *    reserved.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "./error-guards.js";
import {
  ATTACH_SUFFIX,
  cardBasename,
  isInsideAttachScope,
  isLiteralAttachName,
} from "../shared/attach-path.js";

export interface AttachLintError {
  /** Box-root-relative path the error applies to. */
  path: string;
  /** Short rule id, useful for filtering / suppressing. */
  rule: "basename-collision" | "literal-attach-name";
  /** Human-readable message. */
  message: string;
}

const SKIP_DIRS = new Set([
  ".git",
  ".callback-box",
  "node_modules",
  ".tap",
  "tmp",
]);

interface ScanContext {
  boxRoot: string;
  errors: AttachLintError[];
}

/**
 * Scan a box for attach-layout violations. Returns the list of errors;
 * empty array means a clean tree.
 */
export async function lintAttachLayout(boxRoot: string): Promise<AttachLintError[]> {
  const ctx: ScanContext = { boxRoot, errors: [] };
  await scanDir(ctx, boxRoot);
  ctx.errors.sort((a, b) => a.path.localeCompare(b.path));
  return ctx.errors;
}

async function scanDir(ctx: ScanContext, absDir: string): Promise<void> {
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Could not read directory during attach-layout scan, skipping ${absDir}:`, e);
    }
    return;
  }

  const relDir = path.relative(ctx.boxRoot, absDir);
  const insideScope = relDir.length > 0 && isInsideAttachScope(relDir);

  // Collect basenames of cards in this directory to detect collisions.
  // Keyed case-insensitively — macOS/Windows filesystems are case-insensitive,
  // so "Foo.memo.card" and "foo.memo.card" collide on disk even though their
  // basenames differ in case. The first-seen casing is kept for the message.
  const basenamesSeen = new Map<string, { base: string; names: string[] }>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".card")) continue;
    const base = cardBasename(entry.name);
    if (base === entry.name) continue; // didn't parse cleanly
    const key = base.toLowerCase();
    const existing = basenamesSeen.get(key);
    if (existing) {
      existing.names.push(entry.name);
    } else {
      basenamesSeen.set(key, { base, names: [entry.name] });
    }
  }
  for (const { base, names: cardNames } of basenamesSeen.values()) {
    if (cardNames.length < 2) continue;
    for (const name of cardNames) {
      const rel = path.relative(ctx.boxRoot, path.join(absDir, name));
      ctx.errors.push({
        path: rel,
        rule: "basename-collision",
        message: `Cards in ${relDir || "."} share basename "${base}": ${cardNames.toSorted().join(", ")}. The shared basename makes <basename>${ATTACH_SUFFIX}/ ownership ambiguous.`,
      });
    }
  }

  for (const entry of entries) {
    const absPath = path.join(absDir, entry.name);
    const relPath = path.relative(ctx.boxRoot, absPath);

    // Skip ignored / vendored dirs at any depth
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;

    // Literal-attach rule: only enforced outside an existing attach scope
    if (!insideScope && isLiteralAttachName(entry.name)) {
      ctx.errors.push({
        path: relPath,
        rule: "literal-attach-name",
        message: "Name \"attach\" is reserved (collides with the attach/ virtual ref prefix). Rename or use the <basename>.attach/ convention.",
      });
    }

    if (entry.isDirectory()) {
      await scanDir(ctx, absPath);
    }
  }
}

/** Re-export so callers can build messages without importing from attach-path. */
