/**
 * Whole-emission persistence, wired to the lifted singleton store
 * (docs/implemented-plans/input-extraction.md, chunk 4). Subscribes to the emission
 * store (all slices — text, images, files, selections) and debounce-writes
 * to `localStorage` under the singleton key (`emissionKey`, one per box —
 * NOT per session), so the composition survives a session switch and a
 * reload. Pure serialize/parse/adoption logic lives in `input/emission-persist.ts`
 * and is doctested there; this hook owns the storage I/O, the React
 * lifecycle, and the restore-time file-existence check.
 *
 * Restore (once, only into an EMPTY store — never clobbers active
 * composition):
 *   - If the singleton key holds a persisted emission, restore it: text via
 *     `setText`, images via `addImage` (the object URL is regenerated as a
 *     `data:` URI — the blob is gone after a reload, same approach as the
 *     chunk-3 rejected-send restore in `chat-target.ts`), files via
 *     `addFile` (after an existence check — `tmp/…` uploads are swept by
 *     housekeeping after 7 days), selections via `addSelection`. Restored
 *     items reuse their persisted ids (so they keep matching the
 *     `[imageN]`/`[fileN]`/`[selectionN]` tokens already in the restored
 *     text); `editor.reserveIds` then advances the store's id counters past
 *     the restored ids so a subsequent `nextImageId()` etc. can't mint a
 *     colliding id. This is the simpler of the two options the plan
 *     considered (the alternative — re-adding with fresh ids and rewriting
 *     the text's tokens to match — needs a pure token-rewrite function for
 *     no benefit here, since the store already tolerates caller-supplied ids).
 *   - Otherwise, one-shot-adopt the most-recently-updated legacy
 *     `bbx-composer-draft:<box>:*` draft (`adoptLegacyComposerDrafts`,
 *     removes all of this box's legacy keys either way) and seed the text
 *     from it. Logged via `console.info` — a named behavior change (other
 *     sessions' drafts are discarded, not merged).
 *
 * Writes are debounced while the composer has content, but an EMPTY store is
 * committed synchronously (the key is removed, not rewritten empty). Emptiness
 * is what a send leaves behind, and it is a definitive event rather than a
 * keystroke — debouncing it let an in-app navigation cancel the clear and
 * resurface the just-sent draft as "unsent"
 * (issues/bugs/2026-07-23-voice-send-lingers-as-unsent-recovery-draft.md).
 *
 * A restore in progress (the file-existence check is a network round trip)
 * suppresses the debounced persist so a slow check can't have its
 * in-flight write clobbered by a premature save of the still-empty draft.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadedPath } from "../input/emission-store";
import type { EmissionStore, ImageItem } from "../input/emission-store";
import {
  loadPersistedEmission,
  commitPersistedEmission,
  isEmptyEmissionDraft,
  adoptLegacyComposerDrafts,
  partitionFiles,
  type PersistedEmission,
} from "../input/emission-persist";
import { apiRawFileUrl, getApiBase } from "../api-core";
import { usePersistScheduler, PERSIST_DEBOUNCE_MS } from "./usePersistScheduler";
import { normalizeComposerTokens } from "@shared/composer-tokens";

// Restore is once per store LIFETIME, not per hook mount: the store is the
// lifted singleton (ChatPage), but this hook remounts with InteractiveChat
// on every session switch — and React StrictMode double-runs effects. A
// second restore racing the first past the empty check would double-add
// every restored item.
const restoreAttempted = new WeakSet<object>();

export interface EmissionPersistenceApi {
  /** Restored attachments whose `tmp/…` upload was swept before reload — display names for the dismissible notice. */
  expiredAttachments: string[];
  /** Dismiss the expired-attachments notice (an explicit "x", or the caller can drop it on the next send). */
  dismissExpiredAttachments: () => void;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const response = await fetch(apiRawFileUrl(getApiBase(), path), { method: "HEAD" });
    return response.ok;
  } catch (_e) {
    // Network hiccup — treat as gone rather than risk restoring a broken
    // reference silently; the user can re-attach.
    return false;
  }
}

function maxId(items: readonly { id: number }[]): number | undefined {
  const first = items[0];
  if (first === undefined) return undefined;
  return items.reduce((max, item) => (item.id > max ? item.id : max), first.id);
}

export function useEmissionPersistence(opts: {
  boxSlug: string | undefined;
  emissionStore: EmissionStore;
}): EmissionPersistenceApi {
  const { boxSlug, emissionStore } = opts;
  const { editor } = emissionStore;
  const restoringRef = useRef(false);
  const [expiredAttachments, setExpiredAttachments] = useState<string[]>([]);

  const persistNow = useCallback(() => {
    if (restoringRef.current) return;
    commitPersistedEmission(window.localStorage, { boxSlug, draft: emissionStore.get(), updatedAt: Date.now() });
  }, [boxSlug, emissionStore]);

  // Flush synchronously when the tab hides (the sleep / app-switch moment),
  // closing the debounce gap — same pattern as the retired useComposerDraft.
  const flushOnHide = useCallback(
    (cancel: () => void) => {
      if (restoringRef.current) return;
      cancel();
      persistNow();
    },
    [persistNow],
  );

  const { schedule, cancel, flush } = usePersistScheduler({ debounceMs: PERSIST_DEBOUNCE_MS, onHide: flushOnHide });

  const dismissExpiredAttachments = useCallback(() => {
    setExpiredAttachments([]);
  }, []);

  // Restore once, only into an empty store — see file header. Runs before
  // the persist-subscribe effect below (declaration order), so that
  // effect's own initial save observes the restored state, not the
  // pre-restore empty one.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (restoreAttempted.has(emissionStore)) return;
    restoreAttempted.add(emissionStore);
    if (!isEmptyEmissionDraft(emissionStore.get())) return;

    const persisted = loadPersistedEmission(window.localStorage, boxSlug);
    if (persisted === null) {
      const { adoptedText, discarded } = adoptLegacyComposerDrafts(window.localStorage, boxSlug);
      if (adoptedText !== null) {
        editor.setText(adoptedText);
        console.info(
          `[input-persist] adopted the most recent unsent composer draft for this box (${discarded} other draft(s) discarded)`,
        );
      }
      return;
    }

    restoringRef.current = true;
    void restorePersisted(persisted).finally(() => {
      restoringRef.current = false;
    });

    async function restorePersisted(p: PersistedEmission): Promise<void> {
      // Persistence only ever saves landed files (`emission-persist.ts`), so
      // every entry here has a path; a defensive skip keeps a hand-edited or
      // older payload from throwing mid-restore.
      const checks = await Promise.all(p.files.flatMap((f) => {
        const path = uploadedPath(f);
        if (path === null) return [];
        return [fileExists(path).then((exists) => [path, exists] as const)];
      }));
      // Commit-time recheck: the file HEADs are a network round trip, and
      // the user may have started typing during it. Their live composition
      // wins — abort rather than clobber (the persisted draft is then
      // superseded by the next debounced save of what they typed).
      if (!isEmptyEmissionDraft(emissionStore.get())) {
        console.warn("[input-persist] composer used before restore finished — persisted draft discarded");
        return;
      }
      const existingPaths = new Set(checks.filter(([, ok]) => ok).map(([path]) => path));
      const { live, dead } = partitionFiles(p.files, existingPaths);

      // A draft written before the `[image#1]` rename still carries `[image1]`.
      // Normalize on the way back in, so what the user is handed reads like a
      // freshly-attached composition and the `<attachments>` block a later send
      // writes matches the tokens in its own body.
      editor.setText(normalizeComposerTokens(p.text));
      editor.restoreImages(p.images.map((image): ImageItem => ({
        ...image,
        objectUrl: `data:${image.mimeType};base64,${image.dataBase64}`,
      })));
      for (const file of live) editor.addFile(file);
      // Dead files (their tmp/ upload was swept) must not leave dangling
      // [file#N] tokens in the restored text — a send would reference an
      // attachment that isn't in the outgoing block. add+remove reuses the
      // store's own token-stripping.
      for (const file of dead) {
        editor.addFile(file);
        editor.removeFile(file.id);
      }
      for (const selection of p.selections) editor.addSelection(selection);
      editor.reserveIds({
        image: maxId(p.images),
        file: maxId(p.files),
        selection: maxId(p.selections),
      });

      if (dead.length > 0) {
        setExpiredAttachments(dead.map((f) => f.originalName));
      }
    }
    // Restore is a one-shot per (empty) mount; `boxSlug`/`emissionStore`
    // identity changes are the only legitimate re-runs (a different box, or
    // — in practice never, since it's the lifted singleton — a new store).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emissionStore, boxSlug]);

  // Debounced persist on every emission change, matching the keystroke-
  // isolation invariant (components/chat/CLAUDE.md): this subscribes to the
  // store directly, not via React state, so a keystroke never re-renders
  // this hook's owner.
  useEffect(() => {
    function scheduleWrite(): void {
      if (restoringRef.current) return;
      // An EMPTY store is the definitive nothing-to-recover event — it is
      // what a send leaves behind (every send site clears text, attachments,
      // and selections), and it is not keystroke-frequency. Clear the key
      // NOW rather than on the debounce: a debounced clear loses its race
      // with an in-app navigation, and the pre-send draft then comes back as
      // an "unsent" recovery offer
      // (issues/bugs/2026-07-23-voice-send-lingers-as-unsent-recovery-draft.md).
      if (isEmptyEmissionDraft(emissionStore.get())) {
        cancel();
        persistNow();
        return;
      }
      schedule(persistNow);
    }
    const unsubscribe = emissionStore.subscribe(scheduleWrite);
    scheduleWrite();
    // Flush, never cancel, on the way out. Unmount is covered by the
    // scheduler's own dependency-free effect, but a BOX SWITCH re-runs this
    // cleanup without unmounting — the pending write's closure still points
    // at the old store and key, so flushing here is the only way the old
    // box's last ≤400ms of typing reaches disk before the new box's writes
    // supersede it.
    return () => {
      flush();
      unsubscribe();
    };
  }, [emissionStore, schedule, cancel, persistNow, flush]);

  // The expired-attachments notice self-dismisses once the composer empties
  // out again (a send, or the user clearing everything) — the "next send"
  // behavior from the design, approximated without reaching into the
  // (off-limits) send path: emptying the store is what a send does.
  useEffect(() => {
    function onChange(): void {
      if (expiredAttachments.length === 0) return;
      if (isEmptyEmissionDraft(emissionStore.get())) setExpiredAttachments([]);
    }
    return emissionStore.subscribe(onChange);
  }, [emissionStore, expiredAttachments.length]);

  return { expiredAttachments, dismissExpiredAttachments };
}
