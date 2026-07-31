/**
 * Opening (and closing) the chat's bulk-upload overlay
 * (`docs/plans/chat-photo-batch-upload.md`, Track 2).
 *
 * Two things open it: the composer's "Upload files…" menu entry, which opens an
 * empty overlay for the user to pick into; and a photo selection too large to
 * ride inline (`photo-batch-threshold.ts`), which opens one already holding the
 * photos. Both carry the composer text as the batch's introduction — that is
 * what keeps the agent filing against what the boxholder said instead of asking
 * what the files are (`src/schemas/upload-batch.tsx` duty 1).
 *
 * Non-reactive by design: like the other composer-adjacent hooks it reads the
 * text with `get()` at call time rather than subscribing, so a keystroke never
 * re-renders the `InteractiveChat` root (see components/chat/CLAUDE.md,
 * "Composer input lives in a store, not root state").
 */

import { useCallback, useState } from "react";
import type { EmissionStore } from "../../input/emission-store";

/** An open bulk-upload overlay, and what it was opened with. */
export interface BulkUploadLaunch {
  /** Files the batch starts with — empty when opened from the Add menu. */
  seedFiles: File[];
  /** Composer text at open time, sent as the batch's introduction. */
  note: string;
}

export interface BulkUploadLaunchController {
  launch: BulkUploadLaunch | null;
  /** Open an empty overlay (the Add-menu entry). */
  openEmpty: () => void;
  /**
   * Open one seeded with a photo selection too large to inline. When
   * `foldInComposerImages` is set, the composer's existing inline photos join
   * the same batch and are removed from the composer.
   */
  openWithPhotos: (opts: { files: File[]; foldInComposerImages: boolean }) => void;
  close: () => void;
  /** Clear the composer text a delivered batch consumed as its introduction. */
  onDelivered: () => void;
}

/**
 * Turn an already-encoded composer image back into a `File` so it can join a
 * batch. The store holds the downscaled bytes as base64 (that is what an inline
 * send transmits), so this decodes rather than re-reading the original pick.
 */
function composerImageToFile(image: { id: number; mimeType: string; dataBase64: string }): File {
  // `atob` yields one latin-1 char per byte, so each code point IS the byte.
  const bytes = Uint8Array.from(atob(image.dataBase64), (char) => char.codePointAt(0) ?? 0);
  const extension = image.mimeType === "image/png" ? "png" : "jpg";
  return new File([bytes], `pasted-image-${String(image.id)}.${extension}`, { type: image.mimeType });
}

export function useBulkUploadLaunch(opts: {
  emissionStore: EmissionStore;
  /** Drops the persisted draft too, so the consumed text doesn't come back on reload. */
  clearDraftRef: React.MutableRefObject<() => void>;
}): BulkUploadLaunchController {
  const { emissionStore, clearDraftRef } = opts;
  const [launch, setLaunch] = useState<BulkUploadLaunch | null>(null);

  const openEmpty = useCallback((): void => {
    setLaunch({ seedFiles: [], note: emissionStore.get().text });
  }, [emissionStore]);

  const openWithPhotos = useCallback(({ files, foldInComposerImages }: {
    files: File[];
    foldInComposerImages: boolean;
  }): void => {
    const draft = emissionStore.get();
    // Existing inline photos come along, so one selection act has one
    // destination and the composer text describes the whole batch rather than
    // half of it.
    //
    // Removed one at a time by id — NOT via reset("attachments"), which also
    // clears `files` and would silently drop an unrelated attachment (a PDF the
    // user attached alongside) that isn't joining the batch. `removeImage` also
    // strips each `[imageN]` token from the text, so the note doesn't ship
    // references to photos that are no longer described by it.
    const folded = foldInComposerImages ? draft.images.map(composerImageToFile) : [];
    if (foldInComposerImages) {
      for (const image of draft.images) {
        emissionStore.editor.removeImage(image.id);
        try { URL.revokeObjectURL(image.objectUrl); } catch (_e) { /* already revoked — harmless */ }
      }
    }
    // Read the text AFTER the removals, so the note reflects the stripped tokens.
    setLaunch({ seedFiles: [...folded, ...files], note: emissionStore.get().text });
  }, [emissionStore]);

  const close = useCallback((): void => setLaunch(null), []);

  const onDelivered = useCallback((): void => {
    // The batch carried this text away as its introduction, so the composer must
    // not still hold it — same "consumed on send" semantics as an ordinary send.
    emissionStore.editor.setText("");
    clearDraftRef.current();
  }, [emissionStore, clearDraftRef]);

  return { launch, openEmpty, openWithPhotos, close, onDelivered };
}
