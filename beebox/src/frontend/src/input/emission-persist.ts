/**
 * Whole-emission persistence, singleton-keyed
 * (docs/implemented-plans/input-extraction.md, chunk 4).
 *
 * The composition survives reloads AND session switches under ONE key per
 * box (`bbx-input-emission:<box>`) — the input is the person's instrument,
 * not a per-conversation buffer (the design's singleton-draft decision, a
 * deliberate departure from messaging-app convention). Replaces the
 * per-session text-only `bbx-composer-draft:<box>:<session>` keys; the
 * one-shot migration adopts the most-recently-updated legacy draft and
 * removes that box's old keys (others are discarded, not merged — a NAMED
 * behavior change).
 *
 * Every storage access is guarded (quota, private-mode SecurityError —
 * persistence is a convenience, never a failure source; pattern:
 * lib/location-share.ts saveLocationShareState). Framework-free; takes a
 * minimal Storage so doctests use a Map-backed fake.
 *
 * Images are size-gated: base64 payloads persist only while the total
 * serialized size stays under PERSIST_BYTE_BUDGET — text, files, and
 * selections always fit and always persist. Restored file attachments
 * point at `tmp/…` uploads that housekeeping sweeps after 7 days; the
 * pure `partitionFiles` supports the restore-time validation the React
 * layer performs (drop dead ones with a visible note).
 */

import { uploadedPath } from "./emission-store";
import type { EmissionDraft, ImageItem, FileItem } from "./emission-store";
import type { SelectionItem } from "../lib/selection/serialize";
// Raw relative (not `@shared/…`): loaded outside Vite by the tap/tsx doctest
// runner (root tsconfig, no @shared resolution) — see OUTSIDE_VITE_SHARED_RAW.
import { isRecord } from "../../../shared/is-record.js";

/** The subset of Storage this module touches (fakeable in doctests). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export interface PersistedEmission {
  version: 1;
  text: string;
  images: ImageItem[];
  files: FileItem[];
  selections: SelectionItem[];
  updatedAt: number;
}

/** Above this serialized size, images are dropped from persistence (kept in memory). */
export const PERSIST_BYTE_BUDGET = 512 * 1024;

const KEY_PREFIX = "bbx-input-emission";
// Kept as a single migration literal: old installations wrote this prefix;
// the new singleton key above is always written with the bbx prefix.
const LEGACY_COMPOSER_PREFIX = "bbx-composer-draft";

export function emissionKey(boxSlug: string | undefined): string {
  return `${KEY_PREFIX}:${boxSlug ?? "default"}`;
}

function warn(what: string, e: unknown): void {
  console.warn(`[input-persist] ${what}: ${e instanceof Error ? e.message : String(e)}`);
}

/**
 * Serialize a draft for persistence. Images are included only when the
 * full payload fits the byte budget; otherwise they're dropped (the
 * emission keeps them in memory — reload is the only loss, matching the
 * design's best-effort stance on blobs).
 */
export function serializePersistedEmission(
  draft: Pick<EmissionDraft, "text" | "images" | "files" | "selections">,
  opts: { updatedAt: number },
): { payload: string; imagesDropped: boolean } {
  const full: PersistedEmission = {
    version: 1,
    text: draft.text,
    images: [...draft.images],
    // Unfinished uploads are persisted too, even though they can never be
    // resumed (the `File` handle dies with the page). Filtering them out here
    // would leave their `[file#N]` tokens in the saved TEXT with no entry to
    // explain them: no chip, no expired-attachment note, and an id
    // `reserveIds` never covers — so the next attachment could mint that id and
    // adopt the orphan token. Keeping them lets `partitionFiles` find them
    // pathless, class them dead, and strip their tokens on the way back in.
    files: [...draft.files],
    selections: [...draft.selections],
    updatedAt: opts.updatedAt,
  };
  let payload = JSON.stringify(full);
  if (payload.length <= PERSIST_BYTE_BUDGET || draft.images.length === 0) {
    return { payload, imagesDropped: false };
  }
  payload = JSON.stringify({ ...full, images: [] });
  return { payload, imagesDropped: true };
}

function isPersistedEmission(value: unknown): value is PersistedEmission {
  if (!isRecord(value)) return false;
  const v = value;
  return (
    v["version"] === 1 &&
    typeof v["text"] === "string" &&
    Array.isArray(v["images"]) &&
    Array.isArray(v["files"]) &&
    Array.isArray(v["selections"]) &&
    typeof v["updatedAt"] === "number"
  );
}

export function parsePersistedEmission(raw: string | null): PersistedEmission | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPersistedEmission(parsed) ? parsed : null;
  } catch (_e) {
    // Corrupt persisted draft — treated as absent; the composer starts empty.
    return null;
  }
}

export function loadPersistedEmission(
  storage: KeyValueStorage,
  boxSlug: string | undefined,
): PersistedEmission | null {
  try {
    return parsePersistedEmission(storage.getItem(emissionKey(boxSlug)));
  } catch (e) {
    warn("could not read persisted emission", e);
    return null;
  }
}

export function savePersistedEmission(
  storage: KeyValueStorage,
  input: {
    boxSlug: string | undefined;
    draft: Pick<EmissionDraft, "text" | "images" | "files" | "selections">;
    updatedAt: number;
  },
): void {
  const { payload, imagesDropped } = serializePersistedEmission(input.draft, {
    updatedAt: input.updatedAt,
  });
  if (imagesDropped) {
    console.warn("[input-persist] images exceed the persistence budget — kept in memory only");
  }
  try {
    storage.setItem(emissionKey(input.boxSlug), payload);
  } catch (e) {
    warn("could not persist emission", e);
  }
}

/** True when a draft holds nothing worth persisting or recovering. */
export function isEmptyEmissionDraft(
  draft: Pick<EmissionDraft, "text" | "images" | "files" | "selections">,
): boolean {
  return draft.text === "" && draft.images.length === 0 && draft.files.length === 0 && draft.selections.length === 0;
}

/**
 * The persist decision for a whole draft: an EMPTY draft removes the key,
 * anything else saves.
 *
 * "Empty" is what a send leaves behind (the send sites clear text,
 * attachments, and selections), so this is the definitive
 * nothing-to-recover event — and the caller runs it synchronously rather
 * than on the debounce. Saving an empty payload instead would be nearly
 * equivalent on restore, but it leaves the key sitting there, and the
 * recovery bug this fixes was diagnosed by looking for exactly that key
 * (issues/bugs/2026-07-23-voice-send-lingers-as-unsent-recovery-draft.md):
 * gone means gone.
 */
export function commitPersistedEmission(
  storage: KeyValueStorage,
  input: {
    boxSlug: string | undefined;
    draft: Pick<EmissionDraft, "text" | "images" | "files" | "selections">;
    updatedAt: number;
  },
): void {
  if (isEmptyEmissionDraft(input.draft)) {
    removePersistedEmission(storage, input.boxSlug);
    return;
  }
  savePersistedEmission(storage, input);
}

function removePersistedEmission(storage: KeyValueStorage, boxSlug: string | undefined): void {
  try {
    storage.removeItem(emissionKey(boxSlug));
  } catch (e) {
    warn("could not remove persisted emission", e);
  }
}

/**
 * One-shot adoption of the legacy per-session composer drafts
 * (`bbx-composer-draft:<box>:<session>`, shape `{text, updatedAt}`): the
 * most-recently-updated non-empty draft for this box becomes the seed
 * text; ALL of the box's legacy keys are removed. Returns the adopted
 * text (or null) plus how many drafts were discarded — the caller logs
 * the named behavior change.
 */
export function adoptLegacyComposerDrafts(
  storage: KeyValueStorage,
  boxSlug: string | undefined,
): { adoptedText: string | null; discarded: number } {
  const prefix = `${LEGACY_COMPOSER_PREFIX}:${boxSlug ?? "default"}:`;
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(prefix)) keys.push(key);
    }
  } catch (e) {
    warn("could not enumerate legacy drafts", e);
    return { adoptedText: null, discarded: 0 };
  }

  let best: { text: string; updatedAt: number } | null = null;
  let nonEmpty = 0;
  for (const key of keys) {
    try {
      const parsed: unknown = JSON.parse(storage.getItem(key) ?? "null");
      if (!isRecord(parsed)) continue;
      const draft = parsed;
      const text = typeof draft["text"] === "string" ? draft["text"] : "";
      const updatedAt = typeof draft["updatedAt"] === "number" ? draft["updatedAt"] : 0;
      if (text.trim() === "") continue;
      nonEmpty++;
      if (best === null || updatedAt > best.updatedAt) best = { text, updatedAt };
    } catch (_e) {
      // Unparseable legacy draft — nothing to adopt from it.
    }
  }
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch (e) {
      warn(`could not remove legacy draft ${key}`, e);
    }
  }
  return {
    adoptedText: best === null ? null : best.text,
    discarded: best === null ? nonEmpty : nonEmpty - 1,
  };
}

/**
 * Split restored file attachments into live and dead, given the set of
 * paths that still exist (the React layer checks existence — `tmp/…`
 * uploads are swept by housekeeping after 7 days). Dead ones are dropped
 * with a visible note, never silently restored.
 */
export function partitionFiles(
  files: readonly FileItem[],
  existingPaths: ReadonlySet<string>,
): { live: FileItem[]; dead: FileItem[] } {
  const live: FileItem[] = [];
  const dead: FileItem[] = [];
  for (const f of files) {
    // A file that never finished uploading has no path to check and no way to
    // resume — the `File` handle it would need died with the page. It is dead
    // on restore, and reported as such rather than silently dropped.
    const path = uploadedPath(f);
    (path !== null && existingPaths.has(path) ? live : dead).push(f);
  }
  return { live, dead };
}
