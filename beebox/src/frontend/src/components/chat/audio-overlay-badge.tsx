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
import type { TranscriptionProvenance } from "./message-parsing";

type AudioBadgeKind = "retranscribed" | "consulted";

/** Persistent evidence that the displayed text came from the server HQ pass. */
export function TranscriptionProvenanceBadge({ provenance }: { provenance: TranscriptionProvenance | null }) {
  if (provenance?.kind !== "hq") return null;
  const label = provenance.service ? `HQ transcript — ${provenance.service}` : "HQ transcript";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="text-white/40 text-[9px] font-medium leading-none tracking-wide"
    >
      HQ
    </span>
  );
}

export interface AudioBadgeSpec {
  kind: AudioBadgeKind;
  glyph: ReactNode;
  label: string;
  detail: ReactNode;
}

/**
 * Both audio badges share a LISTENING motif (boxholder, 2026-08-16 — the
 * first pencil glyph wrongly implied editing): retranscription is the ear
 * alone (listened carefully to get the words right — the swapped text shows
 * the outcome), understanding adds a sparkle (grasped something about what
 * it heard). Stroke SVGs, same idiom as the selection pill's icon.
 */
function EarGlyph() {
  return (
    <svg className="w-[13px] h-[13px]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9a6 6 0 1 1 12 0c0 4.5-4 5-4 8.5a3 3 0 1 1-6 0" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.5 9a2.5 2.5 0 0 0-5 0" />
    </svg>
  );
}

function EarSparkleGlyph() {
  return (
    <svg className="w-[13px] h-[13px]" viewBox="0 0 24 24" aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth={2.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 11a5.5 5.5 0 1 1 11 0c0 4-3.5 4.5-3.5 7.5a2.8 2.8 0 1 1-5.6 0" />
      </g>
      <path fill="currentColor" d="M18.5 2l1.3 3.2L23 6.5l-3.2 1.3L18.5 11l-1.3-3.2L14 6.5l3.2-1.3z" />
    </svg>
  );
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
      glyph: <EarGlyph />,
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
    const { questions } = overlay.consulted;
    specs.push({
      kind: "consulted",
      glyph: <EarSparkleGlyph />,
      label: "The agent analyzed this recording",
      detail: (
        <>
          <div className="text-warm-500 text-[10px] uppercase tracking-wide mt-1.5">
            {questions.length === 1 ? "question asked" : "questions asked"}
          </div>
          {questions.map((q) => (
            <div key={q} className="mt-0.5 whitespace-pre-wrap">{q}</div>
          ))}
        </>
      ),
    });
  }
  return specs;
}

/**
 * Small badge cluster shown alongside a user message when it's been touched
 * by `bbx chat retranscribe` / `ask-about-audio`. Shares the corner row with
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
        // Solid contrast like AckBadge (the first muted bg-white/25 pass was
        // illegible — boxholder, 2026-08-16), one step larger than the ack
        // cluster, with a stroke-SVG glyph instead of a font glyph so it
        // stays crisp at badge size. Reads in both themes since the bubble
        // is always white-on-color regardless of app theme.
        className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-info text-white leading-none ring-1 ring-warm-50 cursor-pointer"
      >
        <span aria-hidden className="inline-flex">{spec.glyph}</span>
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
