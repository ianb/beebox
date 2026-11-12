/**
 * Position locator for a text selection inside a rendered document.
 *
 * A selection's `position` is a single freeform string the agent reads as a
 * *rough* hint (not an exact offset) for finding the original text in the
 * source: which section (frontmatter vs body), the nearest heading above it
 * (with its `#id` anchor), the paragraph number, and an approximate source
 * line. Nothing parses it rigidly, so its shape can evolve without a
 * vocabulary migration.
 *
 * Point extraction reads DOM content and source attributes; geometry stays
 * in SelectionCapture.
 */

export interface SelectionParts {
  /** "frontmatter" | "body" | "mixed", or null when undeterminable. */
  section: string | null;
  /** Nearest heading above the selection, with its slug id, or null. */
  heading: { text: string; id: string } | null;
  /** 1-based paragraph number after the nearest heading, or null. */
  paragraph: number | null;
  /** Approximate source line (from the nearest `data-line`), or null. */
  line: number | null;
}

export interface ExtractedSelection {
  text: string;
  position: string;
}

/** A captured selection ready to attach to a message: source ref + the extracted pieces. */
export interface AddSelectionInput {
  /**
   * Box-relative path of the source document, absolute (leading "/"), or null
   * for text quoted from the chat transcript itself — there is no file behind
   * it, and `position` says so in words.
   */
  ref: string | null;
  text: string;
  position: string;
}

/**
 * Render `SelectionParts` into the freeform `position` string. Clauses are
 * omitted when their part is null, joined with "; ". All-null yields "".
 */
export function formatPosition(parts: SelectionParts): string {
  const clauses: string[] = [];
  if (parts.section !== null) {
    clauses.push(parts.section);
  }
  if (parts.heading !== null) {
    clauses.push(`heading: ${parts.heading.text} (#${parts.heading.id})`);
  }
  if (parts.paragraph !== null) {
    clauses.push(`paragraph ${parts.paragraph}`);
  }
  if (parts.line !== null) {
    clauses.push(`~line ${parts.line}`);
  }
  return clauses.join("; ");
}

function nodeToElement(node: Node): Element | null {
  if (node instanceof Element) {
    return node;
  }
  return node.parentElement;
}

/** True when `node` comes after `ref` in document order, or is inside it. */
function nodeFollows(ref: Element, node: Node): boolean {
  if (ref.contains(node)) {
    return true;
  }
  const rel = ref.compareDocumentPosition(node);
  return (rel & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

const TRANSCRIPT_SPEAKERS: Record<string, string> = { user: "user message", assistant: "assistant message" };

/**
 * The `position` for text quoted from the chat transcript: says it came from
 * the chat, and whose message when the selection sits inside one. `startRole`
 * and `endRole` are the `data-role` of the transcript items holding each end.
 */
export function formatTranscriptPosition(startRole: string | null, endRole: string | null): string {
  if (startRole !== endRole) return "chat transcript; spans several messages";
  const speaker = startRole === null ? undefined : TRANSCRIPT_SPEAKERS[startRole];
  return speaker === undefined ? "chat transcript" : `chat transcript; ${speaker}`;
}

function transcriptRole(node: Node, container: Element): string | null {
  const item = nodeToElement(node)?.closest("[data-role]");
  if (item === null || item === undefined || !container.contains(item)) return null;
  return item.getAttribute("data-role");
}

/** Preserve the browser's exact text range while using the source's existing locator. */
export function extractTextSelection(selection: Selection, container: Element): ExtractedSelection | null {
  if (selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const text = selection.toString();
  return range.collapsed || text.trim() === "" ? null : { text, position: positionAt(range.startContainer, container) };
}

export function extractTranscriptTextSelection(selection: Selection, container: Element): ExtractedSelection | null {
  if (selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const text = selection.toString();
  return range.collapsed || text.trim() === "" ? null : {
    text,
    position: formatTranscriptPosition(transcriptRole(range.startContainer, container), transcriptRole(range.endContainer, container)),
  };
}

/** A point selection uses the same rough locator as a text selection. */
function positionAt(anchorNode: Node, container: Element): string {
  const anchorEl = nodeToElement(anchorNode);

  let section: string | null = null;
  if (anchorEl !== null) {
    const sectionEl = anchorEl.closest("[data-card-section]");
    if (sectionEl !== null) {
      section = sectionEl.getAttribute("data-card-section");
    }
  }

  let heading: { text: string; id: string } | null = null;
  let line: number | null = null;
  let nearestHeading: Element | null = null;
  const headings = container.querySelectorAll("h1, h2, h3, h4, h5, h6");
  for (const h of headings) {
    if (nodeFollows(h, anchorNode)) {
      nearestHeading = h;
    }
  }
  if (nearestHeading !== null) {
    const id = nearestHeading.getAttribute("id");
    // `Element.textContent` (unlike the wider `Node.textContent`) is never
    // null per spec — only Document/DocumentType nodes can return null.
    const headingText = nearestHeading.textContent;
    heading = { text: headingText.trim(), id: id === null ? "" : id };
    const dataLine = nearestHeading.getAttribute("data-line");
    if (dataLine !== null) {
      const parsed = parseInt(dataLine, 10);
      line = Number.isNaN(parsed) ? null : parsed;
    }
  }

  let paragraph: number | null = null;
  const paras = container.querySelectorAll("p, .bbx-paragraph");
  let count = 0;
  for (const p of paras) {
    if (nearestHeading !== null && !nodeFollows(nearestHeading, p)) {
      continue;
    }
    count += 1;
    if (p.contains(anchorNode)) {
      paragraph = count;
      break;
    }
  }

  return formatPosition({ section, heading, paragraph, line });
}

// Markdown paragraphs are divs because they may contain embedded block views.
const POINT_BLOCKS = "[data-point-block], .bbx-paragraph, p, li, td, th, tr, figure, img, canvas, svg, [role='img'], pre, blockquote, h1, h2, h3, h4, h5, h6";
const POINT_CONTROLS = "a";
const EXCLUDED_CONTENT = "button, input, textarea, select, [role='button'], [role='menuitem'], [contenteditable='true'], .bbx-system-control, [data-bbx-scan='exclude']";

/** The closest document block wins. A standalone link or control is a fallback. */
export function pointTarget(node: EventTarget | null, container: Element): Element | null {
  const element = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
  if (element === null || !container.contains(element)) return null;
  const excluded = element.closest(EXCLUDED_CONTENT);
  // A zoomable image is wrapped in a button; the image itself remains content.
  const lightboxImage = element.matches("img[data-image-src]") && excluded?.tagName === "BUTTON";
  if (excluded !== null && excluded !== container && container.contains(excluded) && !lightboxImage) return null;
  const block = element.closest(POINT_BLOCKS);
  if (block !== null && container.contains(block)) {
    // An icon inside a link describes the link, not the SVG's paths.
    const control = element.closest(POINT_CONTROLS);
    if (block.tagName.toLowerCase() === "svg" && control !== null && container.contains(control)) return control;
    return block;
  }
  const control = element.closest(POINT_CONTROLS);
  return control !== null && container.contains(control) ? control : null;
}

function visualDescription(target: Element): string {
  const caption = target.closest("figure")?.querySelector("figcaption")?.textContent.trim();
  const label = target.getAttribute("alt")?.trim() || target.getAttribute("aria-label")?.trim() || target.querySelector("title")?.textContent.trim() || caption;
  const source = target.getAttribute("src") ?? target.getAttribute("data-bbx-source");
  const description = label || (source?.startsWith("data:") ? "" : source?.trim()) || "";
  return description === "" ? "" : `Image: ${description.slice(0, 300)}`;
}

/** Extract document content, not nested interface controls such as Copy. */
export function extractPointSelection(target: Element, container: Element): ExtractedSelection | null {
  if (!container.contains(target)) return null;
  const tag = target.tagName.toLowerCase();
  let text: string;
  if (tag === "img" || tag === "canvas" || tag === "svg" || target.getAttribute("role") === "img") {
    text = visualDescription(target);
  } else {
    const clone = target.cloneNode(true);
    if (!(clone instanceof Element)) return null;
    for (const control of clone.querySelectorAll(EXCLUDED_CONTENT)) control.remove();
    for (const lineBreak of clone.querySelectorAll("br")) lineBreak.replaceWith("\n");
    // Code spacing is part of the quote; ordinary prose can collapse inline space.
    text = tag === "pre" ? clone.textContent : clone.textContent.replace(/[\t ]+/g, " ").trim();
    if (text === "" && target.matches(POINT_CONTROLS)) {
      text = target.getAttribute("aria-label")?.trim() ?? "";
    }
  }
  if (text === "") return null;
  const location = positionAt(target, container);
  const detail = tag === "img" || tag === "canvas" || tag === "svg" ? `element: ${tag}` : "";
  return { text, position: [location, detail].filter(Boolean).join("; ") };
}

/** Quote a transcript block with its message speaker as the locator. */
export function extractTranscriptPointSelection(target: Element, container: Element): ExtractedSelection | null {
  const extracted = extractPointSelection(target, container);
  if (extracted === null) return null;
  const role = transcriptRole(target, container);
  return { text: extracted.text, position: formatTranscriptPosition(role, role) };
}
