/**
 * Composer attachment bindings for InteractiveChat: files picked, pasted,
 * dropped or captured into the composer. Images small enough to ride inline are
 * downscaled + base64-encoded client-side and drop an `[imageN]` token at the
 * textarea cursor (removal strips the matching token back out); everything else
 * goes to the bulk-upload batch — the split is decided by `file-routing.ts`,
 * never by which entry point the files came from.
 *
 * Everything else — any non-image, and photos over the inline limit — is
 * uploaded to the box's `tmp/` dir and anchored by a `[file#N]` token carrying
 * only its path, so it adds nothing to the send payload however large it is.
 * Its token goes in **immediately**, before the bytes have moved, so the user
 * can keep writing around it; the chip shows the upload's progress and the send
 * sites hold until nothing is in flight.
 *
 * A retry needs the original `File`, which is a DOM object the emission store
 * is forbidden to hold (see its serializable-boundary rule). The handles live
 * in a ref here instead, keyed by attachment id, and are dropped when the file
 * is removed or the composer resets.
 *
 * State itself lives in the emission store (`../../input/emission-store.ts`,
 * docs/implemented-plans/input-extraction.md chunk 2). `useChatAttachments`
 * (called at the `InteractiveChat` root) is a thin, NON-reactive binding —
 * action methods only, closing over `emissionStore.get()` for their
 * point-in-time reads. It deliberately does NOT subscribe to the store: like
 * composer text (components/chat/CLAUDE.md, "Composer input lives in a store,
 * not root state"), a root-level subscription here would re-render the whole
 * chat subtree — including the companion view pane — on every paste. The
 * reactive read lives in {@link useChatAttachmentValues}, called instead from
 * `ComposerRegion`, a leaf that isn't an ancestor of the companion pane.
 */

import { useRef, useCallback, useEffect, useSyncExternalStore } from "react";
import { processImageBlob, unsupportedImageMessage } from "../../lib/image-paste";
import { uploadChatFile } from "../../lib/file-upload";
import { errorMessage } from "@shared/error-guards";
import { useEmissionStore } from "./input-store";
import { toastError } from "../ui/toast-store";
import { routeAddedFiles } from "./file-routing";
import type { EmissionStore, ImageItem, FileItem } from "../../input/emission-store";
import { composerToken } from "@shared/composer-tokens";

/**
 * Insert a token string (`[imageN]` / `[fileN] `) at the textarea cursor, or
 * append when the textarea isn't focused, restoring the caret afterward.
 * `input` is the current composer text (snapshotted by the caller).
 */
export function insertTokensAtCursor(tokens: string, opts: {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  alwaysFocus: boolean;
}): void {
  const { input, setInput, textareaRef, alwaysFocus } = opts;
  const ta = textareaRef.current;
  const taFocused = ta !== null && document.activeElement === ta;
  if (!alwaysFocus && !(ta && taFocused)) {
    setInput((prev) => (prev ? prev + " " + tokens + " " : tokens + " "));
    return;
  }
  // `taFocused` is `ta !== null && ...`, so TS already narrows `ta` non-null
  // here; `HTMLTextAreaElement.selectionStart/End` (unlike the input-element
  // form, which can be null for some `type`s) are always numbers.
  const selStart = taFocused ? ta.selectionStart : input.length;
  const selEnd = taFocused ? ta.selectionEnd : selStart;
  const before = input.slice(0, selStart);
  const after = input.slice(selEnd);
  // Pad with a space before/after the tokens (when not already whitespace) so
  // they don't glue to adjacent words and the caret lands ready to keep typing.
  const padBefore = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const padAfter = after.length === 0 || !/^\s/.test(after) ? " " : "";
  setInput(before + padBefore + tokens + padAfter + after);
  const cursorAt = (before + padBefore + tokens + padAfter).length;
  requestAnimationFrame(() => {
    if (ta !== null && ta.isConnected) {
      ta.focus();
      ta.setSelectionRange(cursorAt, cursorAt);
    }
  });
}

/**
 * Reactive read of the attachment slices (images, pending-image count,
 * files). The ONLY subscribing consumer — call this from `ComposerRegion`
 * (or deeper), never from the `InteractiveChat` root; see the module doc.
 */
export function useChatAttachmentValues(): { attachments: ImageItem[]; pendingImageCount: number; fileAttachments: FileItem[] } {
  const emissionStore = useEmissionStore();
  // Third argument is useSyncExternalStore's optional server-snapshot getter;
  // passing the same getter keeps the store correct if it is ever read outside a
  // browser — same convention as useInputValue in input-store.ts.
  const getImages = () => emissionStore.get().images;
  const getPendingImages = () => emissionStore.get().pendingImages;
  const getFiles = () => emissionStore.get().files;
  const attachments = useSyncExternalStore(emissionStore.subscribe, getImages, getImages);
  const pendingImageCount = useSyncExternalStore(emissionStore.subscribe, getPendingImages, getPendingImages);
  const fileAttachments = useSyncExternalStore(emissionStore.subscribe, getFiles, getFiles);
  return { attachments, pendingImageCount, fileAttachments };
}

/**
 * Fills `ensureComposerVisibleRef` with the "make the composer text surface
 * visible" action: on the mobile button bar — which has no textarea and no
 * send button — a token insert would otherwise land in a hidden store with
 * no way to submit it, so it opens typing mode. On desktop the inline
 * textarea is always visible, and during dictation the mic row (whose send
 * sweeps pending attachments) is already on screen — both no-ops.
 *
 * A ref, assigned here and read by `useChatAttachments`, breaks the
 * attach → dispatch → voice ordering cycle (this needs `isTranscribing`,
 * which exists only after the voice hook runs) — same pattern as
 * `clearDraftRef`.
 */
export function useEnsureComposerVisible(opts: {
  ensureComposerVisibleRef: React.MutableRefObject<() => void>;
  isTranscribing: boolean;
  setTypingMode: (v: boolean) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}): void {
  const { ensureComposerVisibleRef, isTranscribing, setTypingMode, textareaRef } = opts;
  useEffect(() => {
    ensureComposerVisibleRef.current = () => {
      if (isTranscribing) return;
      const ta = textareaRef.current;
      if (ta !== null && ta.offsetParent !== null) return; // desktop composer is visible
      setTypingMode(true);
    };
  });
}

/**
 * What a set of files handed to {@link useChatAttachments}'s `addFiles` added
 * to the composer. Counts an uploading file as added — its token and chip are
 * already there, and the send waits for it — so a caller that toasts on
 * "nothing was attached" (the screenshot grab) doesn't misread a slow upload as
 * a failure.
 */
export interface AddFilesOutcome {
  added: number;
}

/** The composer's one file-ingest entry point, shared by picker, paste, drop and screenshot. */
export type AddFiles = (files: File[]) => Promise<AddFilesOutcome>;

export function useChatAttachments(opts: {
  emissionStore: EmissionStore;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Opens the mobile typing row when a token insert happens with no visible composer (see useEnsureComposerVisible). */
  ensureComposerVisibleRef: React.MutableRefObject<() => void>;
}) {
  const { emissionStore, textareaRef, ensureComposerVisibleRef } = opts;
  const { editor } = emissionStore;
  const fileInputRef = useRef<HTMLInputElement>(null);
  /**
   * The `File` behind each uploading attachment, for retry. Not in the emission
   * store: it is a DOM object, and the store is a serializable value by
   * contract. Entries are dropped on success, removal and reset, so this never
   * outlives the chips it backs.
   */
  const pendingUploadsRef = useRef(new Map<number, File>());
  /**
   * The in-flight upload for each file, so a send can wait on them. Settles
   * (never rejects) as each upload reaches `uploaded` or `failed` — the outcome
   * is read off the store, not off the promise.
   */
  const uploadsInFlightRef = useRef(new Map<number, Promise<void>>());

  /**
   * Downscale, encode and store the photo half of an inline selection,
   * returning the items that made it. Placeholder tiles go up immediately so
   * the gap between cmd-V and the thumbnail isn't a dead beat; each clears as
   * its image finishes.
   */
  const addInlinePhotos = useCallback(async (photos: File[]): Promise<ImageItem[]> => {
    if (photos.length === 0) return [];
    editor.bumpPendingImages(photos.length);
    // Process in parallel; a failure decrements its own pending slot
    // immediately (nothing was added), while a success's slot is cleared by
    // `addImage` itself once all results are in.
    const processed = await Promise.all(
      photos.map(async (f) => {
        try {
          return await processImageBlob(f);
        } catch (e) {
          console.error("[chat] Failed to process pasted image:", e);
          editor.bumpPendingImages(-1);
          return null;
        }
      })
    );
    const newItems: ImageItem[] = [];
    for (const p of processed) {
      if (!p) continue;
      const item: ImageItem = {
        id: editor.nextImageId(),
        mimeType: p.mimeType,
        dataBase64: p.dataBase64,
        objectUrl: p.objectUrl,
        byteLength: p.byteLength,
      };
      editor.addImage(item); // also decrements the pending count for this image
      newItems.push(item);
    }
    // Say so when an image didn't make it. The encoder rejects formats the
    // browser can't decode (a HEIC straight off a phone, some SVGs), and this
    // is the only path such a file has: a console-only log would let a picked
    // file vanish with no signal at all (code-style.md defensiveness rule 5).
    const failed = photos.filter((_f, i) => processed[i] === null);
    if (failed.length > 0) toastError(unsupportedImageMessage(failed));
    return newItems;
  }, [editor]);

  /**
   * Run one file's upload, moving its chip through `uploading` → `uploaded` or
   * `failed`. Never throws: the outcome is the chip's state, and a failure is
   * something the user retries or removes rather than something a caller
   * unwinds.
   */
  const runUpload = useCallback(async (id: number, file: File): Promise<void> => {
    try {
      const uploaded = await uploadChatFile(file, {
        onProgress: (fraction) => { editor.setFileState({ id, state: { status: "uploading", progress: fraction } }); },
      });
      pendingUploadsRef.current.delete(id);
      editor.setFileState({ id, state: { status: "uploaded", path: uploaded.path } });
    } catch (e) {
      // Keep the handle: retry needs it, and the chip offers exactly that.
      console.error("[chat] Failed to upload file:", e);
      editor.setFileState({ id, state: { status: "failed", message: errorMessage(e) } });
    }
  }, [editor]);

  /** Hold an upload's promise until it settles, so a send can wait on it. */
  const track = useCallback((id: number, running: Promise<void>): void => {
    const done = running.finally(() => {
      // Only clear the entry if it is still THIS run — a retry replaces it.
      if (uploadsInFlightRef.current.get(id) === done) uploadsInFlightRef.current.delete(id);
    });
    uploadsInFlightRef.current.set(id, done);
  }, []);

  /**
   * Resolve once no file upload is still running. `runUpload` never rejects, so
   * this settles on failures too — the caller inspects the store to see whether
   * everything actually landed.
   */
  const awaitPendingUploads = useCallback(async (): Promise<void> => {
    // A retry started while we wait registers a new promise, so loop until the
    // map is genuinely empty rather than snapshotting it once.
    while (uploadsInFlightRef.current.size > 0) {
      await Promise.all([...uploadsInFlightRef.current.values()]);
    }
  }, []);

  /**
   * Register the upload half of a selection and start it moving.
   *
   * The items (and their tokens) exist before a single byte goes up, so the
   * user can keep writing around an attachment that hasn't landed yet. Returns
   * as soon as they are registered — the uploads run on behind it, and the send
   * sites are what wait.
   */
  const addUploadFiles = useCallback((others: File[]): FileItem[] => {
    const items: FileItem[] = others.map((f) => ({
      id: editor.nextFileId(),
      originalName: f.name,
      size: f.size,
      mimetype: f.type === "" ? "application/octet-stream" : f.type,
      state: { status: "uploading", progress: 0 },
    }));
    for (const [i, item] of items.entries()) {
      const file = others[i];
      if (file === undefined) continue;
      pendingUploadsRef.current.set(item.id, file);
      editor.addFile(item);
      track(item.id, runUpload(item.id, file));
    }
    return items;
  }, [editor, runUpload, track]);

  /** Re-run a failed upload from the handle kept for it. */
  const retryFileUpload = useCallback((id: number) => {
    const file = pendingUploadsRef.current.get(id);
    if (file === undefined) {
      // The handle is gone only if the page reloaded under a restored draft,
      // and persistence never restores an unfinished file — so this is a state
      // that shouldn't arise rather than one to paper over.
      editor.setFileState({ id, state: { status: "failed", message: "This file can't be retried — remove it and pick it again." } });
      return;
    }
    editor.setFileState({ id, state: { status: "uploading", progress: 0 } });
    track(id, runUpload(id, file));
  }, [editor, runUpload, track]);

  const addFiles = useCallback(async (files: File[]): Promise<AddFilesOutcome> => {
    if (files.length === 0) return { added: 0 };
    // One routing rule for every entry point — picker, paste, drop, screenshot
    // — so how a file is represented depends on the file set, never on how it
    // arrived (`file-routing.ts`). Both halves land in THIS message.
    //
    // `pendingImages` counts toward the inline bound too: encoding is async, so
    // two fast pastes would otherwise both see zero finished images and both
    // inline.
    const draft = emissionStore.get();
    const routed = routeAddedFiles({
      files,
      existingInlinePhotos: draft.images.length + draft.pendingImages,
    });

    // Uploads first, and synchronously: their tokens and chips exist before any
    // bytes move, so the user can keep writing around a file that hasn't landed
    // yet. Waiting for the photo half to encode before showing them would hide
    // exactly the progress this is here to show.
    const fileItems = addUploadFiles(routed.upload);
    if (fileItems.length > 0) {
      const fileTokens = fileItems.map((f) => composerToken("file", f.id)).join(" ");
      // Always focus: a file selection comes from an explicit act (the Add menu,
      // a drop), so focus is on the menu button and the user is ready to keep
      // typing after the token.
      insertTokensAtCursor(fileTokens, { input: emissionStore.get().text, setInput: editor.setText, textareaRef, alwaysFocus: true });
      ensureComposerVisibleRef.current();
    }

    const imageItems = await addInlinePhotos(routed.inline);
    if (imageItems.length > 0) {
      const imageTokens = imageItems.map((a) => composerToken("image", a.id)).join(" ");
      // A paste must not steal focus, so this half never forces it.
      insertTokensAtCursor(imageTokens, { input: emissionStore.get().text, setInput: editor.setText, textareaRef, alwaysFocus: false });
      ensureComposerVisibleRef.current();
    }
    // Count what actually reached the composer — the screenshot path toasts on
    // 0 (a single-file capture that failed to encode).
    return { added: imageItems.length + fileItems.length };
  }, [editor, emissionStore, textareaRef, ensureComposerVisibleRef, addInlinePhotos, addUploadFiles]);

  const removeAttachment = useCallback((id: number) => {
    const target = emissionStore.get().images.find((a) => a.id === id);
    if (target) {
      try { URL.revokeObjectURL(target.objectUrl); } catch (_e) { /* already revoked — harmless */ }
    }
    // Strips the matching `[imageN]` token from the text too.
    editor.removeImage(id);
  }, [editor, emissionStore]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Clear the input before routing, so picking the same file twice in a row
    // still fires a change event.
    e.target.value = "";
    if (files.length === 0) return;
    void addFiles(files);
  }, [addFiles]);

  const removeFileAttachment = useCallback((id: number) => {
    // The upload may still be running; `setFileState` no-ops once the item is
    // gone, so a late result can't resurrect the chip. Dropping the handle here
    // is what keeps the map from outliving what it backs.
    pendingUploadsRef.current.delete(id);
    uploadsInFlightRef.current.delete(id);
    // Strips the matching `[fileN]` token from the text too.
    editor.removeFile(id);
  }, [editor]);

  /** The Add menu's one file entry — opens the hidden picker; routing decides the rest. */
  const handleAddFiles = useCallback(() => {
    const el = fileInputRef.current;
    if (el !== null) el.click();
  }, []);

  const resetAttachments = useCallback(() => {
    // Release the object URLs after send — the base64 payload is independent
    // of the object URL, so dropping them doesn't affect the message. The
    // store hands the URLs back rather than revoking them itself (DOM APIs
    // don't belong in the framework-free store).
    pendingUploadsRef.current.clear();
    uploadsInFlightRef.current.clear();
    const { removedImageObjectUrls } = editor.reset("attachments");
    for (const url of removedImageObjectUrls) {
      try { URL.revokeObjectURL(url); } catch (_e) { /* already revoked — harmless */ }
    }
  }, [editor]);

  return {
    fileInputRef,
    addFiles, removeAttachment, removeFileAttachment, retryFileUpload, awaitPendingUploads,
    handleAddFiles, handleFileInputChange, resetAttachments,
  };
}
