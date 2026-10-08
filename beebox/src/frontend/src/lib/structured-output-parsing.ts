/**
 * Parse the structured-output tags the agent emits in chat responses:
 * `<ack>` (transient action indications) and `<callout>` (durable,
 * self-contained content). Both are rendered separately from the prose
 * markdown — see `AckIndicator` and `CalloutBlock` components, and the
 * design doc `docs/plans/narration-mode.md`.
 *
 * Parsing is regex-based and tolerant: unknown ack kinds and callouts
 * missing a `context` attribute are dropped with a console warning
 * rather than failing the whole render.
 */

import { stripChatAppTags } from "../../../shared/chat-tags.js";
import { decodeXmlAttr } from "../../../shared/self-note.js";

export interface AckKindDescriptor {
  /** Stable identifier used as the `kind` attribute value. */
  readonly kind: string;
  /** Default phrase rendered when inner text is empty. */
  readonly defaultPhrase: string;
  /** Unicode icon used as the visual marker. Earcon TBD. */
  readonly icon: string;
}

const ACK_KINDS: readonly AckKindDescriptor[] = [
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
    // Both groups are mandatory (no alternation before them), so a
    // successful match always populates them; the `?? ""` fallbacks are
    // unreachable but honest to the regex-match type.
    const name = m[1] ?? "";
    const value = m[2] ?? "";
    out.set(name, decodeXmlAttr(value));
  }
  return out;
}

/**
 * The agent sometimes writes an ack kind as a bare tag name — `<no-response/>`,
 * `<todo-added>`, `<created ref="…">detail</created>` — instead of the
 * canonical `<ack kind="…">`. Normalize every registered kind (self-closing,
 * paired, or a lone opening tag) so parse / strip / no-response detection
 * treat the alias and the canonical form identically, rather than leaking the
 * raw tag into the prose render. Attributes and inner text carry over.
 *
 * Markdown code is left alone: a fenced block or an inline code span showing
 * `<created>` is an example, not an ack.
 */
// Lists every `ACK_KINDS` kind; the doctest checks that each one normalizes.
const ACK_KIND_ALIAS_RE =
  /<(created|appended|edited|todo-added|todo-completed|no-response)(?=[\s/>])([^>]*?)(?:\/\s*>|>(?:([\S\s]*?)<\/\1\s*>)?)/gi;

// A fenced block (closed by a matching fence or by the end of the content) or
// an inline code span (a backtick run closed by a run of the same length).
const MARKDOWN_CODE_RE =
  /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n[\S\s]*?(?:^ {0,3}\1[`~]*[\t ]*$|(?![\S\s]))|(?![\S\s]))|(?<!`)(`+)(?!`)[\S\s]*?(?<!`)\2(?!`)/gm;

function markdownCodeRanges(content: string): Array<[number, number]> {
  return [...content.matchAll(MARKDOWN_CODE_RE)].map((m) => [m.index, m.index + m[0].length]);
}

function normalizeAckAliases(content: string): string {
  const code = markdownCodeRanges(content);
  // A shared global regex: start from 0; the loop runs to a null match, which
  // resets it again.
  const re = ACK_KIND_ALIAS_RE;
  re.lastIndex = 0;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const start = m.index;
    const inCode = code.find(([from, to]) => start >= from && start < to);
    if (inCode !== undefined) {
      re.lastIndex = inCode[1];
      continue;
    }
    // Groups 1 and 2 precede the alternation, so they are always defined;
    // group 3 participates only in the paired branch (`.at()` keeps it
    // honestly `string | undefined`).
    const kind = (m[1] ?? "").toLowerCase();
    const attrs = (m[2] ?? "").replace(/\s+$/, "");
    const inner = m.at(3);
    const open = `<ack kind="${kind}"${attrs}`;
    out += content.slice(last, start) + (inner === undefined ? `${open}/>` : `${open}>${inner}</ack>`);
    last = start + m[0].length;
  }
  return out + content.slice(last);
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
    // Group 1 precedes the alternation, so it's always defined; group 2 is
    // inside the paired-tag branch of the alternation and is genuinely
    // undefined when the self-closing branch matches instead (TS's
    // RegExpExecArray typing doesn't model per-branch participation).
    // `.at()` (not `m[2]`) keeps that honestly `string | undefined`.
    const attrs = parseAttrs(m[1] ?? "");
    const innerRaw = m.at(2);
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
    // Neither group is inside an alternation, so both are always defined
    // on a successful match; the `?? ""` fallbacks are unreachable but
    // honest to the regex-match type.
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
