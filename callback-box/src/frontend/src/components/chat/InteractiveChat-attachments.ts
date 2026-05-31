/**
 * Composer attachment state + handlers for InteractiveChat: pasted/dropped
 * images (downscaled + base64-encoded client-side) and uploaded files (sent
 * to the box tmp/ dir). Each insert drops `[imageN]` / `[fileN]` tokens at
 * the textarea cursor; removal strips the matching tokens back out. Split
 * into its own hook so the component body stays readable.
 */

import { useState, useRef, useCallback } from "react";
import { processImageBlob } from "../../lib/image-paste";
import { uploadChatFile } from "../../lib/file-upload";
import { type AttachmentItem, type FileAttachmentItem } from "../ChatAttachments";

/**
 * Insert a token string (`[imageN]` / `[fileN] `) at the textarea cursor, or
 * append when the textarea isn't focused, restoring the caret afterward.
 * `input` is the current composer text (snapshotted by the caller).
 */
function insertTokensAtCursor(tokens: string, opts: {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  alwaysFocus: boolean;
}): void {
  const { input, setInput, textareaRef, alwaysFocus } = opts;
  const ta = textareaRef.current;
  const taFocused = ta !== null && document.activeElement === ta;
  if (!alwaysFocus && !(ta && taFocused)) {
    setInput((prev) => (prev ? prev + " " + tokens : tokens));
    return;
  }
  const selStart = taFocused && ta !== null && ta.selectionStart !== null ? ta.selectionStart : input.length;
  const selEnd = taFocused && ta !== null && ta.selectionEnd !== null ? ta.selectionEnd : selStart;
  const before = input.slice(0, selStart);
  const after = input.slice(selEnd);
  // Pad with a space before the tokens if needed so they don't glue to
  // the preceding word.
  const pad = before.length > 0 && !/\s$/.test(before) ? " " : "";
  setInput(before + pad + tokens + after);
  const cursorAt = (before + pad + tokens).length;
  requestAnimationFrame(() => {
    if (ta !== null && ta.isConnected) {
      ta.focus();
      ta.setSelectionRange(cursorAt, cursorAt);
    }
  });
}

export function useChatAttachments(opts: {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}) {
  const { input, setInput, textareaRef } = opts;
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const nextAttachmentIdRef = useRef(1);
  const [fileAttachments, setFileAttachments] = useState<FileAttachmentItem[]>([]);
  const nextFileAttachmentIdRef = useRef(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImageFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    // Process images in parallel; collect results in original order.
    const processed = await Promise.all(
      files.map(async (f) => {
        try {
          return await processImageBlob(f);
        } catch (e) {
          console.error("[chat] Failed to process pasted image:", e);
          return null;
        }
      })
    );
    const newItems: AttachmentItem[] = [];
    for (const p of processed) {
      if (!p) continue;
      newItems.push({
        id: nextAttachmentIdRef.current++,
        mimeType: p.mimeType,
        dataBase64: p.dataBase64,
        objectUrl: p.objectUrl,
        byteLength: p.byteLength,
      });
    }
    if (newItems.length === 0) return;
    setAttachments((prev) => [...prev, ...newItems]);
    const tokens = newItems.map((a) => `[image${a.id}]`).join(" ");
    insertTokensAtCursor(tokens, { input, setInput, textareaRef, alwaysFocus: false });
  }, [input, setInput, textareaRef]);

  const removeAttachment = useCallback((id: number) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) {
        try { URL.revokeObjectURL(target.objectUrl); } catch (_e) { /* already revoked — harmless */ }
      }
      return prev.filter((a) => a.id !== id);
    });
    // Strip any `[imageN]` tokens for this id from the input (plus up to one
    // leading/trailing whitespace char so we don't leave stray gaps).
    setInput((prev) =>
      prev
        .replace(/\s?\[image(\d+)]\s?/g, (match, n: string) =>
          parseInt(n, 10) === id ? " " : match
        )
        .replace(/ {2,}/g, " ")
    );
  }, [setInput]);

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
    const newItems: FileAttachmentItem[] = [];
    for (const u of uploaded) {
      if (!u) continue;
      newItems.push({
        id: nextFileAttachmentIdRef.current++,
        path: u.path,
        originalName: u.originalName,
        size: u.size,
        mimetype: u.mimetype,
      });
    }
    if (newItems.length === 0) return;
    setFileAttachments((prev) => [...prev, ...newItems]);
    // Always trail a space so the user can keep typing after the token, and
    // always focus the textarea — the upload is triggered from a menu, so
    // focus is on the menu button, not the composer.
    const tokens = newItems.map((f) => `[file${f.id}]`).join(" ") + " ";
    insertTokensAtCursor(tokens, { input, setInput, textareaRef, alwaysFocus: true });
  }, [input, setInput, textareaRef]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    void addFileUploads(files);
  }, [addFileUploads]);

  const removeFileAttachment = useCallback((id: number) => {
    setFileAttachments((prev) => prev.filter((f) => f.id !== id));
    setInput((prev) =>
      prev
        .replace(/\s?\[file(\d+)]\s?/g, (match, n: string) =>
          parseInt(n, 10) === id ? " " : match
        )
        .replace(/ {2,}/g, " ")
    );
  }, [setInput]);

  const handleAttachFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const resetAttachments = useCallback(() => {
    setAttachments((prev) => {
      // Release the object URLs after send — the base64 payload is independent
      // of the object URL, so dropping them doesn't affect the message.
      for (const a of prev) {
        try { URL.revokeObjectURL(a.objectUrl); } catch (_e) { /* already revoked — harmless */ }
      }
      return [];
    });
    nextAttachmentIdRef.current = 1;
    setFileAttachments([]);
    nextFileAttachmentIdRef.current = 1;
  }, []);

  return {
    attachments, fileAttachments, fileInputRef,
    addImageFiles, removeAttachment, addFileUploads, removeFileAttachment,
    handleAttachFiles, handleFileInputChange, resetAttachments,
  };
}
