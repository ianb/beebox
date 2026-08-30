/**
 * Per-file refresh: bring one card or standalone markdown file up to date
 * in the index, maintaining its manifest entry and (for frontmatter cards)
 * its contains-state observation. The orchestration lives in refresh.ts.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { insertMultiple, remove } from "@orama/orama";
import { ParseError } from "../../cards/index.js";
import { loadCardFromText, CardIOError, type LoadCardContext } from "../card-io.js";
import { buildLoadContext } from "../load-context.js";
import {
  extractCardDocs,
  extractMarkdownFileDocs,
  declareInputFiles,
  effectiveContains,
  type SearchDoc,
} from "./extract.js";
import type { CardStat } from "./walk.js";
import type { SearchManifest, ManifestFileEntry, InputFileEntry } from "./manifest.js";
import { type SearchIndex } from "./search-store.js";
import { contentHash as computeContentHash } from "../../lib/content-hash.js";
import {
  computeContainsBasis,
  observeCard,
  dropCardState,
  type ContainsState,
} from "./contains-state.js";
import { errorMessage } from "../../lib/error-guards.js";

export interface RefreshState {
  boxRoot: string;
  db: SearchIndex;
  manifest: SearchManifest;
  warnings: string[];
  containsState: ContainsState;
  ctx: LoadCardContext | null;
}

export type RefreshEffect = "none" | "manifest" | "index";

/** Remove a card's docs + manifest entry. Returns true when anything was dropped. */
export async function dropCard(state: RefreshState, relPath: string): Promise<boolean> {
  const entry = state.manifest.files[relPath];
  dropCardState(state.containsState, relPath);
  if (entry === undefined) return false;
  await removeDocs(state.db, entry.docIds);
  delete state.manifest.files[relPath];
  return true;
}

/** Bring one (searchable) card up to date in the index. */
export async function refreshOneCard(
  state: RefreshState,
  { relPath, stat }: { relPath: string; stat: CardStat }
): Promise<RefreshEffect> {
  const { boxRoot, db, manifest, warnings } = state;
  const entry = manifest.files[relPath];
  const statChanged =
    entry === undefined || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size;
  const inputsChanged = entry === undefined ? false : await anyInputChanged(boxRoot, entry);
  if (!statChanged && !inputsChanged) return "none";

  let content: string;
  try {
    content = await fs.readFile(path.join(boxRoot, relPath), "utf8");
  } catch (e) {
    warnings.push(`${relPath}: unreadable (${errorMessage(e)})`);
    return "none";
  }
  const contentHash = computeContentHash(content);
  if (entry !== undefined && !inputsChanged && entry.contentHash === contentHash) {
    // Touched but unchanged (e.g. git checkout): refresh stat bookkeeping only.
    manifest.files[relPath] = { ...entry, mtimeMs: stat.mtimeMs, size: stat.size };
    return "manifest";
  }

  if (state.ctx === null) state.ctx = await buildLoadContext(boxRoot);
  let docs: SearchDoc[];
  let inputs: Record<string, InputFileEntry>;
  try {
    const card = await loadCardFromText({ content, source: relPath, ctx: state.ctx });
    const inputRead = await readInputFiles(boxRoot, declareInputFiles({ path: relPath, card }));
    inputs = inputRead.entries;
    warnings.push(...inputRead.warnings);
    docs = extractCardDocs({ path: relPath, card, contentHash, inputContents: inputRead.contents });
    const basis = computeContainsBasis({ card, inputContents: inputRead.contents });
    observeCard(state.containsState, {
      cardPath: relPath,
      contains: effectiveContains(card.schema.type, card.fields),
      basis,
    });
  } catch (e) {
    // CardIOError: bad frontmatter/schema. ParseError: malformed XML body.
    // Either way the card is skipped with a warning — one broken card must
    // not take down search for the whole box. The skip is remembered in the
    // manifest so an unchanged broken card warns once, not on every search.
    if (!(e instanceof CardIOError) && !(e instanceof ParseError)) throw e;
    const detail = e instanceof CardIOError ? e.detail : e.message;
    warnings.push(`${relPath}: skipped (${detail})`);
    const hadDocs = await dropCard(state, relPath);
    manifest.files[relPath] = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      contentHash,
      docIds: [],
      skipped: true,
    };
    return hadDocs ? "index" : "manifest";
  }

  if (entry !== undefined) await removeDocs(db, entry.docIds);
  // Also clear any docs already present under these ids before inserting. This
  // is what makes crash recovery idempotent: a crash that persisted the index
  // before the manifest (the documented ordering) can leave the restored index
  // holding docs the older manifest doesn't list, so a plain insert would throw
  // "already exists". The extra removes are no-ops in the normal path.
  await removeDocs(db, docs.map((d) => d.id));
  await insertMultiple(db, docs);
  const newEntry: ManifestFileEntry = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    contentHash,
    docIds: docs.map((d) => d.id),
  };
  if (Object.keys(inputs).length > 0) newEntry.inputs = inputs;
  manifest.files[relPath] = newEntry;
  return "index";
}

/** Bring one standalone markdown file up to date in the index. */
export async function refreshOneMarkdownFile(
  state: RefreshState,
  { relPath, stat }: { relPath: string; stat: CardStat }
): Promise<RefreshEffect> {
  const { boxRoot, db, manifest, warnings } = state;
  const entry = manifest.files[relPath];
  const statChanged =
    entry === undefined || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size;
  if (!statChanged) return "none";

  let content: string;
  try {
    content = await fs.readFile(path.join(boxRoot, relPath), "utf8");
  } catch (e) {
    warnings.push(`${relPath}: unreadable (${errorMessage(e)})`);
    return "none";
  }
  const contentHash = computeContentHash(content);
  if (entry !== undefined && entry.contentHash === contentHash) {
    manifest.files[relPath] = { ...entry, mtimeMs: stat.mtimeMs, size: stat.size };
    return "manifest";
  }

  const docs = extractMarkdownFileDocs({ path: relPath, content, contentHash });
  if (entry !== undefined) await removeDocs(db, entry.docIds);
  // Idempotent against a restored index that's ahead of the manifest — see the
  // matching note in refreshOneCard.
  await removeDocs(db, docs.map((d) => d.id));
  await insertMultiple(db, docs);
  manifest.files[relPath] = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    contentHash,
    docIds: docs.map((d) => d.id),
  };
  return "index";
}

async function removeDocs(db: SearchIndex, docIds: string[]): Promise<void> {
  for (const id of docIds) {
    await remove(db, id);
  }
}

async function anyInputChanged(boxRoot: string, entry: ManifestFileEntry): Promise<boolean> {
  if (entry.inputs === undefined) return false;
  for (const [relPath, recorded] of Object.entries(entry.inputs)) {
    let stat: CardStat;
    try {
      const st = await fs.stat(path.join(boxRoot, relPath));
      stat = { mtimeMs: st.mtimeMs, size: st.size };
    } catch (_e) {
      return true; // input vanished
    }
    if (stat.mtimeMs !== recorded.mtimeMs || stat.size !== recorded.size) return true;
  }
  return false;
}

async function readInputFiles(
  boxRoot: string,
  declared: string[]
): Promise<{
  contents: Map<string, string>;
  entries: Record<string, InputFileEntry>;
  warnings: string[];
}> {
  const contents = new Map<string, string>();
  const entries: Record<string, InputFileEntry> = {};
  const warnings: string[] = [];
  for (const relPath of declared) {
    try {
      const abs = path.join(boxRoot, relPath);
      const content = await fs.readFile(abs, "utf8");
      const st = await fs.stat(abs);
      contents.set(relPath, content);
      entries[relPath] = {
        mtimeMs: st.mtimeMs,
        size: st.size,
        contentHash: computeContentHash(content),
      };
    } catch (e) {
      warnings.push(`${relPath}: input file unreadable (${errorMessage(e)})`);
    }
  }
  return { contents, entries, warnings };
}
