/** Safe fixture and reference-doc setup for knowledge audits. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ensurePackageDocs } from "../../core/docs-gen/package-docs.js";
import { errnoCode } from "../../lib/error-guards.js";
import type { AuditTest } from "./test-suite-schema.js";

export class UnsafeAuditFixturePathError extends Error {
  constructor(params: { relPath: string; reason: "escapes the box" | "crosses a symbolic link" }) {
    super(`Knowledge-audit fixture path ${params.reason}: ${params.relPath}`);
    this.name = "UnsafeAuditFixturePathError";
  }
}

export class AuditPackageDocsSetupError extends Error {
  constructor(reason: string) {
    super(`Cannot prepare generated package docs for knowledge audit: ${reason}`);
    this.name = "AuditPackageDocsSetupError";
  }
}

export async function ensureAuditPackageDocs(boxRoot: string, test: AuditTest): Promise<void> {
  const packageDocsPrefix = "node_modules/beebox/box-docs/";
  const referencedFiles = [...(test.should_read ?? []), ...(test.should_read_any ?? [])];
  if (!referencedFiles.some((file) => file.includes(packageDocsPrefix))) return;

  // The destination can itself be a package symlink in an installed box.
  // Never let audit setup generate files through it into the checkout.
  await assertFixturePathInBox(boxRoot, `${packageDocsPrefix}README.md`);
  const packageRoot = path.join(boxRoot, "node_modules", "beebox");
  // Generate the real engine docs into the audit box instead of faking their
  // contents with fixtures under a package symlink.
  await fs.mkdir(packageRoot, { recursive: true });
  const result = await ensurePackageDocs({ packageRoot });
  if (result.status === "unwritable") throw new AuditPackageDocsSetupError(result.reason);
}

/** Write fixture files declared by an audit after checking every path. */
export async function writeFixtures(
  boxRoot: string,
  fixture: Record<string, string> | undefined,
): Promise<string[]> {
  if (!fixture) return [];
  const entries = await Promise.all(Object.entries(fixture).map(async ([relPath, content]) => ({
    absPath: await assertFixturePathInBox(boxRoot, relPath),
    content,
  })));
  const written: string[] = [];
  for (const { absPath, content } of entries) {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content, "utf-8");
    written.push(absPath);
  }
  return written;
}

/** Resolve fixture paths inside a box and reject symlink traversal. */
export async function assertFixturePathInBox(boxRoot: string, relPath: string): Promise<string> {
  const root = await fs.realpath(boxRoot);
  const absPath = path.resolve(root, relPath);
  const relative = path.relative(root, absPath);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new UnsafeAuditFixturePathError({ relPath, reason: "escapes the box" });
  }

  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    let info: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      info = await fs.lstat(current);
    } catch (error) {
      if (errnoCode(error) === "ENOENT") break;
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw new UnsafeAuditFixturePathError({ relPath, reason: "crosses a symbolic link" });
    }
  }
  return absPath;
}

export async function removeFixtures(paths: string[]): Promise<void> {
  for (const filePath of paths) await fs.rm(filePath, { force: true });
}
