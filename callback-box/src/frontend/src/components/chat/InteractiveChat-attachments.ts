/**
 * Composer attachment bindings for InteractiveChat: files picked, pasted,
 * dropped or captured into the composer. Images small enough to ride inline are
 * downscaled + base64-encoded client-side and drop an `[imageN]` token at the
 * textarea cursor (removal strips the matching token back out); everything else
 * goes to the bulk-upload batch — the split is decided by `file-routing.ts`,
 * never by which entry point the files came from.
 *
 * `[fileN]` attachments (a server-side `tmp/` upload referenced by token) are
 * still carried by the emission format and restored from a persisted draft, but
 * nothing in this web composer creates them any more: the Add menu's old
 * "Attach file…" path was the only producer, and it now routes here
 * (`issues/features/2026-08-03-attach-vs-upload-menu-confusing.md`). The native
 * iOS composer still uploads and sends them.
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
import { processImageBlob } from "../../lib/image-paste";
import { useEmissionStore } from "./input-store";
import { toastError } from "../ui/toast-store";
import { routeAddedFiles } from "./file-routing";
import type { EmissionStore, ImageItem, FileItem } from "../../input/emission-store";

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
 * What became of a set of files handed to {@link useChatAttachments}'s
 * `addFiles`. The route is reported rather than folded into a count because a
 * batched set adds nothing inline — a caller that toasts on "nothing was
 * attached" (the screenshot grab) must not read a successful hand-off to the
 * bulk-upload overlay as a failure.
 */
export type AddFilesOutcome =
  | { route: "batch" }
  /** `added` counts the images that actually finished; a processing failure adds none. */
  | { route: "inline"; added: number };

/** The composer's one file-ingest entry point, shared by picker, paste, drop and screenshot. */
export type AddFiles = (files: File[]) => Promise<AddFilesOutcome>;

export function useChatAttachments(opts: {
  emissionStore: EmissionStore;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Opens the mobile typing row when a token insert happens with no visible composer (see useEnsureComposerVisible). */
  ensureComposerVisibleRef: React.MutableRefObject<() => void>;
  /**
   * Hand a file set to the bulk-upload path instead of inlining it (see
   * `file-routing.ts`). `foldInComposerImages` asks the caller to sweep the
   * composer's existing inline photos into the same batch, so one selection act
   * doesn't end up split across two destinations.
   */
  onBatchFiles: (opts: { files: File[]; foldInComposerImages: boolean }) => void;
}) {
  const { emissionStore, textareaRef, ensureComposerVisibleRef, onBatchFiles } = opts;
  const { editor } = emissionStore;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (files: File[]): Promise<AddFilesOutcome> => {
    if (files.length === 0) return { route: "inline", added: 0 };
    // One routing rule for every entry point — picker, paste, drop, screenshot
    // — so where a file lands depends on the file set, never on how it arrived
    // (`file-routing.ts`). Non-images have no in-message representation, and a
    // photo set too big to ride inline gets uploaded rather than base64-ing a
    // camera roll into one /chat/send that can't be sent.
    //
    // `pendingImages` counts too: encoding is async, so two fast pastes would
    // otherwise both see zero finished images and both inline.
    const draft = emissionStore.get();
    if (routeAddedFiles({
      files,
      existingInline: draft.images.length + draft.pendingImages,
    }) === "batch") {
      // Hand over the photos ALREADY in the composer as well. Batching only the
      // new ones would split one intended message in two: the batch would carry
      // the whole composer text as its introduction while the older photos sat
      // behind in the composer with nothing describing them, and the agent would
      // be told about photos it hadn't been given. One selection act, one
      // destination.
      // Fold in the finished images — the ones we actually have bytes for.
      //
      // Photos still ENCODING cannot be folded (there are no bytes yet) and are
      // deliberately NOT dropped: they finish and land inline, going out with the
      // next ordinary send. That leaves a narrow race where one act produces a
      // batch plus a few inline photos, which is a worse *presentation* than
      // "one destination" — but discarding them to tidy that up would silently
      // destroy photos the user picked, and never losing anything outranks
      // arriving in one piece. The inline bound still holds: those photos were
      // already counted above.
      onBatchFiles({ files, foldInComposerImages: draft.images.length > 0 });
      return { route: "batch" };
    }
    // Show placeholder tiles immediately; each clears as its image finishes
    // encoding, so the gap between cmd-V and the thumbnail isn't a dead beat.
    editor.bumpPendingImages(files.length);
    // Process images in parallel; a failure decrements its own pending slot
    // immediately (nothing was added), while a success's slot is cleared by
    // `addImage` itself once all results are in.
    const processed = await Promise.all(
      files.map(async (f) => {
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
    // browser can't decode (a HEIC straight off a phone, some SVGs), and with
    // the old explicit attach path gone this is the only path such a file has:
    // a console-only log would let a picked file vanish with no signal at all
    // (code-style.md defensiveness rule 5).
    const failed = files.length - newItems.length;
    if (failed > 0) {
      toastError(failed === files.length
        ? "Those files couldn't be added to the message"
        : `${String(failed)} of ${String(files.length)} files couldn't be added to the message`);
    }
    if (newItems.length === 0) return { route: "inline", added: 0 };
    const tokens = newItems.map((a) => `[image${a.id}]`).join(" ");
    insertTokensAtCursor(tokens, { input: emissionStore.get().text, setInput: editor.setText, textareaRef, alwaysFocus: false });
    ensureComposerVisibleRef.current();
    // Count actually added — the screenshot path toasts when an inline route
    // adds 0 (a single-file capture that failed processing).
    return { route: "inline", added: newItems.length };
  }, [editor, emissionStore, textareaRef, ensureComposerVisibleRef, onBatchFiles]);

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
    const { removedImageObjectUrls } = editor.reset("attachments");
    for (const url of removedImageObjectUrls) {
      try { URL.revokeObjectURL(url); } catch (_e) { /* already revoked — harmless */ }
    }
  }, [editor]);

  return {
    fileInputRef,
    addFiles, removeAttachment, removeFileAttachment,
    handleAddFiles, handleFileInputChange, resetAttachments,
  };
}
