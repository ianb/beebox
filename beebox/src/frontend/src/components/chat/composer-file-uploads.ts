/**
 * The composer's upload lifecycle: start an upload, track it, retry it, and
 * let a send wait for it. Two kinds of item upload: a non-image file (its
 * chip IS the upload), and an inline image's ORIGINAL (the image rides inline
 * as a reduced copy, and the original file goes up beside it so the agent has
 * bytes to work on — `input/emission-store.ts`, `ImageItem.original`). Both
 * share the identity check, the in-flight tracking, and the retry rule; they
 * differ only in which store field records the state.
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
import type { EmissionStore, FileItem, FileTransferState } from "../../input/emission-store";

export interface ComposerFileUploads {
  /** Register a picked set, start their uploads, and return the items created. */
  addUploadFiles: (files: File[]) => FileItem[];
  /** Start uploading an inline image's original; the image item must already be in the store. */
  uploadImageOriginal: (id: number, file: File) => void;
  /** Re-run a failed upload from the handle kept for it. */
  retryFileUpload: (id: number) => void;
  /** Re-run a failed original upload from the handle kept for it. */
  retryImageOriginal: (id: number) => void;
  /** Resolves once no upload is still running. Never rejects. */
  awaitPendingUploads: () => Promise<void>;
  /** Drop one file's handles — its chip was removed. */
  forget: (id: number) => void;
  /** Drop one image's original handles — its tile was removed or its encode failed. */
  forgetImage: (id: number) => void;
  /** Drop every handle — the composer reset. */
  forgetAll: () => void;
}

/** Which store field an upload's state lands in. Ids are per kind, so the maps are too. */
type UploadKind = "file" | "image";

export function useComposerFileUploads(editor: EmissionStore["editor"]): ComposerFileUploads {
  /**
   * The `File` behind each attachment, for retry — and the identity an upload
   * result is checked against. Entries are dropped on success, removal and
   * reset, so this never outlives the chips it backs.
   */
  const pendingUploadsRef = useRef({ file: new Map<number, File>(), image: new Map<number, File>() });
  /**
   * The in-flight upload for each item, so a send can wait on them. Settles
   * (never rejects) as each upload reaches `uploaded` or `failed` — the outcome
   * is read off the store, not off the promise.
   */
  const uploadsInFlightRef = useRef({ file: new Map<number, Promise<void>>(), image: new Map<number, Promise<void>>() });

  const setState = useCallback((kind: UploadKind, opts: { id: number; state: FileTransferState }): void => {
    if (kind === "file") editor.setFileState(opts);
    else editor.setImageOriginal(opts);
  }, [editor]);

  const runUpload = useCallback(async (kind: UploadKind, { id, file }: { id: number; file: File }): Promise<void> => {
    // An id is not a durable address: `reset("attachments")` restarts the
    // counter at 1, so after a send the next attachment can be minted with an
    // id a still-running upload holds — and removing a chip doesn't cancel its
    // transfer. Without this check that result lands on whoever owns the id
    // now, stamping a stranger's chip `uploaded` with this file's path: the
    // wrong file under the right name, throwing nothing. The handle map is the
    // identity — deleted on removal, cleared on reset, different `File` on a
    // re-minted id.
    const handles = pendingUploadsRef.current[kind];
    const stillOurs = () => handles.get(id) === file;
    try {
      const uploaded = await uploadChatFile(file, {
        onProgress: (fraction) => {
          if (!stillOurs()) return;
          setState(kind, { id, state: { status: "uploading", progress: fraction } });
        },
      });
      if (!stillOurs()) return;
      handles.delete(id);
      setState(kind, { id, state: { status: "uploaded", path: uploaded.path } });
    } catch (e) {
      console.error(`[chat] Failed to upload ${kind === "file" ? "file" : "image original"}:`, e);
      // Keep the handle: retry needs it, and the chip offers exactly that.
      if (!stillOurs()) return;
      setState(kind, { id, state: { status: "failed", message: errorMessage(e) } });
    }
  }, [setState]);

  /** Hold an upload's promise until it settles, so a send can wait on it. */
  const track = useCallback((kind: UploadKind, { id, running }: { id: number; running: Promise<void> }): void => {
    const inFlight = uploadsInFlightRef.current[kind];
    const done = running.finally(() => {
      // Only clear the entry if it is still THIS run — a retry replaces it.
      if (inFlight.get(id) === done) inFlight.delete(id);
    });
    inFlight.set(id, done);
  }, []);

  const awaitPendingUploads = useCallback(async (): Promise<void> => {
    // A retry started while we wait registers a new promise, so loop until the
    // maps are genuinely empty rather than snapshotting them once.
    // `Promise.all` drains the iterator synchronously, so the live view is
    // safe to pass.
    const { file, image } = uploadsInFlightRef.current;
    while (file.size > 0 || image.size > 0) {
      await Promise.all([...file.values(), ...image.values()]);
    }
  }, []);

  /** Start (or restart) one upload under `kind`, keeping its handle for retry. */
  const start = useCallback((kind: UploadKind, { id, file }: { id: number; file: File }): void => {
    pendingUploadsRef.current[kind].set(id, file);
    track(kind, { id, running: runUpload(kind, { id, file }) });
  }, [runUpload, track]);

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
      editor.addFile(item);
      start("file", { id: item.id, file });
    }
    return items;
  }, [editor, start]);

  const uploadImageOriginal = useCallback((id: number, file: File): void => {
    start("image", { id, file });
  }, [start]);

  const retry = useCallback((kind: UploadKind, id: number): void => {
    const file = pendingUploadsRef.current[kind].get(id);
    if (file === undefined) {
      // The handle is gone only if the page reloaded under a restored draft.
      // Restore drops every unfinished file (it has no path, so
      // `partitionFiles` classes it dead) and restores an unfinished image
      // original as `failed` with its own message — so this is a state that
      // shouldn't arise rather than one to paper over.
      const what = kind === "file" ? "This file" : "This image's original";
      setState(kind, { id, state: { status: "failed", message: `${what} can't be retried — remove it and pick it again.` } });
      return;
    }
    setState(kind, { id, state: { status: "uploading", progress: 0 } });
    start(kind, { id, file });
  }, [setState, start]);

  const retryFileUpload = useCallback((id: number) => { retry("file", id); }, [retry]);
  const retryImageOriginal = useCallback((id: number) => { retry("image", id); }, [retry]);

  const forgetKind = useCallback((kind: UploadKind, id: number) => {
    // The upload may still be running; the state setter no-ops once the item
    // is gone and `runUpload`'s identity check stops it writing anyway, so
    // dropping the handles here is what keeps the maps from outliving the
    // chips they back.
    pendingUploadsRef.current[kind].delete(id);
    uploadsInFlightRef.current[kind].delete(id);
  }, []);

  const forget = useCallback((id: number) => { forgetKind("file", id); }, [forgetKind]);
  const forgetImage = useCallback((id: number) => { forgetKind("image", id); }, [forgetKind]);

  const forgetAll = useCallback(() => {
    pendingUploadsRef.current.file.clear();
    pendingUploadsRef.current.image.clear();
    uploadsInFlightRef.current.file.clear();
    uploadsInFlightRef.current.image.clear();
  }, []);

  return {
    addUploadFiles, uploadImageOriginal, retryFileUpload, retryImageOriginal,
    awaitPendingUploads, forget, forgetImage, forgetAll,
  };
}
