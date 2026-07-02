/**
 * Parse the structured-output tags the agent emits in chat responses:
 * `<ack>` (transient action indications) and `<callout>` (durable,
 * self-contained content). Both are rendered separately from the prose
 * markdown — see `AckIndicator` and `CalloutBlock` components, and the
 * design doc `docs/implemented-plans/narration-mode-design.md`.
 *
 * Parsing is regex-based and tolerant: unknown ack kinds and callouts
 * missing a `context` attribute are dropped with a console warning
 * rather than failing the whole render.
 */

import { stripChatAppTags } from "../../../core/chat-features";
import { decodeXmlAttr } from "../../../core/self-note";

export interface AckKindDescriptor {
  /** Stable identifier used as the `kind` attribute value. */
  readonly kind: string;
  /** Default phrase rendered when inner text is empty. */
  readonly defaultPhrase: string;
  /** Unicode icon used as the visual marker. Earcon TBD. */
  readonly icon: string;
}

export const ACK_KINDS: readonly AckKindDescriptor[] = [
  { kind: "created",        defaultPhrase: "Created",        icon: "✨" },
  { kind: "appended",       defaultPhrase: "Added to it",    icon: "＋" },
  { kind: "edited",         defaultPhrase: "Edited",         icon: "✎"  },
  { kind: "todo-added",     defaultPhrase: "Added to todos", icon: "📋" },
  { kind: "todo-completed", defaultPhrase: "Done",           icon: "✓"  },
  { kind: "no-response",    defaultPhrase: "No response",    icon: "✓"  },
] as const;

const ACK_KIND_INDEX = new Map<string, AckKindDescriptor>(
  ACK_KINDS.map((k) => [k.kind, k]),
);

export function getAckKind(kind: string): AckKindDescriptor | null {
  return ACK_KIND_INDEX.get(kind) ?? null;
}

export interface AckIndication {
  /** Validated against the closed kind set; never an unknown value. */
  kind: string;
  /** Affected card or file path; opens as a tap target when present. */
  ref?: string;
  /** Inner text — short modifier shown alongside the kind's default. */
  text?: string;
}

export interface CalloutData {
  /** The "why are you telling me this" label, rendered as an eyebrow. */
  context: string;
  /** The standalone body content. */
  body: string;
}


function parseAttrs(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /([A-Z_a-z][\w-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1];
    const value = m[2];
    if (name === undefined || value === undefined) continue;
    out.set(name, decodeXmlAttr(value));
  }
  return out;
}

/**
 * The agent sometimes writes the bare `<no-response/>` shorthand instead of the
 * canonical `<ack kind="no-response"/>`. Normalize it (self-closing or paired)
 * so parse / strip / no-response detection treat the two identically, rather
 * than leaking the raw tag into the prose render.
 */
const NO_RESPONSE_ALIAS_RE = /<no-response\b[^>]*?(?:\/\s*>|>[\S\s]*?<\/no-response\s*>)/gi;

function normalizeAckAliases(content: string): string {
  return content.replace(NO_RESPONSE_ALIAS_RE, "<ack kind=\"no-response\"/>");
}

/**
 * Parse `<ack kind="…" ref="…">text</ack>` and self-closing variants
 * out of the given content. Unknown kinds emit a console warning and
 * are dropped.
 */
export function parseAcks(content: string): AckIndication[] {
  const out: AckIndication[] = [];
  const re = /<ack\b([^>]*?)(?:\/\s*>|>([\S\s]*?)<\/ack\s*>)/gi;
  content = normalizeAckAliases(content);
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const attrs = parseAttrs(m[1] ?? "");
    const innerRaw = m[2];
    const kind = attrs.get("kind");
    if (kind === undefined) {
      console.warn("[structured-output] Skipping <ack> with no kind");
      continue;
    }
    if (!ACK_KIND_INDEX.has(kind)) {
      console.warn(`[structured-output] Skipping <ack> with unknown kind: ${kind}`);
      continue;
    }
    const ack: AckIndication = { kind };
    const ref = attrs.get("ref");
    if (ref !== undefined && ref.length > 0) ack.ref = ref;
    if (innerRaw !== undefined) {
      const text = innerRaw.trim();
      if (text.length > 0) ack.text = text;
    }
    out.push(ack);
  }
  return out;
}

/**
 * Parse `<callout context="…">body</callout>` blocks out of the given
 * content. Callouts without a `context` attribute are skipped.
 */
export function parseCallouts(content: string): CalloutData[] {
  const out: CalloutData[] = [];
  const re = /<callout\b([^>]*?)>([\S\s]*?)<\/callout\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const attrs = parseAttrs(m[1] ?? "");
    const context = attrs.get("context");
    if (context === undefined || context.length === 0) {
      console.warn("[structured-output] Skipping <callout> with no context");
      continue;
    }
    const body = (m[2] ?? "").trim();
    if (body.length === 0) continue;
    out.push({ context, body });
  }
  return out;
}

/**
 * Strip `<ack>`, `<callout>`, and `<chat-app>` tags from the given
 * content so prose rendering (markdown) doesn't show the raw XML.
 * The structured-output renderers handle these tags separately.
 */
export function stripStructuredOutputTags(content: string): string {
  return stripChatAppTags(normalizeAckAliases(content))
    .replace(/<ack\b[^>]*?(?:\/\s*>|>[\S\s]*?<\/ack\s*>)/gi, "")
    .replace(/<callout\b[^>]*?>[\S\s]*?<\/callout\s*>/gi, "");
}

/**
 * True when the assistant content is just one (or more) no-response acks
 * and nothing else — no prose, no callouts, no other ack kinds. Used by
 * the UI to suppress the empty agent bubble and instead mark the
 * preceding user message as acknowledged.
 */
export function isNoResponseOnly(content: string): boolean {
  const acks = parseAcks(content);
  if (acks.length === 0) return false;
  if (acks.some((a) => a.kind !== "no-response")) return false;
  // After stripping the structured-output tags, anything that remains
  // (callouts, plain prose) means the response isn't purely no-response.
  return stripStructuredOutputTags(content).trim() === "";
}
