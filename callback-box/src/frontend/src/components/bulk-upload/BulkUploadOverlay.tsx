/**
 * Full-screen bulk file-upload overlay (`docs/implemented-plans/bulk-file-upload.md`,
 * Track 2 / Direction §4).
 *
 * Launched from the chat composer's Add menu ("Upload files…") and bound to the
 * launching chat via `targetSessionId` (the batch's context dir is derived
 * server-side from that id), so the delivered `<upload>` message lands in this
 * conversation. Files are picked or dropped,
 * streamed through a bounded-concurrency queue (`useBulkUpload`), and shown as a
 * per-item state list. "Done" seals the batch (naming any failures — deliver
 * immediately, never silent) and returns to chat, where the `<upload>` message
 * arrives via the normal stream; "Cancel batch" discards it.
 *
 * Lives under `components/` (exempt from restrict-component-classes) so it can
 * hand-roll the dialog chrome with the semantic palette directly — the same
 * `fixed inset-0` + `role="dialog"` idiom as `CaptureOverlay` / `CaptureResumeDialog`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, type BadgeTone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { CloseButton } from "../ui/CloseButton";
import { InlineAction } from "../ui/InlineAction";
import { Text } from "../ui/Text";
import { formatBytes } from "../../lib/format-bytes";
import { useBulkUpload, type BulkItemState, type BulkItemView } from "./use-bulk-upload";
import { waitForBulkDelivery } from "../../lib/bulk-upload-api";

const STATE_LABEL: Record<BulkItemState, string> = {
  queued: "Queued",
  uploading: "Uploading…",
  uploaded: "Uploaded",
  failed: "Failed",
};

const STATE_TONE: Record<BulkItemState, BadgeTone> = {
  queued: "neutral",
  uploading: "info",
  uploaded: "success",
  failed: "danger",
};

function ItemRow({ item, onRetry }: { item: BulkItemView; onRetry: (id: string) => void }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-warm-200">
      <div className="min-w-0 flex-1">
        <Text as="div" truncate>{item.name}</Text>
        <Text as="div" size="xs" tone="subtle">
          {formatBytes(item.size)}
          {item.state === "failed" && item.reason ? ` — ${item.reason}` : ""}
        </Text>
      </div>
      <Badge tone={STATE_TONE[item.state]}>{STATE_LABEL[item.state]}</Badge>
      {item.state === "failed" ? (
        <InlineAction intent="emphatic" onClick={() => onRetry(item.id)}>retry</InlineAction>
      ) : null}
    </div>
  );
}

/** The batch summary line plus its exit / finalize controls. */
function BatchFooter({ counts, exitLabel, doneLabel, finalizing, canFinalize, onExit, onDone }: {
  counts: { uploaded: number; failed: number; pending: number; total: number; totalBytes: number };
  exitLabel: string;
  doneLabel: string;
  finalizing: boolean;
  canFinalize: boolean;
  onExit: () => void;
  onDone: () => void;
}) {
  return (
    <footer className="border-t border-warm-300 bg-warm-100 px-5 py-3">
      <div className="mb-3">
        <Text size="sm" tone="muted">
          {counts.uploaded} uploaded / {counts.failed} failed / {counts.pending} pending
          {counts.total > 0 ? ` — ${formatBytes(counts.totalBytes)} total` : ""}
        </Text>
      </div>
      <div className="flex items-center justify-between gap-3">
        <Button intent="ghost" onClick={onExit} disabled={finalizing}>{exitLabel}</Button>
        <Button intent="primary" onClick={onDone} disabled={!canFinalize} loading={finalizing}>
          {doneLabel}
        </Button>
      </div>
    </footer>
  );
}

export function BulkUploadOverlay({ targetSessionId, seedFiles, note, onExit, onDelivered }: {
  targetSessionId: string;
  /**
   * Files the batch starts with — a photo selection too large to inline
   * (`chat/photo-batch-threshold.ts`). Empty when launched from the Add menu,
   * where the user picks inside the overlay instead.
   */
  seedFiles: File[];
  /** The composer text to send as the batch's introduction (empty when there was none). */
  note: string;
  onExit: () => void;
  /** Fired after a successful finalize, so the composer can clear the text this batch consumed. */
  onDelivered: () => void;
}) {
  const bulk = useBulkUpload({ targetSessionId });
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Sealed, but the box hadn't confirmed delivery before we stopped waiting. */
  const [stillWorking, setStillWorking] = useState(false);

  const { addFiles } = bulk;

  // Seed once on mount. `seedFiles` is the selection that opened this overlay;
  // re-adding on every render would duplicate the whole batch.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || seedFiles.length === 0) return;
    seededRef.current = true;
    addFiles(seedFiles);
  }, [addFiles, seedFiles]);

  const pickFiles = useCallback((list: FileList | null): void => {
    // Nothing may join the batch once finalize has sealed it: the registry is
    // frozen server-side, so a file added now would never upload, never appear in
    // `failedItems`, and vanish when the overlay closes.
    if (finalizing || stillWorking) return;
    if (list && list.length > 0) addFiles(Array.from(list));
  }, [addFiles, finalizing, stillWorking]);

  const handleDone = useCallback(async (): Promise<void> => {
    setActionError(null);
    setFinalizing(true);
    try {
      const trimmed = note.trim();
      const sessionId = await bulk.finalize({ note: trimmed !== "" ? trimmed : undefined });
      // Finalize only SEALS. Wait for the box to actually deliver before
      // releasing the user's text — otherwise a batch that fails during
      // prepare/deliver leaves them with no <upload> message AND no composer
      // text, which is the original bug wearing a different hat.
      const delivery = await waitForBulkDelivery({ sessionId, timeoutMs: 30_000, pollMs: 750 });
      // Sealed either way. The box now holds the bytes AND the note, so it owns
      // recovery: if delivery ultimately fails the sweep surfaces the batch to
      // the chat agent with the introduction and counts, which reaches the
      // boxholder far more reliably than a retry button on a tab they may close.
      // So the composer text is released here rather than held for a retry this
      // client shouldn't be attempting.
      onDelivered();
      if (delivery.outcome !== "delivered") {
        setStillWorking(true);
        setFinalizing(false);
        return;
      }
      onExit();
    } catch (e) {
      // Finalize failed — surface inline, keep the overlay open (the batch stays
      // staged/resumable server-side; nothing is lost).
      const message = e instanceof Error ? e.message : String(e);
      console.error("[bulk] Finalize failed:", message);
      setActionError(message);
      setFinalizing(false);
    }
  }, [bulk, note, onExit, onDelivered]);

  const handleCancel = useCallback(async (): Promise<void> => {
    if (bulk.counts.uploaded > 0 && !confirmingCancel) {
      setConfirmingCancel(true);
      return;
    }
    setActionError(null);
    try {
      await bulk.cancel();
    } catch (e) {
      // The server-side discard failed — surface it and keep the overlay OPEN.
      // The batch stays staged/resumable; silently closing would strand it and
      // hide the failure. In-flight uploads were already aborted client-side.
      const message = e instanceof Error ? e.message : String(e);
      console.error("[bulk] Cancel failed:", message);
      setActionError(message);
      return;
    }
    onExit();
  }, [bulk, confirmingCancel, onExit]);

  // Escape closes via the cancel path (with its uploaded-files confirm step).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Not while finalizing: the batch is sealed and the server refuses a
      // cancel then, so this would only surface a confusing error.
      if (e.key !== "Escape" || finalizing) return;
      if (stillWorking) { onExit(); return; }
      void handleCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleCancel, finalizing, stillWorking, onExit]);

  const dragHasFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer.types).includes("Files");

  const { counts } = bulk;
  const doneLabel = counts.failed > 0 ? `Deliver with ${counts.failed} failed` : "Done";
  const bannerError = actionError ?? bulk.error;
  // A sealed batch cannot be cancelled, so its only exit is a plain close that
  // leaves the box to finish. The composer text stays: delivery is unconfirmed.
  const exitLabel = stillWorking ? "Close" : confirmingCancel ? "Confirm discard?" : "Cancel batch";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-warm-50"
      role="dialog"
      aria-modal="true"
      aria-label="Upload files"
      onDragOver={(e) => { if (dragHasFiles(e)) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        setDragOver(false);
        pickFiles(e.dataTransfer.files);
      }}
    >
      <header className="flex items-center justify-between px-5 py-3 border-b border-warm-300 bg-warm-100">
        <Text as="h2" size="lg" weight="semibold">Upload files</Text>
        {finalizing ? null : <CloseButton label="Close upload" onClick={() => void handleCancel()} />}
      </header>

      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => { pickFiles(e.target.files); e.target.value = ""; }}
      />

      <div className={`flex-1 overflow-auto px-5 py-4 ${dragOver ? "outline-dashed outline-2 outline-primary -outline-offset-4" : ""}`}>
        <div className="mb-4 flex items-center gap-3">
          <Button intent="secondary" onClick={() => inputRef.current?.click()} disabled={finalizing || stillWorking}>Add files</Button>
          <Text size="sm" tone="subtle">or drag and drop files here</Text>
        </div>

        {bannerError ? (
          <div className="mb-4 rounded-lg border border-danger-light bg-danger-50 px-3 py-2">
            <Text as="p" size="sm" tone="danger">{bannerError}</Text>
          </div>
        ) : null}

        {stillWorking ? (
          <div className="mb-4 rounded-lg border border-warm-300 bg-warm-100 px-3 py-2">
            <Text as="p" size="sm">
              The box is still processing this batch. Your message was kept — the upload message
              will appear in chat when it lands.
            </Text>
          </div>
        ) : null}

        {bulk.items.length === 0 ? (
          <div className="flex h-full min-h-40 items-center justify-center">
            <Text tone="subtle">No files yet. Add or drop files to upload them into this chat.</Text>
          </div>
        ) : (
          <div>
            {bulk.items.map((item) => (
              <ItemRow key={item.id} item={item} onRetry={(id) => { if (!finalizing && !stillWorking) bulk.retry(id); }} />
            ))}
          </div>
        )}
      </div>

      <BatchFooter
        counts={counts}
        exitLabel={exitLabel}
        doneLabel={doneLabel}
        finalizing={finalizing}
        canFinalize={!counts.inFlight && bulk.items.length > 0}
        onExit={stillWorking ? onExit : () => void handleCancel()}
        onDone={() => void handleDone()}
      />
    </div>
  );
}
