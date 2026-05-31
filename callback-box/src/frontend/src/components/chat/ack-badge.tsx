/**
 * Ack badges shown alongside a user message — one per `<ack>` the agent
 * emitted in its reply. Each badge opens a small dialog with the ack label
 * and an optional ref link.
 */

import { useEffect, useRef, useState } from "react";
import { getAckKind, type AckIndication } from "../../lib/structured-output-parsing";
import { parseViewUrl } from "../../lib/view-url";
import type { OnZoomView } from "./markdown-rendering";

/**
 * Small ack badges shown alongside a user message — one per `<ack>` the
 * agent emitted in its reply. The first sits at the top-left of the
 * bubble; additional badges extend to the right. Same background as the
 * user bubble so they read as part of it.
 */
export function AckBadgeCluster({ acks, onZoomView }: { acks: AckIndication[] | undefined; onZoomView?: OnZoomView }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (!acks || acks.length === 0) return null;
  return (
    <span className="absolute -top-1 -left-1 inline-flex items-center gap-0.5">
      {acks.map((ack, i) => (
        <AckBadge
          key={i}
          ack={ack}
          open={openIndex === i}
          onToggle={() => setOpenIndex((cur) => (cur === i ? null : i))}
          onClose={() => setOpenIndex(null)}
          onZoomView={onZoomView}
        />
      ))}
    </span>
  );
}

function AckBadge({ ack, open, onToggle, onClose, onZoomView }: {
  ack: AckIndication;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onZoomView?: OnZoomView;
}) {
  const descriptor = getAckKind(ack.kind);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(e: MouseEvent) {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  if (!descriptor) return null;
  const label = ack.text ? `${descriptor.defaultPhrase} — ${ack.text}` : descriptor.defaultPhrase;

  function handleRefClick() {
    if (!ack.ref || !onZoomView) return;
    const target = parseViewUrl(ack.ref);
    onZoomView({ target: { ...target, zoom: false }, label: target.path });
    onClose();
  }

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-info text-white text-[9px] leading-none ring-1 ring-warm-50 cursor-pointer"
      >
        <span aria-hidden>{descriptor.icon}</span>
      </button>
      {open ? (
        <div
          role="dialog"
          className="absolute left-0 top-full mt-1 z-50 bg-white text-warm-800 rounded-lg shadow-lg border border-warm-200 px-3 py-2 w-64 text-xs normal-case tracking-normal"
        >
          <div className="font-medium text-warm-900">{label}</div>
          {ack.ref ? (
            onZoomView ? (
              <button
                type="button"
                onClick={handleRefClick}
                className="mt-1 block text-left text-info hover:underline break-all font-mono text-[11px]"
              >
                {ack.ref}
              </button>
            ) : (
              <div className="mt-1 text-warm-500 break-all font-mono text-[11px]">{ack.ref}</div>
            )
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
