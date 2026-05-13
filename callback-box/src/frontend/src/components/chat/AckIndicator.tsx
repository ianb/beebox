/**
 * Renders `<ack>` indications as small icons clustered in the top-right of
 * the assistant message — out of the prose flow, signalling "thing done"
 * without competing with the response content. Each icon is a tap target
 * when a `ref` is present; hover/tap surfaces the kind label, optional
 * inner text, and ref path.
 *
 * See `lib/structured-output-parsing.ts` for the data model and
 * `docs/narration-mode-design.md` for the design rationale.
 */

import { useEffect, useState, useRef } from "react";
import { getAckKind, type AckIndication } from "../../lib/structured-output-parsing";
import { cn } from "../../lib/cn";

function refLabel(ref: string): string {
  const slash = ref.lastIndexOf("/");
  const name = slash !== -1 ? ref.slice(slash + 1) : ref;
  const firstDot = name.indexOf(".");
  return firstDot !== -1 ? name.slice(0, firstDot) : name;
}

function tooltipText(ack: AckIndication, defaultPhrase: string): string {
  const parts = [ack.text ?? defaultPhrase];
  if (ack.ref) parts.push(ack.ref);
  return parts.join(" · ");
}

/**
 * Single ack rendered as an icon-only badge. On press, opens a details
 * popover with the kind label, optional inner text, and ref link. The
 * native title attribute provides the same info on hover for pointer
 * users.
 */
export function AckIndicator({ ack, className }: { ack: AckIndication; className?: string }) {
  const descriptor = getAckKind(ack.kind);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: MouseEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  if (!descriptor) return null;

  const title = tooltipText(ack, descriptor.defaultPhrase);

  return (
    <span ref={containerRef} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${descriptor.defaultPhrase}${ack.text ? ` — ${ack.text}` : ""}`}
        title={title}
        className={cn(
          "inline-flex items-center justify-center w-6 h-6 rounded-full",
          "bg-accent text-white shadow-sm",
          "hover:bg-accent-dark transition-colors",
          "text-sm leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        )}
      >
        <span aria-hidden>{descriptor.icon}</span>
      </button>
      {open ? (
        <span
          role="dialog"
          className="absolute right-0 top-full mt-1 z-10 min-w-[12rem] max-w-xs rounded shadow-lg border border-warm-200 bg-white px-3 py-2 text-xs text-warm-700"
        >
          <span className="block font-medium text-warm-900">{descriptor.defaultPhrase}</span>
          {ack.text ? <span className="block mt-1">{ack.text}</span> : null}
          {ack.ref ? (
            <span className="block mt-1 text-warm-500 truncate" title={ack.ref}>
              {refLabel(ack.ref)}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Cluster of acks rendered as a tight row of icons. Positioned by the
 * caller — typically in the top-right of the assistant message, sharing
 * space with the speech icon.
 */
export function AckCluster({ acks, className }: { acks: AckIndication[]; className?: string }) {
  if (acks.length === 0) return null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {acks.map((ack, i) => <AckIndicator key={i} ack={ack} />)}
    </span>
  );
}
