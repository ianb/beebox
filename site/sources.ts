// The single definition of the generator's input source set, shared by the
// generator (which writes an input manifest into dist/) and the dev router
// (which re-hashes the sources on each request and rebuilds on ANY difference).
// Keeping one enumeration here — rather than duplicating globs in the router —
// is what makes the never-serve-stale contract hold: the two sides can't drift.
//
// The check is content-based, not mtime-based: a deletion or rename bumps no
// mtime yet changes the hashed set, and hashes don't trust clocks. In doubt the
// router rebuilds (missing/unparseable manifest → stale), never serves stale.

import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { listNuggetSourceRefs } from "./nuggets.js";

/** One input file: path relative to site/ (posix), and a short content hash. */
export interface SourceInput {
  rel: string;
  hash: string;
}

export const MANIFEST_NAME = ".inputs.json";

const manifestSchema = z.object({
  inputs: z.array(z.object({ rel: z.string(), hash: z.string() })),
});

/**
 * The input source set the generator reads, as site/-relative posix paths,
 * sorted: package.json, every top-level *.ts, everything under cards/ and
 * nuggets/, and every repo file a nugget cites (as `../<repo-relative path>`).
 * dist/ and node_modules/ are excluded by construction (never descended into).
 *
 * The cited sources belong here even though they live outside site/: a nugget's
 * span is re-located against its source at build, so editing that source can
 * change whether the nugget renders stale. Leaving them out would let the router
 * serve a nugget whose stale marker never appears.
 */
export async function listSourceRelPaths(siteDir: string): Promise<string[]> {
  const rels: string[] = ["package.json"];
  const top = await fs.readdir(siteDir, { withFileTypes: true });
  for (const entry of top) {
    if (entry.isFile() && entry.name.endsWith(".ts")) rels.push(entry.name);
  }
  for (const dir of ["cards", "nuggets"]) {
    for (const entry of await readdirDirents(path.join(siteDir, dir))) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      const rel = path.relative(siteDir, path.join(entry.parentPath, entry.name));
      rels.push(rel.split(path.sep).join("/"));
    }
  }
  for (const source of await listNuggetSourceRefs(path.join(siteDir, "nuggets"))) {
    rels.push(`../${source}`);
  }
  return rels.toSorted((a, b) => a.localeCompare(b));
}

async function readdirDirents(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { recursive: true, withFileTypes: true });
  } catch (_err) {
    return []; // no such dir → nothing to add
  }
}

/** Hash the current input source set. Throws if a listed file can't be read. */
export async function hashSources(siteDir: string): Promise<SourceInput[]> {
  const rels = await listSourceRelPaths(siteDir);
  const inputs: SourceInput[] = [];
  for (const rel of rels) {
    const buf = await fs.readFile(path.join(siteDir, rel));
    inputs.push({ rel, hash: createHash("sha256").update(buf).digest("hex").slice(0, 16) });
  }
  return inputs;
}

/** Write the input manifest into dist/. Call LAST, after all output is emitted. */
export async function writeManifest(siteDir: string, distRoot: string): Promise<void> {
  const inputs = await hashSources(siteDir);
  await fs.writeFile(path.join(distRoot, MANIFEST_NAME), `${JSON.stringify({ inputs }, null, 2)}\n`, "utf8");
}

function sameInputs(a: readonly SourceInput[], b: readonly SourceInput[]): boolean {
  if (a.length !== b.length) return false;
  for (const [i, item] of a.entries()) {
    if (item.rel !== b[i]?.rel || item.hash !== b[i]?.hash) return false;
  }
  return true;
}

/**
 * True if dist/ must be (re)built: any source added, removed, or changed since
 * the manifest was written, or the manifest missing/unparseable. Fails toward
 * rebuilding — any error enumerating or reading is treated as stale.
 */
export async function isStale(siteDir: string, distRoot: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(path.join(distRoot, MANIFEST_NAME), "utf8");
    const parsed: unknown = JSON.parse(raw);
    const recorded = manifestSchema.parse(parsed);
    const current = await hashSources(siteDir);
    return !sameInputs(recorded.inputs, current);
  } catch (_err) {
    return true;
  }
}
