/**
 * Redacted tag — agent-authored content the boxholder shouldn't see at a glance.
 *
 * Typical use: quiz answers the boxholder asked to attempt first, hints that
 * would spoil a guess in progress, intermediate reasoning offered as a
 * tap-to-check.
 *
 * Authored as `{% redacted %}…{% /redacted %}` — Markdoc-only; there's no
 * affordance for the boxholder to type it. Inline/block split mirrors `quote`
 * and `source`: a tag body with no newlines becomes `RedactedInline`,
 * otherwise `RedactedBlock`.
 *
 * Rendering: a blurred span with an animated SVG-turbulence noise overlay
 * (Threads-style "pixelated fuzz"). Clicking reveals. Without JS the content
 * stays blurred — safe for SSR and print.
 */

import { useState, type ReactNode } from "react";

// Inline SVG turbulence as a tileable noise texture. Encoded as a data URL so
// the overlay is self-contained — no extra asset to ship. Two octaves of
// fractalNoise give a grainy, pixel-ish look; baseFrequency tunes the grain
// size.
const NOISE_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"120\" height=\"120\">" +
      "<filter id=\"n\"><feTurbulence type=\"fractalNoise\" baseFrequency=\"0.9\" numOctaves=\"2\" stitchTiles=\"stitch\"/></filter>" +
      "<rect width=\"100%\" height=\"100%\" filter=\"url(#n)\" opacity=\"0.85\"/>" +
      "</svg>",
  );

const noiseStyle: React.CSSProperties = {
  backgroundImage: `url("${NOISE_SVG}")`,
  backgroundSize: "120px 120px",
  backgroundRepeat: "repeat",
  animation: "redacted-shimmer 1.2s steps(6) infinite",
  mixBlendMode: "multiply",
};

const KEYFRAMES = `@keyframes redacted-shimmer {
  0%   { background-position:   0px   0px; }
  20%  { background-position:  37px -19px; }
  40%  { background-position: -22px  41px; }
  60%  { background-position:  58px  12px; }
  80%  { background-position: -11px -33px; }
  100% { background-position:   0px   0px; }
}`;

function Shimmer({
  inline,
  children,
  onReveal,
}: {
  inline: boolean;
  children: ReactNode;
  onReveal: () => void;
}): ReactNode {
  const Wrapper = inline ? "span" : "div";
  return (
    <Wrapper
      role="button"
      tabIndex={0}
      aria-label="Redacted — tap to reveal"
      onClick={onReveal}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onReveal();
        }
      }}
      className={
        (inline ? "relative inline-block align-baseline " : "relative block ") +
        "cursor-pointer select-none rounded-sm overflow-hidden"
      }
    >
      <style>{KEYFRAMES}</style>
      <span
        aria-hidden="true"
        className="inline-block"
        style={{ filter: "blur(6px) saturate(0)" }}
      >
        {children}
      </span>
      <span
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={noiseStyle}
      />
      <span className="sr-only">Redacted content. Activate to reveal.</span>
    </Wrapper>
  );
}

// Once revealed, keep a subtle `info` (iris) tint so the text still reads as
// "this was redacted" at a glance rather than looking like ordinary content.
const REVEALED_TINT = "text-info-dark";

export function RedactedInline({ children }: { children?: ReactNode }): ReactNode {
  const [revealed, setRevealed] = useState(false);
  if (revealed) return <span data-redacted="revealed" className={REVEALED_TINT}>{children}</span>;
  return (
    <Shimmer inline onReveal={() => setRevealed(true)}>
      {children}
    </Shimmer>
  );
}

export function RedactedBlock({ children }: { children?: ReactNode }): ReactNode {
  const [revealed, setRevealed] = useState(false);
  if (revealed) {
    return (
      <div data-redacted="revealed" className={`my-2 ${REVEALED_TINT}`}>
        {children}
      </div>
    );
  }
  return (
    <Shimmer inline={false} onReveal={() => setRevealed(true)}>
      {children}
    </Shimmer>
  );
}
