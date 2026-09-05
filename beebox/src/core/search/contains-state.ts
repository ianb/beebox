/**
 * The `contains` staleness sidecar — `.beebox/contains-state.json`.
 *
 * Cards stay byte-clean: staleness bookkeeping lives here, per-checkout,
 * maintained by the index refresh. For every searchable frontmatter card we
 * record the `contains` text and the content basis it was last written
 * against; a card whose basis moved while its `contains` didn't is stale.
 *
 * The basis deliberately excludes `contains`/`title` (the derived fields
 * themselves), `type`, and `status` (operational flips like new→read must
 * not flag a still-true `contains` as stale). Bodied cards hash their body;
 * frontmatter-only cards hash their remaining fields; declared input files
 * (gdoc snapshots) always count.
 *
 * Kept separate from the index manifest so index rebuilds (schema bumps,
 * corruption) don't wipe staleness memory. A fresh clone has no sidecar, so
 * everything starts "fresh" — cache semantics, documented in the plan.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  loadCardFromText,
  type FrontmatterLoadedCard,
  type LoadedCard,
  type LoadCardContext,
} from "../card-io.js";
import { declareInputFiles, effectiveContains } from "./extract.js";
import { writeJsonAtomic } from "./search-store.js";
import { contentHash } from "../../lib/content-hash.js";
import { errorMessage } from "../../lib/error-guards.js";

const STATE_FILENAME = "contains-state.json";
// v2: containsText records the *effective* contains (per-kind description
// fallback), not just the literal field. Old sidecars rebuild via heal.
const STATE_VERSION = 2;

/**
 * Fields that never count toward the contains basis — the derived ones. If a
 * field that is written *because* `contains` was rewritten counted toward the
 * basis, writing it would move the basis and flag the just-written `contains`
 * stale. (`contains-evidence` is derived alongside `contains`; note the basis
 * only reaches frontmatter for card types with no body — see
 * computeContainsBasis — so for bodied cards this is policy, not a live bug.)
 */
const BASIS_EXCLUDED_FIELDS = new Set([
  "contains",
  "contains-evidence",
  "title",
  "type",
  "status",
]);

const containsCardStateSchema = z.object({
  /** The card's `contains` text ("" when the card has none yet). */
  containsText: z.string(),
  /** Basis hash when `containsText` was last seen to change. */
  basisAtWrite: z.string(),
  /** Basis hash from the most recent refresh. */
  currentBasis: z.string(),
});
export type ContainsCardState = z.infer<typeof containsCardStateSchema>;

const containsStateSchema = z.object({
  version: z.number(),
  cards: z.record(z.string(), containsCardStateSchema),
});
export type ContainsState = z.infer<typeof containsStateSchema>;

function emptyContainsState(): ContainsState {
  return { version: STATE_VERSION, cards: {} };
}

function containsStatePath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", STATE_FILENAME);
}

export async function loadContainsState(boxRoot: string): Promise<ContainsState> {
  let raw: string;
  try {
    raw = await fs.readFile(containsStatePath(boxRoot), "utf8");
  } catch (_e) {
    return emptyContainsState();
  }
  try {
    // Parse boundary: disk JSON is untrusted — validate the full shape with
    // zod rather than casting, so a corrupt or foreign-shaped sidecar falls
    // back to "fresh" instead of flowing unchecked data downstream.
    const parsed: unknown = JSON.parse(raw);
    const result = containsStateSchema.safeParse(parsed);
    if (!result.success || result.data.version !== STATE_VERSION) return emptyContainsState();
    return result.data;
  } catch (e) {
    console.warn(`contains-state unreadable (${errorMessage(e)}); starting fresh`);
    return emptyContainsState();
  }
}

export async function saveContainsState(boxRoot: string, state: ContainsState): Promise<void> {
  await writeJsonAtomic(containsStatePath(boxRoot), state);
}

/** The content basis a card's `contains` describes. */
export function computeContainsBasis(input: {
  card: LoadedCard;
  inputContents?: Map<string, string>;
}): string {
  const { card, inputContents } = input;
  const bodyName = card.schema.bodyFieldName;
  const body = bodyName === null ? null : card.fields[bodyName];
  const parts: string[] = [];
  if (typeof body === "string") {
    parts.push(body);
  } else {
    parts.push(canonicalFields(card));
  }
  if (inputContents !== undefined) {
    for (const [inputPath, content] of [...inputContents.entries()].toSorted()) {
      parts.push(`${inputPath}:${contentHash(content)}`);
    }
  }
  return contentHash(parts.join("\n "));
}

function canonicalFields(card: FrontmatterLoadedCard): string {
  const bodyName = card.schema.bodyFieldName;
  const keys = Object.keys(card.fields)
    .filter((k) => !BASIS_EXCLUDED_FIELDS.has(k) && k !== bodyName)
    .toSorted();
  const filtered: Record<string, unknown> = {};
  for (const key of keys) filtered[key] = card.fields[key];
  // Nested key order follows YAML parse order — stable for unchanged content,
  // which is all the basis comparison needs.
  return JSON.stringify(filtered);
}

/**
 * Record a card's refresh-time observation. First sight of a `contains`
 * text (new card, fresh clone, moved card) re-bases; an unchanged text
 * with a moving basis accumulates staleness.
 */
export function observeCard(
  state: ContainsState,
  { cardPath, contains, basis }: { cardPath: string; contains: string; basis: string }
): void {
  const entry = state.cards[cardPath];
  if (entry === undefined || entry.containsText !== contains) {
    state.cards[cardPath] = { containsText: contains, basisAtWrite: basis, currentBasis: basis };
    return;
  }
  entry.currentBasis = basis;
}

export function dropCardState(state: ContainsState, cardPath: string): void {
  delete state.cards[cardPath];
}

/**
 * Force-record a card's `contains` as written-against the given basis —
 * what `bbx contains update` does, including with identical text (running
 * the command IS the acknowledgment that a stale `contains` still holds).
 */
export function rebaseContains(
  state: ContainsState,
  { cardPath, contains, basis }: { cardPath: string; contains: string; basis: string }
): void {
  state.cards[cardPath] = { containsText: contains, basisAtWrite: basis, currentBasis: basis };
}

/** True when the card's content moved since its `contains` was written. */
function isStale(entry: ContainsCardState): boolean {
  return entry.containsText !== "" && entry.basisAtWrite !== entry.currentBasis;
}

/** Paths whose `contains` is stale, sorted. */
export function listStale(state: ContainsState): string[] {
  return Object.entries(state.cards)
    .filter(([, entry]) => isStale(entry))
    .map(([cardPath]) => cardPath)
    .toSorted();
}

/** Searchable frontmatter cards with no `contains` yet, sorted. */
export function listMissing(state: ContainsState): string[] {
  return Object.entries(state.cards)
    .filter(([, entry]) => entry.containsText === "")
    .map(([cardPath]) => cardPath)
    .toSorted();
}

/**
 * Load a card from disk and compute its `contains` + live basis (declared
 * input files included, so the result matches what the index refresh
 * records). Null basis: unreadable or unparseable file.
 */
export async function computeBasisForCardPath(
  boxRoot: string,
  { relPath, ctx }: { relPath: string; ctx: LoadCardContext }
): Promise<{ basis: string | null; contains: string }> {
  let card: LoadedCard;
  try {
    const content = await fs.readFile(path.join(boxRoot, relPath), "utf8");
    card = await loadCardFromText({ content, source: relPath, ctx });
  } catch (_e) {
    // Unreadable or unparseable: validation reports that separately; there
    // is no basis to compare against.
    return { basis: null, contains: "" };
  }
  const inputContents = new Map<string, string>();
  for (const inputPath of declareInputFiles({ path: relPath, card })) {
    try {
      inputContents.set(inputPath, await fs.readFile(path.join(boxRoot, inputPath), "utf8"));
    } catch (_e) {
      // Missing input files also surface during index refresh; for the basis
      // they simply contribute nothing.
    }
  }
  const contains = effectiveContains(card.schema.type, card.fields);
  return { basis: computeContainsBasis({ card, inputContents }), contains };
}

/**
 * The hook-time staleness nudge: non-null when this card's `contains` text
 * is unchanged from the sidecar's record but the content basis moved.
 */
export async function staleContainsWarning(
  boxRoot: string,
  { relPath, ctx }: { relPath: string; ctx: LoadCardContext }
): Promise<string | null> {
  const { basis, contains } = await computeBasisForCardPath(boxRoot, { relPath, ctx });
  if (basis === null || contains === "") return null;
  const state = await loadContainsState(boxRoot);
  const entry = state.cards[relPath];
  if (entry === undefined) return null;
  if (entry.containsText !== contains) return null; // contains was updated with the edit
  if (entry.basisAtWrite === basis) return null;
  return (
    `${relPath}: card content changed but contains: didn't — review it; ` +
    `if it still holds, confirm with \`bbx contains update "${relPath}" --text "...same text..."\``
  );
}
