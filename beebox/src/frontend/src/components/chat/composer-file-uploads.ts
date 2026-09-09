/**
 * The composer's file-upload lifecycle: start an upload, track it, retry it,
 * and let a send wait for it.
 *
 * Split out of `InteractiveChat-attachments.ts` because it owns state that has
 * to live *outside* the emission store. A retry needs the original `File`, and
 * a send needs the in-flight promise — both are DOM/runtime objects, and the
 * store is a serializable value by contract (see `input/emission-store.ts`, the
 * serializable-boundary rule). So the store carries only each file's
 * {@link FileTransferState}, and the un-serializable half lives here in refs.
 *
 * The chip a file gets is written the moment it is picked, before any bytes
 * move, so the user can keep writing around an attachment that hasn't landed —
 * which is what makes the identity check in `runUpload` necessary.
 */

import { useCallback, useRef } from "react";
import { uploadChatFile } from "../../lib/file-upload";
import { errorMessage } from "@shared/error-guards";
import type { EmissionStore, FileItem } from "../../input/emission-store";

export interface ComposerFileUploads {
  /** Register a picked set, start their uploads, and return the items created. */
  addUploadFiles: (files: File[]) => FileItem[];
  /** Re-run a failed upload from the handle kept for it. */
  retryFileUpload: (id: number) => void;
  /** Resolves once no upload is still running. Never rejects. */
  awaitPendingUploads: () => Promise<void>;
  /** Drop one file's handles — its chip was removed. */
  forget: (id: number) => void;
  /** Drop every handle — the composer reset. */
  forgetAll: () => void;
}

export function useComposerFileUploads(editor: EmissionStore["editor"]): ComposerFileUploads {
  /**
   * The `File` behind each attachment, for retry — and the identity an upload
   * result is checked against. Entries are dropped on success, removal and
   * reset, so this never outlives the chips it backs.
   */
  const pendingUploadsRef = useRef(new Map<number, File>());
  /**
   * The in-flight upload for each file, so a send can wait on them. Settles
   * (never rejects) as each upload reaches `uploaded` or `failed` — the outcome
   * is read off the store, not off the promise.
   */
  const uploadsInFlightRef = useRef(new Map<number, Promise<void>>());

  const runUpload = useCallback(async (id: number, file: File): Promise<void> => {
    // An id is not a durable address: `reset("attachments")` restarts the
    // counter at 1, so after a send the next attachment can be minted with an
    // id a still-running upload holds — and removing a chip doesn't cancel its
    // transfer. Without this check that result lands on whoever owns the id
    // now, stamping a stranger's chip `uploaded` with this file's path: the
    // wrong file under the right name, throwing nothing. The handle map is the
    // identity — deleted on removal, cleared on reset, different `File` on a
    // re-minted id.
    const stillOurs = () => pendingUploadsRef.current.get(id) === file;
    try {
      const uploaded = await uploadChatFile(file, {
        onProgress: (fraction) => {
          if (!stillOurs()) return;
          editor.setFileState({ id, state: { status: "uploading", progress: fraction } });
        },
      });
      if (!stillOurs()) return;
      pendingUploadsRef.current.delete(id);
      editor.setFileState({ id, state: { status: "uploaded", path: uploaded.path } });
    } catch (e) {
      console.error("[chat] Failed to upload file:", e);
      // Keep the handle: retry needs it, and the chip offers exactly that.
      if (!stillOurs()) return;
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

  const awaitPendingUploads = useCallback(async (): Promise<void> => {
    // A retry started while we wait registers a new promise, so loop until the
    // map is genuinely empty rather than snapshotting it once.
    while (uploadsInFlightRef.current.size > 0) {
      await Promise.all([...uploadsInFlightRef.current.values()]);
    }
  }, []);

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

  const retryFileUpload = useCallback((id: number) => {
    const file = pendingUploadsRef.current.get(id);
    if (file === undefined) {
      // The handle is gone only if the page reloaded under a restored draft,
      // and restore drops every unfinished file (it has no path, so
      // `partitionFiles` classes it dead) — so this is a state that shouldn't
      // arise rather than one to paper over.
      editor.setFileState({ id, state: { status: "failed", message: "This file can't be retried — remove it and pick it again." } });
      return;
    }
    editor.setFileState({ id, state: { status: "uploading", progress: 0 } });
    track(id, runUpload(id, file));
  }, [editor, runUpload, track]);

  const forget = useCallback((id: number) => {
    // The upload may still be running; `setFileState` no-ops once the item is
    // gone and `runUpload`'s identity check stops it writing anyway, so
    // dropping the handles here is what keeps the maps from outliving the
    // chips they back.
    pendingUploadsRef.current.delete(id);
    uploadsInFlightRef.current.delete(id);
  }, []);

  const forgetAll = useCallback(() => {
    pendingUploadsRef.current.clear();
    uploadsInFlightRef.current.clear();
  }, []);

  return { addUploadFiles, retryFileUpload, awaitPendingUploads, forget, forgetAll };
}
