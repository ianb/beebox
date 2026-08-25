/**
 * Opening (and closing) the chat's bulk-upload overlay
 * (`docs/plans/chat-photo-batch-upload.md`, Track 2).
 *
 * One thing opens it: a file set that `file-routing.ts` sent to the batch path
 * — a non-image in the selection, or more photos than can ride inline. The
 * overlay therefore always opens already holding its files; the menu no longer
 * offers an empty one to pick into
 * (`issues/features/2026-08-03-attach-vs-upload-menu-confusing.md`). It carries
 * the composer text as the batch's introduction — that is what keeps the agent
 * filing against what the boxholder said instead of asking what the files are
 * (`src/schemas/upload-batch.tsx` duty 1).
 *
 * The composer's own inline photos are folded into the same batch, which is a
 * destructive edit made on the assumption that the batch will be delivered.
 * This hook owns the other half of that bet: every exit that does NOT deliver
 * puts them back (`composer-fold.ts`).
 *
 * Non-reactive by design: like the other composer-adjacent hooks it reads the
 * text with `get()` at call time rather than subscribing, so a keystroke never
 * re-renders the `InteractiveChat` root (see components/chat/CLAUDE.md,
 * "Composer input lives in a store, not root state").
 */

import { useCallback, useRef, useState } from "react";
import { toastError } from "../ui/toast-store";
import type { EmissionStore } from "../../input/emission-store";
import {
  foldComposerImages,
  restoreFoldedImages,
  releaseFoldedImages,
  type ComposerFold,
} from "./composer-fold";

/** An open bulk-upload overlay, and what it was opened with. */
export interface BulkUploadLaunch {
  /** Files the batch starts with — never empty; routing only opens it with files. */
  seedFiles: File[];
  /** Composer text at open time, sent as the batch's introduction. */
  note: string;
}

export interface BulkUploadLaunchController {
  launch: BulkUploadLaunch | null;
  /**
   * Open one seeded with a file set routed to the batch path. When
   * `foldInComposerImages` is set, the composer's existing inline photos join
   * the same batch and are removed from the composer. Refuses (with a toast)
   * while the chat has no session id — see the hook.
   */
  openWithFiles: (opts: { files: File[]; foldInComposerImages: boolean }) => void;
  /**
   * Leave without delivering — cancel, discard, Escape, the close button. Puts
   * the folded photos and their `[image#N]` tokens back in the composer.
   */
  close: () => void;
  /** Clear the composer text a delivered batch consumed as its introduction. */
  onDelivered: () => void;
}

export function useBulkUploadLaunch(opts: {
  emissionStore: EmissionStore;
  /** Drops the persisted draft too, so the consumed text doesn't come back on reload. */
  clearDraftRef: React.MutableRefObject<() => void>;
  /**
   * The chat a batch would bind to. Null until the session exists — a Codex box
   * names its own thread, so there is no id until the first message lands
   * (a Claude box coins one in the browser and never sees this).
   */
  sessionId: string | null;
}): BulkUploadLaunchController {
  const { emissionStore, clearDraftRef, sessionId } = opts;
  const [launch, setLaunch] = useState<BulkUploadLaunch | null>(null);
  // A ref, not state, for two reasons the first attempt at this got wrong.
  // Restoring is a side effect, and a side effect inside a `setState` updater
  // runs twice under StrictMode — two copies of every photo. And a successful
  // finalize calls `onDelivered` and then `onExit` in the same render, so the
  // second would still read the pre-delivery state value and would resurrect
  // photos that had already landed.
  const foldedRef = useRef<ComposerFold | null>(null);

  const openWithFiles = useCallback(({ files, foldInComposerImages }: {
    files: File[];
    foldInComposerImages: boolean;
  }): void => {
    // No session, no batch target. Say so rather than opening nothing: these
    // files were pasted, dropped or picked, and dropping them on the floor is
    // how a paste of six photos used to vanish without a word.
    if (sessionId === null) {
      toastError("Send a message first, then add files");
      return;
    }
    // Existing inline photos come along, so one selection act has one
    // destination and the composer text describes the whole batch rather than
    // half of it. Reversible — see `composer-fold.ts`.
    const fold = foldInComposerImages ? foldComposerImages(emissionStore) : null;
    foldedRef.current = fold;
    // Read the text AFTER the fold's removals, so the note reflects the
    // stripped tokens rather than referring to photos it no longer describes.
    setLaunch({ seedFiles: [...(fold?.files ?? []), ...files], note: emissionStore.get().text });
  }, [emissionStore, sessionId]);

  const close = useCallback((): void => {
    const fold = foldedRef.current;
    // Cleared first, so a second exit (an Escape landing alongside the close
    // button) cannot restore the same photos twice.
    foldedRef.current = null;
    if (fold !== null) restoreFoldedImages(emissionStore, fold);
    setLaunch(null);
  }, [emissionStore]);

  const onDelivered = useCallback((): void => {
    // The batch carried this text away as its introduction, so the composer must
    // not still hold it — same "consumed on send" semantics as an ordinary send.
    emissionStore.editor.setText("");
    clearDraftRef.current();
    // The folded photos have landed in the batch, so nothing is coming back and
    // their previews can go. Clearing the ref is also what turns the `onExit`
    // that follows a successful finalize into a plain close rather than a
    // resurrection.
    const fold = foldedRef.current;
    foldedRef.current = null;
    if (fold !== null) releaseFoldedImages(fold);
  }, [emissionStore, clearDraftRef]);

  return { launch, openWithFiles, close, onDelivered };
}
