/** Small filesystem helpers for the publication-cards migration. Paths are box-relative, POSIX-style. */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../../../shared/error-guards.js";

/** Shared run state: what was (or, in a dry run, would be) done. */
export interface MigrationContext {
  boxRoot: string;
  apply: boolean;
  /** One line per change, in order. */
  actions: string[];
  /** Things the boxholder should look at. */
  warnings: string[];
  /** Cards this run rewrote, removed, or created; rule e skips them. */
  handledCards: Set<string>;
  /** Final paths of the cards this run wrote. */
  migratedCards: string[];
  /** pubIds already turned into a card in this run; a second definition with one is left in place. */
  migratedPubIds: Set<string>;
}

export function abs(ctx: MigrationContext, rel: string): string {
  return path.join(ctx.boxRoot, ...rel.split("/"));
}

export function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Read a regular file; null when missing. */
export async function readOrNull(ctx: MigrationContext, rel: string): Promise<string | null> {
  try {
    return await fs.readFile(abs(ctx, rel), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

export type EntryKind = "missing" | "file" | "dir" | "symlink" | "other";

/** What is at `rel`, without following a symlink. */
export async function entryKind(ctx: MigrationContext, rel: string): Promise<EntryKind> {
  try {
    const stat = await fs.lstat(abs(ctx, rel));
    if (stat.isSymbolicLink()) return "symlink";
    if (stat.isDirectory()) return "dir";
    return stat.isFile() ? "file" : "other";
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return "missing";
    throw e;
  }
}

/** Remove a directory when it is empty; report whether it was (or would be) removed. */
export async function removeIfEmpty(ctx: MigrationContext, rel: string): Promise<boolean> {
  if ((await entryKind(ctx, rel)) !== "dir") return false;
  if ((await fs.readdir(abs(ctx, rel))).length > 0) return false;
  if (ctx.apply) await fs.rm(abs(ctx, rel), { recursive: true });
  ctx.actions.push(`remove empty ${rel}/`);
  return true;
}

/** Move a file or directory, creating the destination's parent. */
export async function move(ctx: MigrationContext, { fromRel, toRel }: { fromRel: string; toRel: string }): Promise<void> {
  if (ctx.apply) {
    await fs.mkdir(path.dirname(abs(ctx, toRel)), { recursive: true });
    await fs.rename(abs(ctx, fromRel), abs(ctx, toRel));
  }
  ctx.actions.push(`move ${fromRel} -> ${toRel}`);
}

export async function writeText(ctx: MigrationContext, { rel, content }: { rel: string; content: string }): Promise<void> {
  if (!ctx.apply) return;
  await fs.mkdir(path.dirname(abs(ctx, rel)), { recursive: true });
  await fs.writeFile(abs(ctx, rel), content);
}

export async function remove(ctx: MigrationContext, rel: string): Promise<void> {
  if (ctx.apply) await fs.rm(abs(ctx, rel), { recursive: true, force: true });
  ctx.actions.push(`delete ${rel}`);
}
