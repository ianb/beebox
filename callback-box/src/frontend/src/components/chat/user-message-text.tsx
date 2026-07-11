/**
 * The keyword-pill / selection-pill text renderer for a user message body.
 * Split out of user-message.tsx to keep that file under the line limit —
 * this is the self-contained "send"/"user-selection" tag parsing + display.
 */

import { stripUserDisplayTags } from "./message-parsing";

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&");
}

const REF_ATTR_RE = /\bref="([^"]*)"/i;
const POSITION_ATTR_RE = /\bpos="([^"]*)"/i;
const PLACEMENT_ATTR_RE = /\bplacement="([^"]*)"/i;

function readAttr(attrs: string, re: RegExp): string {
  const match = re.exec(attrs)?.[1];
  return match !== undefined ? decodeXml(match) : "";
}

function docBasename(ref: string): string {
  const base = ref.split("/").pop();
  if (base === undefined || base === "") return ref;
  return base.endsWith(".card") ? base.slice(0, -5) : base;
}

function snippet(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

/** Pill shown in a sent user message for an attached document selection. */
function MessageSelectionPill({ text, sourceRef, position, placement }: { text: string; sourceRef: string; position: string; placement: string }) {
  const titleParts = [`"${text}"`, docBasename(sourceRef)];
  if (position !== "") titleParts.push(position);
  if (placement !== "") titleParts.push(placement);
  return (
    <span
      className="inline-flex items-center gap-1 bg-white/20 rounded-full px-2 py-0.5 text-xs font-medium align-baseline"
      title={titleParts.join(" — ")}
    >
      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h4m3 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span className="truncate max-w-[12rem]">{snippet(text, 32)}</span>
    </span>
  );
}

type MessagePart =
  | { type: "text"; value: string }
  | { type: "send"; phrase: string }
  | { type: "selection"; text: string; sourceRef: string; position: string; placement: string };

export function UserMessageText({ text }: { text: string }) {
  const stripped = stripUserDisplayTags(text);

  const parts: MessagePart[] = [];
  // Pills: <send-message phrase="…"/> / <send-close-message phrase="…"/> (voice
  // keyword — plain send and the "send and close" sign-off render the same pill)
  // and <user-selection ref="…" pos="…">quoted text</user-selection> (attached
  // document text).
  const tagRe = /<send(?:-close)?-message\s+phrase="([^"]*?)"\s*\/>|<user-selection\b([^>]*)>([\S\s]*?)<\/user-selection>/gi;
  let lastIndex = 0;
  let match;
  while ((match = tagRe.exec(stripped)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: stripped.slice(lastIndex, match.index) });
    }
    // `.at()` (not `match[n]`): the pattern alternates between two
    // capture-group sets, so whichever branch DIDN'T match has its groups
    // genuinely undefined at runtime — but TS's built-in RegExpExecArray
    // types a plain index read as always `string` (it doesn't model
    // alternation), whereas `.at()` is honestly `string | undefined`.
    const sendPhrase = match.at(1);
    const selectionAttrs = match.at(2);
    const selectionText = match.at(3);
    if (sendPhrase !== undefined) {
      parts.push({ type: "send", phrase: sendPhrase.replace(/&quot;/g, '"').replace(/&amp;/g, "&") });
    } else {
      const attrs = selectionAttrs ?? "";
      parts.push({
        type: "selection",
        text: decodeXml(selectionText ?? ""),
        sourceRef: readAttr(attrs, REF_ATTR_RE),
        position: readAttr(attrs, POSITION_ATTR_RE),
        placement: readAttr(attrs, PLACEMENT_ATTR_RE),
      });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < stripped.length) {
    parts.push({ type: "text", value: stripped.slice(lastIndex) });
  }

  const hasPill = parts.some((p) => p.type !== "text");
  if (!hasPill) {
    return <>{stripped.trim()}</>;
  }

  return (
    <>
      {parts.map((p, i) => {
        if (p.type === "text") {
          return <span key={i}>{p.value}</span>;
        }
        if (p.type === "selection") {
          return <MessageSelectionPill key={i} text={p.text} sourceRef={p.sourceRef} position={p.position} placement={p.placement} />;
        }
        return (
          <span key={i} className="inline-flex items-center gap-1 bg-white/20 rounded-full px-2 py-0.5 text-xs font-medium">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            {p.phrase}
          </span>
        );
      })}
    </>
  );
}
