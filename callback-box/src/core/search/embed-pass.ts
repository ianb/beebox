/**
 * The refresh embedding pass: batch-embed the `contains` texts that changed
 * (or were never embedded) and re-insert their whole-card documents with a
 * vector, plus the readiness computation the query layer gates hybrid on.
 *
 * Runs inside the existing refresh, after `healContainsState` and before the
 * persist block, only when an embeddings service is available. Kept out of
 * refresh.ts so that file stays under the 300-line cap.
 *
 * `embeddedHash` (in the manifest) is the whole state this needs: a card is
 * pending when its hash of `EMBEDDER_ID + "\n" + containsText` doesn't match
 * what was last embedded — one rule covering changed cards, never-embedded
 * cards (fresh key, schema rebuild), and cards whose last embed failed.
 */

import { getByID, insert, remove } from "@orama/orama";
import { contentHash } from "../../lib/content-hash.js";
import { invariant } from "../../lib/invariant.js";
import {
  EMBEDDER_ID,
  EmbeddingsError,
  type EmbeddingsService,
} from "../../services/openai-embeddings.js";
import type { ContainsState } from "./contains-state.js";
import type { SearchManifest } from "./manifest.js";
import type { RefreshState } from "./refresh-file.js";

/** A whole-card document whose `contains` vector is missing or stale. */
export interface PendingEmbed {
  /** Box-relative card path. */
  relPath: string;
  /** The whole-card doc id (`<relPath>#`). */
  docId: string;
  /** The `contains` text to embed. */
  text: string;
  /** Target `embeddedHash` once this text is embedded. */
  embeddedHash: string;
}

/** The hash folded into `embeddedHash`: the embedder identity plus the text. */
function embedHash(text: string): string {
  return contentHash(`${EMBEDDER_ID}\n${text}`);
}

/**
 * Every manifest entry whose whole-card doc needs a (re-)embed: not skipped,
 * with a non-empty sidecar `containsText`, whose whole-card doc id is actually
 * indexed, and whose recorded `embeddedHash` doesn't match the current
 * embedder + text. Pure — exported for doctests and reused to recompute
 * readiness after the pass.
 */
export function computePendingEmbeds({
  manifest,
  containsState,
}: {
  manifest: SearchManifest;
  containsState: ContainsState;
}): PendingEmbed[] {
  const pending: PendingEmbed[] = [];
  for (const [relPath, entry] of Object.entries(manifest.files)) {
    if (entry.skipped === true) continue;
    const cardState = containsState.cards[relPath];
    if (cardState === undefined) continue;
    const text = cardState.containsText;
    if (text === "") continue;
    const docId = `${relPath}#`;
    // The whole-card doc id isn't guaranteed to be docIds[0]; only embed when
    // it's actually one of the docs this card contributed.
    if (!entry.docIds.includes(docId)) continue;
    const target = embedHash(text);
    if (entry.embeddedHash === target) continue;
    pending.push({ relPath, docId, text, embeddedHash: target });
  }
  return pending;
}

export interface EmbedPassResult {
  /** A vector was added or changed — the caller must persist the index. */
  dirtyIndex: boolean;
  /** True when the pass ran and no pending embeds remain (hybrid-ready). */
  ready: boolean;
}

/**
 * Embed all pending `contains` texts in one batched call and re-insert each
 * whole-card doc with its vector, recording the new `embeddedHash`. On embed
 * failure, warn once and leave every `embeddedHash` unset so the same cards
 * re-pend next refresh; the text-side refresh persists regardless.
 *
 * Only called when a service is available, so `ready` is simply "no pending
 * embeds remain after this pass".
 */
export async function runEmbedPass(
  state: RefreshState,
  embeddings: EmbeddingsService
): Promise<EmbedPassResult> {
  const pending = computePendingEmbeds({
    manifest: state.manifest,
    containsState: state.containsState,
  });
  if (pending.length === 0) return { dirtyIndex: false, ready: true };

  let vectors: number[][];
  try {
    vectors = await embeddings.embed(pending.map((p) => p.text));
  } catch (e) {
    if (!(e instanceof EmbeddingsError)) throw e;
    state.warnings.push(
      `embeddings unavailable (${e.message}) — semantic ranking degraded; ` +
        "check config/connectors/openai.secret.json or CALLBACK_OPENAI_API_KEY"
    );
    return { dirtyIndex: false, ready: false };
  }
  invariant(
    vectors.length === pending.length,
    `embeddings returned ${String(vectors.length)} vectors for ${String(pending.length)} inputs`
  );

  let dirtyIndex = false;
  for (const [i, item] of pending.entries()) {
    const vector = vectors[i];
    invariant(vector !== undefined, `missing embedding vector at ${String(i)}`);
    const doc = getByID(state.db, item.docId);
    if (doc === undefined) {
      // Collection and re-insert run in one pass over the same in-memory db
      // under the search lock, so a missing doc here is a broken-invariant
      // shape — but one bad entry must not take down search, so warn and skip
      // rather than throw.
      state.warnings.push(`${item.relPath}: whole-card doc absent at embed time; skipped`);
      continue;
    }
    await remove(state.db, item.docId);
    await insert(state.db, { ...doc, embedding: vector });
    const entry = state.manifest.files[item.relPath];
    if (entry !== undefined) entry.embeddedHash = item.embeddedHash;
    dirtyIndex = true;
  }

  const remaining = computePendingEmbeds({
    manifest: state.manifest,
    containsState: state.containsState,
  });
  return { dirtyIndex, ready: remaining.length === 0 };
}
