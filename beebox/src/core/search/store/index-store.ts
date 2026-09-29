/**
 * The parameterized half of `store.ts`: one factory, many indexes.
 *
 * The card index and the chat-transcript index share everything about
 * persistence — `.beebox/` cache placement, atomic write-then-rename, the
 * index-before-manifest receipt ordering, sweep of the msgpack-experiment
 * leftover — and differ only in filenames and schema. This module owns that
 * shared shape so the ordering invariant exists once. See `store.ts` for the
 * format history (JSON, not msgpack) and the crash-safety argument.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { create, type AnySchema, type Orama } from "@orama/orama";
import { persistToFile, restoreFromFile } from "@orama/plugin-data-persistence/server";
import { errorMessage } from "../../../shared/error-guards.js";

/** Left behind by the short-lived binary-format experiment (2026-07). */
const LEGACY_INDEX_EXT = ".msp";

/**
 * Proof that the on-disk index at `boxRoot` is current — i.e. it already
 * reflects the doc ids the manifest is about to record. `saveManifest`
 * requires one, so the manifest can never be written ahead of the index (the
 * crash-safety ordering documented in `store.ts` becomes a compile-time
 * guarantee, not a convention). Only a fresh persist (or a no-doc-change
 * refresh) mints one — the brand key is module-private, so no other code can
 * forge a receipt.
 */
const indexPersistedBrand = Symbol("IndexPersisted");
export interface IndexPersisted {
  readonly [indexPersistedBrand]: true;
  readonly boxRoot: string;
}

export function indexPersistedFor(boxRoot: string): IndexPersisted {
  return { [indexPersistedBrand]: true, boxRoot };
}

/** The file names an index, its manifest, and its lock live under in `.beebox/`. */
export interface IndexStoreFiles {
  indexFilename: string;
  manifestFilename: string;
  lockFilename: string;
  /** Warned in the label of every log line this store emits. */
  label: string;
}

export interface IndexStore<TSchema extends AnySchema> {
  indexPath(boxRoot: string): string;
  manifestPath(boxRoot: string): string;
  lockPath(boxRoot: string): string;
  create(): Promise<Orama<TSchema>>;
  /**
   * Restore the persisted index, or null when it's absent or unreadable
   * (caller rebuilds — the index is a cache, never a source of truth).
   */
  restore(boxRoot: string): Promise<Orama<TSchema> | null>;
  /** Persist the index atomically (write temp, rename); returns the ordering receipt. */
  persist(db: Orama<TSchema>, boxRoot: string): Promise<IndexPersisted>;
}

/**
 * Build an index store for one index's filenames and schema. The returned
 * `persist` sweeps the `.msp` leftover next to the index file so a cache dir
 * doesn't carry a dead binary index forever.
 */
export function createIndexStore<TSchema extends AnySchema>(
  files: IndexStoreFiles,
  schema: TSchema,
): IndexStore<TSchema> {
  function indexPath(boxRoot: string): string {
    return path.join(boxRoot, ".beebox", files.indexFilename);
  }
  return {
    indexPath,
    manifestPath(boxRoot) {
      return path.join(boxRoot, ".beebox", files.manifestFilename);
    },
    lockPath(boxRoot) {
      return path.join(boxRoot, ".beebox", files.lockFilename);
    },
    async create() {
      return create({ schema });
    },
    async restore(boxRoot: string) {
      const storePath = indexPath(boxRoot);
      try {
        await fs.access(storePath);
      } catch (_e) {
        return null;
      }
      try {
        return await restoreFromFile<Orama<TSchema>>("json", storePath);
      } catch (e) {
        console.warn(`${files.label}: could not restore index (${errorMessage(e)}); rebuilding`);
        return null;
      }
    },
    async persist(db, boxRoot) {
      const storePath = indexPath(boxRoot);
      await fs.mkdir(path.dirname(storePath), { recursive: true });
      const tmp = `${storePath}.tmp`;
      await persistToFile(db, "json", tmp);
      await fs.rename(tmp, storePath);
      await fs.rm(`${storePath.slice(0, -path.extname(storePath).length)}${LEGACY_INDEX_EXT}`, { force: true });
      return indexPersistedFor(boxRoot);
    },
  };
}

/** Write a JSON file atomically (write temp, rename). */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n");
  await fs.rename(tmp, filePath);
}
