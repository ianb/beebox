/**
 * SyncRunModal — overlay window that displays the streaming output of a
 * background `cb wakeup` invocation. Pure render component — the run
 * lifecycle and accumulated output are owned by `useSyncRun` and passed in.
 */

import { useEffect, useRef, type MouseEvent } from "react";
import { CloseButton } from "../ui/CloseButton";
import type { SyncRun } from "../../hooks/useSyncRun";

function StatusBadge({ run }: { run: SyncRun }) {
  if (run.running) return <span className="ml-2 text-primary animate-pulse">running…</span>;
  if (!run.result) return null;
  if (run.result.success) return <span className="ml-2 text-success">done</span>;
  return <span className="ml-2 text-danger-dark">error</span>;
}

function OutputBody({ run }: { run: SyncRun }) {
  const text = run.output.join("");
  const errorTail =
    !run.running && run.result && !run.result.success && run.result.error
      ? `\n\nError: ${run.result.error}`
      : "";
  const empty = !run.running && run.output.length === 0 && !run.result;
  return (
    <>
      {text}
      {errorTail}
      {empty ? "(no output)" : ""}
    </>
  );
}

export function SyncRunModal({ run }: { run: SyncRun }) {
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [run.output]);

  const handleClose = () => run.close();
  const handleInnerClick = (e: MouseEvent) => e.stopPropagation();

  if (!run.open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden"
        onClick={handleInnerClick}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold text-warm-700">
            <code className="font-mono">cb wakeup</code>
            <StatusBadge run={run} />
          </h2>
          <CloseButton onClick={handleClose} size="sm" />
        </div>
        <pre
          ref={outputRef}
          className="flex-1 overflow-auto p-3 text-xs font-mono bg-gray-900 text-gray-100 whitespace-pre-wrap break-words min-h-[200px]"
        >
          <OutputBody run={run} />
        </pre>
      </div>
    </div>
  );
}
