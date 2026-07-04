/**
 * Composer attachment bindings for InteractiveChat: pasted/dropped images
 * (downscaled + base64-encoded client-side) and uploaded files (sent to the
 * box tmp/ dir). Each insert drops `[imageN]` / `[fileN]` tokens at the
 * textarea cursor; removal strips the matching tokens back out.
 *
 * State itself lives in the emission store (`../../input/emission-store.ts`,
 * docs/plans/input-extraction.md chunk 2) — this hook is a thin React
 * binding: it subscribes to the images/pendingImages/files slices via
 * `useSyncExternalStore` and calls `EmissionEditor` methods for every
 * mutation. DOM-bound caret handling (`insertTokensAtCursor`) has no place
 * in the framework-free store, so it stays here.
 */

import { useRef, useCallback, useSyncExternalStore } from "react";
import { processImageBlob } from "../../lib/image-paste";
import { uploadChatFile } from "../../lib/file-upload";
import type { EmissionStore, ImageItem, FileItem } from "../../input/emission-store";

/**
 * Insert a token string (`[imageN]` / `[fileN] `) at the textarea cursor, or
 * append when the textarea isn't focused, restoring the caret afterward.
 * `input` is the current composer text (snapshotted by the caller).
 */
export function insertTokensAtCursor(tokens: string, opts: {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  alwaysFocus: boolean;
}): void {
  const { input, setInput, textareaRef, alwaysFocus } = opts;
  const ta = textareaRef.current;
  const taFocused = ta !== null && document.activeElement === ta;
  if (!alwaysFocus && !(ta && taFocused)) {
    setInput((prev) => (prev ? prev + " " + tokens + " " : tokens + " "));
    return;
  }
  const selStart = taFocused && ta !== null && ta.selectionStart !== null ? ta.selectionStart : input.length;
  const selEnd = taFocused && ta !== null && ta.selectionEnd !== null ? ta.selectionEnd : selStart;
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

export function useChatAttachments(opts: {
  emissionStore: EmissionStore;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}) {
  const { emissionStore, textareaRef } = opts;
  const { editor } = emissionStore;
  // Third argument (server snapshot) is required for SSR (`cb render` goes
  // through renderToString) — same convention as useInputValue in input-store.ts.
  const getImages = () => emissionStore.get().images;
  const getPendingImages = () => emissionStore.get().pendingImages;
  const getFiles = () => emissionStore.get().files;
  const attachments = useSyncExternalStore(emissionStore.subscribe, getImages, getImages);
  const pendingImageCount = useSyncExternalStore(emissionStore.subscribe, getPendingImages, getPendingImages);
  const fileAttachments = useSyncExternalStore(emissionStore.subscribe, getFiles, getFiles);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImageFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
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
    if (newItems.length === 0) return;
    const tokens = newItems.map((a) => `[image${a.id}]`).join(" ");
    insertTokensAtCursor(tokens, { input: emissionStore.get().text, setInput: editor.setText, textareaRef, alwaysFocus: false });
  }, [editor, emissionStore, textareaRef]);

  const removeAttachment = useCallback((id: number) => {
    const target = emissionStore.get().images.find((a) => a.id === id);
    if (target) {
      try { URL.revokeObjectURL(target.objectUrl); } catch (_e) { /* already revoked — harmless */ }
    }
    // Strips the matching `[imageN]` token from the text too.
    editor.removeImage(id);
  }, [editor, emissionStore]);

  const addFileUploads = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const uploaded = await Promise.all(
      files.map(async (f) => {
        try {
          return await uploadChatFile(f);
        } catch (e) {
          console.error("[chat] Failed to upload file:", e);
          return null;
        }
      })
    );
    const newItems: FileItem[] = [];
    for (const u of uploaded) {
      if (!u) continue;
      const item: FileItem = {
        id: editor.nextFileId(),
        path: u.path,
        originalName: u.originalName,
        size: u.size,
        mimetype: u.mimetype,
      };
      editor.addFile(item);
      newItems.push(item);
    }
    if (newItems.length === 0) return;
    // Always focus the textarea — the upload is triggered from a menu, so
    // focus is on the menu button, not the composer. The helper pads a
    // trailing space so the user can keep typing after the token.
    const tokens = newItems.map((f) => `[file${f.id}]`).join(" ");
    insertTokensAtCursor(tokens, { input: emissionStore.get().text, setInput: editor.setText, textareaRef, alwaysFocus: true });
  }, [editor, emissionStore, textareaRef]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    void addFileUploads(files);
  }, [addFileUploads]);

  const removeFileAttachment = useCallback((id: number) => {
    // Strips the matching `[fileN]` token from the text too.
    editor.removeFile(id);
  }, [editor]);

  const handleAttachFiles = useCallback(() => {
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
    attachments, pendingImageCount, fileAttachments, fileInputRef,
    addImageFiles, removeAttachment, addFileUploads, removeFileAttachment,
    handleAttachFiles, handleFileInputChange, resetAttachments,
  };
}
