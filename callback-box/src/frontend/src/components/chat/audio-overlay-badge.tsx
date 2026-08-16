/**
 * Corner badges for the two audio-review overlays on a user message
 * (docs/implemented-plans/retranscription-in-chat.md Track 3): a retranscription (the
 * bubble's text was swapped for a better HQ pass) and/or a consult (the
 * agent listened to the recording without correcting the text). Follows
 * `AckBadgeCluster`'s corner-badge + popover *pattern* (`ack-badge.tsx`) but
 * is its own component — the ack cluster is typed around `AckIndication`
 * parsed from agent replies, which this data isn't.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AudioOverlayEntry } from "./audio-overlay-store";

type AudioBadgeKind = "retranscribed" | "consulted";

export interface AudioBadgeSpec {
  kind: AudioBadgeKind;
  glyph: string;
  label: string;
  detail: ReactNode;
}

/**
 * Pure seam between the overlay data and the badge cluster's rendering —
 * exported so tests can check labels/popover content directly instead of
 * simulating a click to open the (closed-by-default) popover.
 */
export function buildAudioBadgeSpecs(overlay: AudioOverlayEntry, originalText: string): AudioBadgeSpec[] {
  const specs: AudioBadgeSpec[] = [];
  if (overlay.retranscription) {
    const { service } = overlay.retranscription;
    specs.push({
      kind: "retranscribed",
      glyph: "✎",
      label: service ? `Retranscribed — ${service}` : "Retranscribed",
      detail: (
        <>
          <div className="text-warm-500 text-[10px] uppercase tracking-wide mt-1.5">realtime transcript</div>
          <div className="mt-0.5 whitespace-pre-wrap">{originalText}</div>
        </>
      ),
    });
  }
  if (overlay.consulted) {
    specs.push({
      kind: "consulted",
      glyph: "\u{1F3A7}",
      label: "The agent analyzed this recording",
      detail: null,
    });
  }
  return specs;
}

/**
 * Small badge cluster shown alongside a user message when it's been touched
 * by `cb chat retranscribe` / `ask-about-audio`. Shares the corner row with
 * `AckBadgeCluster`; audio badges append after ack badges, both clusters
 * sitting side by side in the same absolutely-positioned row.
 */
export function AudioOverlayBadgeCluster({ overlay, originalText }: { overlay: AudioOverlayEntry | undefined; originalText: string }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (!overlay) return null;
  const specs = buildAudioBadgeSpecs(overlay, originalText);
  if (specs.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5">
      {specs.map((spec, i) => (
        <AudioOverlayBadge
          key={spec.kind}
          spec={spec}
          open={openIndex === i}
          onToggle={() => setOpenIndex((cur) => (cur === i ? null : i))}
          onClose={() => setOpenIndex(null)}
        />
      ))}
    </span>
  );
}

function AudioOverlayBadge({ spec, open, onToggle, onClose }: {
  spec: AudioBadgeSpec;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(e: MouseEvent) {
      if (rootRef.current !== null && e.target instanceof Node && !rootRef.current.contains(e.target)) {
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

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={onToggle}
        aria-label={spec.label}
        aria-haspopup="dialog"
        aria-expanded={open}
        // Muted white-on-color, matching this bubble's opacity convention
        // (pills' bg-white/20, PendingIndicator's text-white/70) rather than
        // AckBadge's solid bg-info — subtle by design (boxholder asked for
        // emoticon-scale, not chrome), and reads in both themes since the
        // bubble is always white-on-color regardless of app theme.
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-white/25 text-white text-[9px] leading-none ring-1 ring-white/40 cursor-pointer"
      >
        <span aria-hidden>{spec.glyph}</span>
      </button>
      {open ? (
        <div
          role="dialog"
          className="absolute left-0 top-full mt-1 z-50 bg-white text-warm-800 rounded-lg shadow-lg border border-warm-200 px-3 py-2 w-64 text-xs normal-case tracking-normal"
        >
          <div className="font-medium text-warm-900">{spec.label}</div>
          {spec.detail}
        </div>
      ) : null}
    </span>
  );
}
