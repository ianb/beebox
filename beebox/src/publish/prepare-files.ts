/** Validates and stages the finished static files for one publication. */

import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { fileStats, type FilePreview } from "./draft.js";
import { scanBundle, type LeakScanResult } from "./leak-scan.js";
import { releaseIdForFiles } from "./manifest-edge.js";
import type { PublicationDefinition } from "./publication-definition.js";
import { bundlePolicyError } from "./prepare-errors.js";

/** Hard bounds for a single prepared site release; intentionally no config surface in v1. */
export const PUBLICATION_FILE_LIMITS = {
  files: 2_000,
  perFileBytes: 25 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
} as const;

const TEXT_EXTENSIONS = new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg", ".txt", ".md", ".xml", ".webmanifest"]);
const FORBIDDEN_BASENAMES = new Set([
  ".env", ".npmrc", ".netrc", ".dev.vars", ".git", ".ssh", ".wrangler", "node_modules",
  "credentials.json", "credential.json", "secrets.json", "secret.json", "id_rsa", "id_ed25519",
  "notes.md", "claude.md", "package.json", "pnpm-lock.yaml",
]);
const FORBIDDEN_SECRET_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx"]);
const FORBIDDEN_SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

export interface PreparedFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface CollectedPublicationFiles {
  contentHash: string;
  files: PreparedFile[];
  preview: FilePreview[];
  scan: LeakScanResult;
}

function relativeBundlePath(root: string, absolute: string): string {
  const relative = path.relative(root, absolute);
  if (relative === "" || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw bundlePolicyError(`output path escapes the selected publication root: ${absolute}`);
  }
  const normalized = relative.split(path.sep).join("/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.includes("\\"))) {
    throw bundlePolicyError(`unsafe output path '${normalized}'`);
  }
  return normalized;
}

function validateBundlePath(relative: string, definition: PublicationDefinition): void {
  const segments = relative.split("/");
  const decoded: string[] = [];
  for (const rawSegment of segments) {
    let segment: string;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch (_error) {
      throw bundlePolicyError(`output path '${relative}' contains invalid URL encoding`);
    }
    if (segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\") || segment.includes("\0")) {
      throw bundlePolicyError(`output path '${relative}' contains a path-control segment`);
    }
    if (segment.startsWith(".")) {
      throw bundlePolicyError(`hidden output path '${relative}' is not publishable`);
    }
    if (segment.startsWith("__")) {
      throw bundlePolicyError(`reserved internal route segment '${segment}' in '${relative}' is not publishable`);
    }
    const basename = segment.toLowerCase();
    if (FORBIDDEN_BASENAMES.has(basename) || basename.startsWith(".env.") || basename.startsWith(".dev.vars.")) {
      throw bundlePolicyError(`sensitive output filename '${relative}' is not publishable`);
    }
    decoded.push(segment);
  }
  const basename = decoded.at(-1)?.toLowerCase() ?? "";
  if (FORBIDDEN_SOURCE_EXTENSIONS.has(path.posix.extname(basename))) {
    throw bundlePolicyError(`uncompiled source file '${relative}' is not publishable`);
  }
  if (path.posix.extname(basename) === ".map") {
    throw bundlePolicyError(`source map '${relative}' is not publishable`);
  }
  if (FORBIDDEN_SECRET_EXTENSIONS.has(path.posix.extname(basename))) {
    throw bundlePolicyError(`private-key file '${relative}' is not publishable`);
  }
  if (definition.tier === "public" && definition.slug !== undefined && decoded[0] === "p" && decoded[1] === definition.slug) {
    throw bundlePolicyError(`output path '${relative}' collides with this publication's /p/${definition.slug}/ public alias`);
  }
  if (definition.content === "project" && decoded[0] === "src") {
    throw bundlePolicyError(`project dist/ includes a src/ directory at '${relative}'; publish compiled assets only`);
  }
}

async function readBoundedRegularFile(args: { absolute: string; relative: string; currentTotal: number }): Promise<Buffer> {
  const { absolute, relative, currentTotal } = args;
  const before = await lstat(absolute);
  if (before.isSymbolicLink()) throw bundlePolicyError(`symlink '${relative}' is not publishable`);
  if (!before.isFile()) throw bundlePolicyError(`non-regular file '${relative}' is not publishable`);
  if (before.size > PUBLICATION_FILE_LIMITS.perFileBytes) {
    throw bundlePolicyError(`file '${relative}' is ${before.size} bytes; per-file limit is ${PUBLICATION_FILE_LIMITS.perFileBytes} bytes`, { observed: before.size, limit: PUBLICATION_FILE_LIMITS.perFileBytes });
  }
  if (currentTotal + before.size > PUBLICATION_FILE_LIMITS.totalBytes) {
    const observed = currentTotal + before.size;
    throw bundlePolicyError(`bundle would be ${observed} bytes; total limit is ${PUBLICATION_FILE_LIMITS.totalBytes} bytes`, { observed, limit: PUBLICATION_FILE_LIMITS.totalBytes });
  }

  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const after = await handle.stat();
    if (!after.isFile()) throw bundlePolicyError(`non-regular file '${relative}' is not publishable`);
    if (after.size > PUBLICATION_FILE_LIMITS.perFileBytes) {
      throw bundlePolicyError(`file '${relative}' is ${after.size} bytes; per-file limit is ${PUBLICATION_FILE_LIMITS.perFileBytes} bytes`, { observed: after.size, limit: PUBLICATION_FILE_LIMITS.perFileBytes });
    }
    const remainingTotal = PUBLICATION_FILE_LIMITS.totalBytes - currentTotal;
    const maximum = Math.min(PUBLICATION_FILE_LIMITS.perFileBytes, remainingTotal);
    const chunks: Buffer[] = [];
    const scratch = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    let position = 0;
    for (;;) {
    const readLength = Math.min(scratch.length, Math.max(1, maximum - offset + 1));
      const { bytesRead } = await handle.read(scratch, 0, readLength, position);
      if (bytesRead === 0) break;
      offset += bytesRead;
      position += bytesRead;
      if (offset > PUBLICATION_FILE_LIMITS.perFileBytes) {
        throw bundlePolicyError(`file '${relative}' exceeds the ${PUBLICATION_FILE_LIMITS.perFileBytes}-byte per-file limit (observed at least ${offset})`, { observed: offset, limit: PUBLICATION_FILE_LIMITS.perFileBytes });
      }
      if (currentTotal + offset > PUBLICATION_FILE_LIMITS.totalBytes) {
        const observed = currentTotal + offset;
        throw bundlePolicyError(`bundle exceeds the ${PUBLICATION_FILE_LIMITS.totalBytes}-byte total limit (observed at least ${observed})`, { observed, limit: PUBLICATION_FILE_LIMITS.totalBytes });
      }
      chunks.push(Buffer.from(scratch.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, offset);
  } finally {
    await handle.close();
  }
}

async function collectFiles(root: string, definition: PublicationDefinition): Promise<Map<string, Buffer>> {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw bundlePolicyError(`publication output root '${root}' must be a real directory`);
  }

  const files = new Map<string, Buffer>();
  let totalBytes = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeBundlePath(root, absolute);
      validateBundlePath(relative, definition);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw bundlePolicyError(`symlink '${relative}' is not publishable`);
      if (info.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!info.isFile()) throw bundlePolicyError(`non-regular output '${relative}' is not publishable`);
      if (files.size + 1 > PUBLICATION_FILE_LIMITS.files) {
        const observed = files.size + 1;
        throw bundlePolicyError(`bundle has more than ${PUBLICATION_FILE_LIMITS.files} files (observed at least ${observed})`, { observed, limit: PUBLICATION_FILE_LIMITS.files });
      }
      const content = await readBoundedRegularFile({ absolute, relative, currentTotal: totalBytes });
      totalBytes += content.length;
      files.set(relative, content);
    }
  };
  await visit(root);
  if (files.size === 0) throw bundlePolicyError("publication output contains no files");
  if (!files.has("index.html")) throw bundlePolicyError("publication output must include a root index.html; SPA fallback is not supported");
  return files;
}

function asTextOrBinary(relative: string, bytes: Buffer): string | Uint8Array {
  return TEXT_EXTENSIONS.has(path.posix.extname(relative).toLowerCase()) ? bytes.toString("utf-8") : new Uint8Array(bytes);
}

/** Validate routes, enforce bounds, scan content, and create immutable input metadata. */
export async function collectPublicationFiles(args: { root: string; definition: PublicationDefinition; ownerEmail: string | null }): Promise<{ output: Map<string, Buffer>; collected: CollectedPublicationFiles }> {
  const { root, definition, ownerEmail } = args;
  const output = await collectFiles(root, definition);
  const statsByPath: Record<string, { bytes: number; sha256: string }> = {};
  const preview: FilePreview[] = [];
  const scanFiles = new Map<string, string | Uint8Array>();
  for (const [relative, bytes] of output) {
    const stats = fileStats(bytes);
    statsByPath[relative] = stats;
    preview.push({ path: relative, ...stats });
    scanFiles.set(relative, asTextOrBinary(relative, bytes));
  }
  const scan = scanBundle(scanFiles, {
    ownerEmail,
    allowedEmails: definition.tier === "accounts" ? definition.emails : [],
  });
  const contentHash = await releaseIdForFiles(statsByPath);
  return {
    output,
    collected: {
      contentHash,
      files: preview.map(({ path: filePath, bytes, sha256 }) => ({ path: filePath, bytes, sha256 })),
      preview: preview.toSorted((a, b) => a.path.localeCompare(b.path)),
      scan,
    },
  };
}

export async function stagePublicationFiles(output: Map<string, Buffer>, stagedDir: string): Promise<void> {
  await mkdir(stagedDir, { recursive: true });
  for (const [relative, bytes] of output) {
    const destination = path.join(stagedDir, ...relative.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx" });
  }
}
