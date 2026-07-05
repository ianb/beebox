#!/usr/bin/env tsx

/**
 * Rewrite the `.gitignore` marker line that scopes the asset block
 * (formerly "attach-binaries"). Old marker:
 *
 *   # cb-attach-binaries (managed by cb attachments init-gitignore)
 *
 * New marker:
 *
 *   # cb-assets (managed by cb attachments init-gitignore)
 *
 * Also refreshes the explanatory comment block immediately following the
 * marker so the wording matches the new vocabulary. The gitignore patterns
 * themselves are unchanged.
 *
 * Idempotent. Usage:
 *   pnpm exec tsx scripts/migrate/asset-marker.ts <boxRoot>             # dry-run
 *   pnpm exec tsx scripts/migrate/asset-marker.ts <boxRoot> --apply
 */

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const OLD_MARKER = "# cb-attach-binaries (managed by cb attachments init-gitignore)";
const NEW_MARKER = "# cb-assets (managed by cb attachments init-gitignore)";

const OLD_COMMENT_BLOCK = `# Binary attachments inside .attach/ scopes are tracked via per-dir
# manifest.json (size + sha256), not committed directly. See
# docs/attach-manifests.md.`;
const NEW_COMMENT_BLOCK = `# Assets inside .attach/ scopes are tracked via per-dir manifest.json
# (size + sha256), not committed directly. See docs/asset-manifests.md.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.find((a) => !a.startsWith("--"));
  const boxRoot = positional;
  if (boxRoot === undefined) {
    console.error("Usage: asset-marker.ts <boxRoot> [--apply]");
    process.exit(1);
  }

  const gitignorePath = join(resolve(boxRoot), ".gitignore");
  let content: string;
  try {
    content = await readFile(gitignorePath, "utf-8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      console.log("No .gitignore in box; nothing to do.");
      return;
    }
    throw e;
  }

  let next = content;
  let changed = false;
  if (next.includes(OLD_MARKER)) {
    next = next.replace(OLD_MARKER, NEW_MARKER);
    changed = true;
  }
  if (next.includes(OLD_COMMENT_BLOCK)) {
    next = next.replace(OLD_COMMENT_BLOCK, NEW_COMMENT_BLOCK);
    changed = true;
  }

  if (!changed) {
    console.log("Already up to date.");
    return;
  }

  if (!apply) {
    console.log("Would rewrite .gitignore asset marker + comment. Re-run with --apply.");
    return;
  }

  await writeFile(gitignorePath, next);
  console.log("Rewrote .gitignore asset marker + comment.");
}

await main();
