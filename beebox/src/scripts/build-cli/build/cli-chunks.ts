/**
 * The code-split CLI bundle's file rules: the order staged files move into
 * `dist/`, and which old chunks a build may delete.
 *
 * `dist/cli.mjs` imports `dist/cli-<name>-<hash>.mjs` chunks
 * (`docs/plans/lazy-cli-commands.md`, Track 4). Chunk names carry a content
 * hash, so a rebuild writes new files beside the old ones. A running dev
 * process may still import an old chunk until it reloads, so a chunk is
 * deleted only when none of the last few builds wrote it and it is over an
 * hour old.
 */

import { readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";

/**
 * `cli-<name>-<hash>.mjs` and its map, as esbuild names a chunk (`chunkNames`
 * in bundle.ts; the hash is eight base-32 characters, A-Z and 2-7). Not `cli.mjs` itself,
 * and not any other `cli-*.mjs` a person leaves in `dist/`.
 */
export const CLI_CHUNK_PATTERN = /^cli-[\w-]+-[2-7A-Z]{8}\.mjs(?:\.map)?$/;

/** Builds whose chunks are kept regardless of age. */
const KEPT_BUILDS = 3;
/** Any chunk younger than this is kept: a process may have just loaded its entry. */
const MIN_AGE_MS = 60 * 60 * 1000;

/**
 * The order to move staged files into `dist/`: maps first, then everything
 * else, then `cli.mjs` last, so a file never names a chunk or map that is not
 * yet in place.
 */
export function stagingOrder(paths: readonly string[]): string[] {
  const rank = (path: string): number => (path.endsWith(".map") ? 0 : path === "cli.mjs" ? 2 : 1);
  return paths.toSorted((a, b) => rank(a) - rank(b));
}

/** The chunk files to delete from `dist/`: not written by a kept build, and old. */
export function prunableChunks(params: {
  files: ReadonlyArray<{ name: string; mtimeMs: number }>;
  keptBuilds: ReadonlyArray<ReadonlyArray<string>>;
  now: number;
}): string[] {
  const kept = new Set(params.keptBuilds.flat());
  return params.files
    .filter((file) => CLI_CHUNK_PATTERN.test(file.name) && !kept.has(file.name) && params.now - file.mtimeMs > MIN_AGE_MS)
    .map((file) => file.name);
}

const manifestSchema = z.array(z.array(z.string()));

/**
 * Append this build's chunk names to the manifest at `path` and return the
 * builds it keeps, newest last. A missing or unreadable manifest starts over:
 * the one-hour age rule still protects chunks a process may have loaded.
 */
export async function recordBuild(path: string, chunks: readonly string[]): Promise<string[][]> {
  let builds: string[][] = [];
  try {
    const parsed = manifestSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    if (parsed.success) builds = parsed.data;
  } catch (_e) {
    // No manifest yet (a first build) or a torn one: start a new history.
  }
  const kept = [...builds, [...chunks]].slice(-KEPT_BUILDS);
  const partial = `${path}.${process.pid}.tmp`;
  await writeFile(partial, `${JSON.stringify(kept)}\n`);
  await rename(partial, path);
  return kept;
}
