/**
 * Renders a single `<ack>` indication as a small inline chip.
 * Icon + earcon are the primary expression; inner text is optional.
 * The chip is a tap target when a `ref` is present.
 *
 * See `lib/structured-output-parsing.ts` for the data model and
 * `docs/narration-mode-design.md` for the design rationale.
 */

import { getAckKind, type AckIndication } from "../../lib/structured-output-parsing";
import { useParams } from "@tanstack/react-router";
import { href } from "../../lib/routing";
import { cn } from "../../lib/cn";

export function AckIndicator({ ack, className }: { ack: AckIndication; className?: string }) {
  const { boxSlug } = useParams({ strict: false });
  const descriptor = getAckKind(ack.kind);
  if (!descriptor) return null;

  const label = ack.text ?? descriptor.defaultPhrase;
  const refDisplay = ack.ref ? refLabel(ack.ref) : null;

  const inner = (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span aria-hidden className="text-sm leading-none">{descriptor.icon}</span>
      <span className="font-medium">{label}</span>
      {refDisplay ? (
        <span className="text-warm-500 truncate max-w-[12rem]">{refDisplay}</span>
      ) : null}
    </span>
  );

  const chipClasses = cn(
    "inline-flex items-center px-2 py-0.5 rounded-full",
    "bg-warm-100 text-warm-700 border border-warm-200",
    className,
  );

  if (ack.ref && boxSlug) {
    return (
      <a
        href={href(`/${boxSlug}/view`) + `?path=${encodeURIComponent(ack.ref)}`}
        className={cn(chipClasses, "hover:bg-warm-200 transition-colors")}
        title={ack.ref}
      >
        {inner}
      </a>
    );
  }

  return <span className={chipClasses}>{inner}</span>;
}

/**
 * Render a group of acks as a horizontal-wrapping row.
 */
export function AckRow({ acks, className }: { acks: AckIndication[]; className?: string }) {
  if (acks.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5 mt-2", className)}>
      {acks.map((ack, i) => <AckIndicator key={i} ack={ack} />)}
    </div>
  );
}

function refLabel(ref: string): string {
  const slash = ref.lastIndexOf("/");
  const name = slash !== -1 ? ref.slice(slash + 1) : ref;
  // Strip the .type.card / .ext suffixes for compactness; full path is in the tooltip.
  const firstDot = name.indexOf(".");
  return firstDot !== -1 ? name.slice(0, firstDot) : name;
}
