/**
 * Full-screen bulk file-upload overlay (`docs/plans/bulk-file-upload.md`,
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

export function BulkUploadOverlay({ targetSessionId, onExit }: {
  targetSessionId: string;
  onExit: () => void;
}) {
  const bulk = useBulkUpload({ targetSessionId });
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { addFiles } = bulk;

  const pickFiles = useCallback((list: FileList | null): void => {
    if (list && list.length > 0) addFiles(Array.from(list));
  }, [addFiles]);

  const handleDone = useCallback(async (): Promise<void> => {
    setActionError(null);
    setFinalizing(true);
    try {
      await bulk.finalize();
      onExit();
    } catch (e) {
      // Finalize failed — surface inline, keep the overlay open (the batch stays
      // staged/resumable server-side; nothing is lost).
      const message = e instanceof Error ? e.message : String(e);
      console.error("[bulk] Finalize failed:", message);
      setActionError(message);
      setFinalizing(false);
    }
  }, [bulk, onExit]);

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
      if (e.key === "Escape") void handleCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleCancel]);

  const dragHasFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer.types).includes("Files");

  const { counts } = bulk;
  const doneLabel = counts.failed > 0 ? `Deliver with ${counts.failed} failed` : "Done";
  const bannerError = actionError ?? bulk.error;

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
        <CloseButton label="Close upload" onClick={() => void handleCancel()} />
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
          <Button intent="secondary" onClick={() => inputRef.current?.click()}>Add files</Button>
          <Text size="sm" tone="subtle">or drag and drop files here</Text>
        </div>

        {bannerError ? (
          <div className="mb-4 rounded-lg border border-danger-light bg-danger-50 px-3 py-2">
            <Text as="p" size="sm" tone="danger">{bannerError}</Text>
          </div>
        ) : null}

        {bulk.items.length === 0 ? (
          <div className="flex h-full min-h-40 items-center justify-center">
            <Text tone="subtle">No files yet. Add or drop files to upload them into this chat.</Text>
          </div>
        ) : (
          <div>
            {bulk.items.map((item) => (
              <ItemRow key={item.id} item={item} onRetry={(id) => bulk.retry(id)} />
            ))}
          </div>
        )}
      </div>

      <footer className="border-t border-warm-300 bg-warm-100 px-5 py-3">
        <div className="mb-3">
          <Text size="sm" tone="muted">
            {counts.uploaded} uploaded / {counts.failed} failed / {counts.pending} pending
            {counts.total > 0 ? ` — ${formatBytes(counts.totalBytes)} total` : ""}
          </Text>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Button intent="ghost" onClick={() => void handleCancel()}>
            {confirmingCancel ? "Confirm discard?" : "Cancel batch"}
          </Button>
          <Button
            intent="primary"
            onClick={() => void handleDone()}
            disabled={counts.inFlight || bulk.items.length === 0}
            loading={finalizing}
          >
            {doneLabel}
          </Button>
        </div>
      </footer>
    </div>
  );
}
