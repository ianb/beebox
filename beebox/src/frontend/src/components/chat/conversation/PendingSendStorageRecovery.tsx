import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Stack } from "../../../components/ui/Stack";
import { createPendingSendsStore, pendingSendRecoveryCopies, quarantineUnreadablePendingSends,
  type PendingSendRecoveryCopy, type PendingSendsStore } from "./pending-sends";

function PreservedCopy({ copy }: { copy: PendingSendRecoveryCopy }) {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([copy.raw], { type: "application/octet-stream" }));
    setDownloadUrl(url);
    return () => { URL.revokeObjectURL(url); };
  }, [copy.raw]);
  return <details>
    <summary>Preserved saved-message copy</summary>
    {downloadUrl !== null && <a href={downloadUrl} download="saved-message-recovery.txt" className="text-sm text-primary underline">Download preserved copy</a>}
    <textarea aria-label="Preserved unreadable saved messages" readOnly value={copy.raw} className="w-full rounded border border-warm-300 p-2 text-xs" />
  </details>;
}

/** A damaged envelope can be set aside only after preserving every original byte. */
export function PendingSendStorageRecovery({ boxSlug, blocked, onRecovered }: {
  boxSlug: string;
  blocked: boolean;
  onRecovered(store: PendingSendsStore): void;
}) {
  const [copies, setCopies] = useState<PendingSendRecoveryCopy[]>(() => {
    try { return pendingSendRecoveryCopies(sessionStorage, boxSlug); }
    catch (_cause) {
      // The owning hook separately exposes storage failure as a blocking alert.
      return [];
    }
  });
  const [error, setError] = useState<string | null>(null);
  function recover(preserve: boolean): void {
    try {
      const store = preserve ? quarantineUnreadablePendingSends(sessionStorage, boxSlug)
        : createPendingSendsStore(sessionStorage, boxSlug);
      setCopies(pendingSendRecoveryCopies(sessionStorage, boxSlug));
      setError(null);
      onRecovered(store);
    } catch (_cause) {
      setError(preserve ? "Could not preserve and reopen saved messages. The original copy and your draft have been kept."
        : "Saved messages still cannot be loaded. Preserve the unreadable copy to start fresh, or try again when storage is available.");
    }
  }
  if (!blocked && copies.length === 0) return null;
  return <Stack gap="sm">
    {blocked ? <>
      <p className="text-sm text-warm-700">If a saved message cannot be read, preserve its original data before starting a fresh saved-message list. This does not send or discard those messages.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" intent="secondary" onClick={() => { recover(false); }}>Retry loading saved messages</Button>
        <Button size="sm" intent="secondary" onClick={() => { recover(true); }}>Preserve unreadable copy and start fresh</Button>
      </div>
    </> : null}
    {error !== null && <p role="alert" className="text-sm text-danger">{error}</p>}
    {copies.map((copy) => <PreservedCopy key={copy.key} copy={copy} />)}
  </Stack>;
}
