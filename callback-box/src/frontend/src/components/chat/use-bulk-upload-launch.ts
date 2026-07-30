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
  /** Open one seeded with a photo selection too large to inline. */
  openWithPhotos: (files: File[]) => void;
  close: () => void;
  /** Clear the composer text a delivered batch consumed as its introduction. */
  onDelivered: () => void;
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

  const openWithPhotos = useCallback((files: File[]): void => {
    setLaunch({ seedFiles: files, note: emissionStore.get().text });
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
