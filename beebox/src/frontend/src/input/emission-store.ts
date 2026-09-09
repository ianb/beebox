/**
 * The emission draft store — one mutation surface for everything the
 * composer accumulates before send (docs/implemented-plans/input-extraction.md,
 * chunk 2; design in docs/plans/input-widget.md's `EmissionEditor`).
 *
 * Replaces three scattered homes for composition state: `input-store.ts`
 * (text only), `useChatAttachments` (images/files, InteractiveChat-attachments.ts),
 * and `useChatSelections` (InteractiveChat-selections.ts). All five slices —
 * text, images, pendingImages, files, selections — now live in one external
 * store; `EmissionEditor` methods are the only writers. React bindings
 * (`useChatAttachments`/`useChatSelections`, and the `input-store.ts` text
 * adapter) subscribe with `useSyncExternalStore` against a slice of
 * `get()`'s return value.
 *
 * Serializable-boundary rule (the `input/` directory carries it): no React
 * or DOM types in this module. Object URLs are opaque strings here — the
 * store never calls `URL.revokeObjectURL`; callers do that with the values
 * `reset()` returns.
 *
 * One subscribe channel for everything (text changes and slice changes
 * notify the same listeners) — the simplest correct thing. A subscriber
 * that only cares about one slice reads that slice via `get()` in its
 * `useSyncExternalStore` snapshot function; because every mutation here
 * replaces only the fields it touches (unrelated fields keep their prior
 * object/array reference), an unrelated notification yields the same
 * reference for that slice and React bails out of re-rendering — the
 * mechanism the composer-text keystroke-isolation invariant
 * (components/chat/CLAUDE.md) depends on.
 */

import type { SelectionItem } from "../lib/selection/serialize";
import type { ComposerTokenKind } from "@shared/composer-tokens";

/** An image attachment as the store carries it (today: `AttachmentItem`). */
export interface ImageItem {
  id: number;
  mimeType: string;
  /** base64 payload (no data: prefix). */
  dataBase64: string;
  /** Object URL for thumbnail/lightbox preview; revoked by the caller on removal. */
  objectUrl: string;
  /** Approximate byte size of the encoded image. */
  byteLength: number;
}

/**
 * Where a file attachment is in its trip to the box.
 *
 * A file's token goes into the text the moment it is picked, so the user can
 * keep writing around it while the bytes are still moving — which means the
 * composer holds files that have no path yet, and some that never will. The
 * path exists only in `uploaded`, so a caller cannot read one off a file that
 * hasn't got there. Mirrors the native composer's `DraftTransferState`
 * (`ios-app/BeeBox/Models/ComposerDraft.swift`).
 */
export type FileTransferState =
  | { status: "uploading"; /** 0–1, or 0 while the total is unknown. */ progress: number }
  | { status: "uploaded"; /** Path relative to box root, e.g. "tmp/2026-04-27T15-30-12-987Z_report.pdf". */ path: string }
  | { status: "failed"; message: string };

/**
 * The box-relative path a file landed at, or `null` while it is still moving or
 * has failed. The one way to read a path off a {@link FileItem} — everything
 * that needs a path (the send payload, draft persistence) is by definition only
 * interested in files that finished.
 */
export function uploadedPath(file: FileItem): string | null {
  return file.state.status === "uploaded" ? file.state.path : null;
}

/** A non-image file attachment (today: `FileAttachmentItem`). */
export interface FileItem {
  id: number;
  originalName: string;
  size: number;
  mimetype: string;
  state: FileTransferState;
}

/**
 * The whole composition state, as a snapshot value. Array fields are typed
 * mutable (not `readonly T[]`) so they interoperate directly with the
 * existing `AttachmentItem[]`/`FileAttachmentItem[]`/`SelectionItem[]` prop
 * types the composer UI already expects; the store never hands out an array
 * it still intends to mutate in place — every write replaces the reference.
 */
export interface EmissionDraft {
  readonly text: string;
  readonly images: ImageItem[];
  /** Images pasted/dropped but still downscaling+encoding. */
  readonly pendingImages: number;
  readonly files: FileItem[];
  readonly selections: SelectionItem[];
}

/** What `reset()` hands back so the caller can release resources the store never touches. */
export interface ResetResult {
  /** Object URLs of images removed by an "attachments" reset — revoke these. */
  removedImageObjectUrls: string[];
}

type ResetKind = "attachments" | "selections";

/** The one mutation surface for the emission draft. Every writer goes through here. */
export interface EmissionEditor {
  /** Sets the composer text. Accepts a value or an updater, like React's setter. No-op (no notify) on an equal value. */
  setText(next: string | ((prev: string) => string)): void;
  /** Adjusts the in-flight-image counter by `delta`, floored at 0. */
  bumpPendingImages(delta: number): void;
  /** Appends an image and decrements `pendingImages` by 1 (floor 0) — the image this pending slot was for has now landed. */
  addImage(item: ImageItem): void;
  /**
   * Puts images BACK that were taken out of a composition — a bulk batch the
   * user cancelled, a persisted draft coming home. Appends without touching
   * `pendingImages`, which is what separates it from {@link addImage}: that
   * counter tracks photos still encoding, and each `addImage` clears the slot
   * its own photo was occupying. A restore has no slot to clear, so routing it
   * through `addImage` would decrement the counter for encodes that are still
   * in flight and make their placeholder tiles disappear.
   *
   * Ids are reused as-is (they are monotonic and never re-minted), so the
   * tokens already in the restored text keep matching.
   */
  restoreImages(items: readonly ImageItem[]): void;
  addFile(item: FileItem): void;
  /**
   * Advance a file's transfer state (progress, the path it landed at, or a
   * failure). No-op for an id that is no longer in the draft — a user may
   * remove a chip while its upload is in flight, and the late result must not
   * resurrect it.
   */
  setFileState(opts: { id: number; state: FileTransferState }): void;
  addSelection(item: SelectionItem): void;
  /** Removes the image and strips its `[imageN]` token (plus a bounding whitespace char) from the text. */
  removeImage(id: number): void;
  /** Removes the file and strips its `[fileN]` token from the text. */
  removeFile(id: number): void;
  /** Removes the selection and strips its `[selectionN]` token from the text. */
  removeSelection(id: number): void;
  /** Mints the next image id (monotonic; not reused after removal). */
  nextImageId(): number;
  /** Mints the next file id (monotonic; not reused after removal). */
  nextFileId(): number;
  /** Mints the next selection id (monotonic; not reused after removal). */
  nextSelectionId(): number;
  /**
   * Advances the id counters past ids already in use by items added
   * directly with a caller-supplied id (restoring a persisted emission
   * reuses its ids so they keep matching the `[imageN]`/`[fileN]`/
   * `[selectionN]` tokens already in the restored text) — without this, a
   * later `nextImageId()` could re-mint an id a restored item already
   * holds. No-op for a slice whose `id` is below the current counter.
   */
  reserveIds(ids: { image?: number; file?: number; selection?: number }): void;
  /**
   * Clears a slice post-send: "attachments" clears images+files, their id
   * counters, and pendingImages (matching today's `resetAttachments`);
   * "selections" clears selections and its id counter (today's
   * `resetSelections`). Text is untouched either way — the send site clears
   * it itself. Returns the removed images' object URLs for the caller to revoke.
   */
  reset(kind: ResetKind): ResetResult;
}

/** A framework-free external store holding one `EmissionDraft`. */
export interface EmissionStore {
  get(): EmissionDraft;
  subscribe(listener: () => void): () => void;
  readonly editor: EmissionEditor;
}

const NO_REMOVALS: ResetResult = { removedImageObjectUrls: [] };

// Each token plus a bounding whitespace char on each side. `#?` matches the
// pre-2026-08-25 form too — see shared/composer-tokens.ts.
const TOKEN_PATTERNS: Record<ComposerTokenKind, RegExp> = {
  image: /\s?\[image#?(\d+)]\s?/g,
  file: /\s?\[file#?(\d+)]\s?/g,
  selection: /\s?\[selection#?(\d+)]\s?/g,
};

function stripToken(text: string, opts: { word: ComposerTokenKind; id: number }): string {
  const { word, id } = opts;
  return text
    .replace(TOKEN_PATTERNS[word], (match, digits: string) => (parseInt(digits, 10) === id ? " " : match))
    .replace(/ {2,}/g, " ");
}

export function createEmissionStore(): EmissionStore {
  let draft: EmissionDraft = { text: "", images: [], pendingImages: 0, files: [], selections: [] };
  let nextImageIdValue = 1;
  let nextFileIdValue = 1;
  let nextSelectionIdValue = 1;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function patch(next: Partial<EmissionDraft>): void {
    draft = { ...draft, ...next };
    notify();
  }

  const editor: EmissionEditor = {
    setText(next) {
      const resolved = typeof next === "function" ? next(draft.text) : next;
      if (resolved === draft.text) return;
      patch({ text: resolved });
    },
    bumpPendingImages(delta) {
      patch({ pendingImages: Math.max(0, draft.pendingImages + delta) });
    },
    addImage(item) {
      patch({
        images: [...draft.images, item],
        pendingImages: Math.max(0, draft.pendingImages - 1),
      });
    },
    restoreImages(items) {
      if (items.length === 0) return;
      patch({ images: [...draft.images, ...items] });
    },
    addFile(item) {
      patch({ files: [...draft.files, item] });
    },
    setFileState({ id, state }) {
      if (!draft.files.some((file) => file.id === id)) return;
      patch({ files: draft.files.map((file) => (file.id === id ? { ...file, state } : file)) });
    },
    addSelection(item) {
      patch({ selections: [...draft.selections, item] });
    },
    removeImage(id) {
      patch({
        images: draft.images.filter((image) => image.id !== id),
        text: stripToken(draft.text, { word: "image", id }),
      });
    },
    removeFile(id) {
      patch({
        files: draft.files.filter((file) => file.id !== id),
        text: stripToken(draft.text, { word: "file", id }),
      });
    },
    removeSelection(id) {
      patch({
        selections: draft.selections.filter((selection) => selection.id !== id),
        text: stripToken(draft.text, { word: "selection", id }),
      });
    },
    nextImageId() {
      return nextImageIdValue++;
    },
    nextFileId() {
      return nextFileIdValue++;
    },
    nextSelectionId() {
      return nextSelectionIdValue++;
    },
    reserveIds(ids) {
      if (ids.image !== undefined) nextImageIdValue = Math.max(nextImageIdValue, ids.image + 1);
      if (ids.file !== undefined) nextFileIdValue = Math.max(nextFileIdValue, ids.file + 1);
      if (ids.selection !== undefined) nextSelectionIdValue = Math.max(nextSelectionIdValue, ids.selection + 1);
    },
    reset(kind) {
      if (kind === "selections") {
        nextSelectionIdValue = 1;
        patch({ selections: [] });
        return NO_REMOVALS;
      }
      const removedImageObjectUrls = draft.images.map((image) => image.objectUrl);
      nextImageIdValue = 1;
      nextFileIdValue = 1;
      patch({ images: [], files: [], pendingImages: 0 });
      return { removedImageObjectUrls };
    },
  };

  return {
    get: () => draft,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    editor,
  };
}
