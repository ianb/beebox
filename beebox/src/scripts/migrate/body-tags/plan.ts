/**
 * `body-tags-2026-10`: rewrite the four retired type-specific Markdoc tags
 * (`image`, `silence`, `purpose`, `correction`) into plain card shapes. The
 * whole decision, as a pure function of the cards' text, so a test reaches
 * every case with no box on disk; `run.ts` is the IO around it
 * (docs/implemented-plans/retire-type-specific-core-tags.md, Track 4).
 *
 * Tag nodes come from `Markdoc.parse` (no schema needed), which gives each
 * tag its attributes and line span and tells a real tag from one quoted in a
 * code fence or nested in another tag. Per card:
 *
 * 1. The root briefing whose sha256 is a `briefing-seed` stock hash becomes
 *    `options.seed` verbatim; nothing else runs on it.
 * 2. `{% image ref="X" /%}` becomes `[<stem>](X)`; `{% silence duration="D" /%}`
 *    becomes `— D silence —`. Any card type. The tag's source text is replaced
 *    within its line span.
 * 3. In `*.briefing.card` only: one block `purpose` becomes frontmatter
 *    `purpose` (after `type`); each block `correction` leaves the body and
 *    becomes a bullet under a final `## Corrections` heading.
 * 4. A card with none of the four tags is skipped.
 *
 * Fail closed (a failure names path and line; the run writes nothing): a tag
 * inside a code fence or another tag; a `purpose`/`correction` that is inline,
 * not a direct child of the document, or in a non-briefing card; two `purpose`
 * blocks or a different `purpose:` key; an existing `## Corrections` heading;
 * a Markdoc parse error in a card that carries one of the tags (this includes
 * single-quoted attribute values, which Markdoc does not accept).
 */

import { createHash } from "node:crypto";
import type { Node } from "@markdoc/markdoc";
import { isMap, isScalar, parseDocument } from "yaml";
import { splitCardContent } from "../../../cards/frontmatter.js";
import { parseMarkdown } from "../../../shared/markdoc-config/parse/core.js";
import { applyLineEdits, type LineEdit } from "./edit-lines.js";

export const ROOT_BRIEFING_PATH = "_content/briefing.briefing.card";
export const RETIRED_TAGS: ReadonlySet<string> = new Set(["image", "silence", "purpose", "correction"]);
/** A cheap pre-filter: any opening or closing tag with one of the four names. */
export const RETIRED_TAG_PATTERN = /{%-?\s*\/?\s*(?:image|silence|purpose|correction)\b/;

export interface CardInput { path: string; text: string }
export interface BodyTagOptions { seed: string; stockSeedHashes: ReadonlySet<string> }
export interface BodyTagWrite { path: string; before: string; after: string }
export interface BodyTagFailure { path: string; line?: number; reason: string }
export interface BodyTagPlan { writes: BodyTagWrite[]; failures: BodyTagFailure[]; skipped: number }

interface Found { node: Node; ancestors: readonly string[] }

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Every retired tag node, with the node types above it, plus the first parse error node. */
function scan(root: Node): { tags: Found[]; error: Node | null; literal: Node | null } {
  const tags: Found[] = [];
  let error: Node | null = null;
  let literal: Node | null = null;
  const visit = (node: Node, ancestors: readonly string[]): void => {
    if (node.type === "error" && error === null) error = node;
    // A retired tag quoted in a code span is text, but it is indistinguishable
    // from the real tag by source text, so the card is left to a person.
    if (node.type === "code" && literal === null && RETIRED_TAG_PATTERN.test(String(node.attributes["content"] ?? ""))) literal = node;
    if (node.type === "tag" && node.tag !== undefined && RETIRED_TAGS.has(node.tag)) tags.push({ node, ancestors });
    for (const child of node.children) visit(child, [...ancestors, node.type]);
  };
  visit(root, []);
  return { tags, error, literal };
}

/** Raw text of the lines between a block tag's open and close lines. */
function innerLines(lines: readonly string[], span: readonly number[]): string[] {
  return lines.slice(span[1], span[2]);
}

/** Inner text of a correction: blank lines collapsed to one space. */
const bulletText = (inner: readonly string[]): string => inner.join("\n").trim().split(/\n\s*\n/).map((p) => p.replaceAll(/\s*\n\s*/g, " ")).join(" ");

function withPurpose(split: ReturnType<typeof splitCardContent>, purpose: string): string | null {
  const doc = parseDocument(split.frontmatterText);
  if (doc.errors.length > 0) return null;
  const existing = isMap(doc.contents) && doc.contents.has("purpose");
  doc.set("purpose", purpose);
  const map = doc.contents;
  if (existing) {
    // The old value was null (anything else is a conflict upstream); a trailing
    // comment on it described the absence, so it does not carry over.
    const value: unknown = doc.get("purpose", true);
    if (isScalar(value)) value.comment = null;
  }
  if (isMap(map) && !existing) {
    // `set` appends; move the new pair to just after `type` (or first).
    const added = map.items.pop();
    const typeAt = map.items.findIndex((pair) => isScalar(pair.key) && pair.key.value === "type");
    if (added !== undefined) map.items.splice(typeAt + 1, 0, added);
  }
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
}

interface Failed { failures: BodyTagFailure[] }
/** The card being planned, and a way to fail it with the path and line filled in. */
interface Where { card: CardInput; fail: (reason: string, node?: Node) => Failed }
interface Collected { edits: LineEdit[]; purposes: Node[]; corrections: Array<{ text: string; test: string | undefined }> }

function whereFor(card: CardInput, lineOffset: number): Where {
  return {
    card,
    fail: (reason, node) => {
      const line = node?.lines[0];
      return { failures: [{ path: card.path, ...(line === undefined ? {} : { line: line + lineOffset + 1 }), reason }] };
    },
  };
}

/** The replace edit for an `image` or `silence` node, or a failure. */
function selfClosing(where: Where, { node, ancestors }: Found): LineEdit | Failed {
  const name = node.tag ?? "";
  const from = node.lines[0] ?? 0;
  if (ancestors.includes("fence") || ancestors.includes("tag")) return where.fail(`{% ${name} %} inside a code fence or another tag; rewrite it by hand`, node);
  if (node.lines.length !== 2) return where.fail(`block-form {% ${name} %}...{% /${name} %} is not supported; rewrite it by hand`, node);
  const attribute = name === "image" ? "ref" : "duration";
  const value = node.attributes[attribute];
  if (typeof value !== "string") return where.fail(`{% ${name} %} has no ${attribute} string`, node);
  if (name === "image" && /[\s()<>[\]]/.test(value)) return where.fail(`the image ref ${JSON.stringify(value)} cannot be written as a markdown link (whitespace or one of ] ( ) < >); rename the card or link it by hand`, node);
  const replacement = name === "image" ? `[${value.replace(/^attach\//, "").replace(/\.image\.card$/, "")}](${value})` : `— ${value} silence —`;
  return { kind: "replace", from, to: node.lines[node.lines.length - 1] ?? from, tag: name, attributes: node.attributes, replacement };
}

/** Sort the found tags into line edits, purposes, and corrections, or fail on the first misplaced one. */
function collect(where: Where, { tags, lines }: { tags: readonly Found[]; lines: readonly string[] }): Collected | Failed {
  const { card } = where;
  const out: Collected = { edits: [], purposes: [], corrections: [] };
  for (const { node, ancestors } of tags) {
    const name = node.tag ?? "";
    const from = node.lines[0] ?? 0;
    if (name === "purpose" || name === "correction") {
      if (!card.path.endsWith(".briefing.card")) return where.fail(`{% ${name} %} is only valid in a briefing card`, node);
      if (node.inline || ancestors.length !== 1 || ancestors[0] !== "document" || node.lines.length < 4) {
        return where.fail(`{% ${name} %} must be a block directly in the body (not inline, in a list, a fence, or another tag); move it by hand`, node);
      }
      out.edits.push({ kind: "remove", from, to: node.lines[3] ?? from });
      if (name === "purpose") out.purposes.push(node);
      else {
        const test = node.attributes["test"];
        if (test !== undefined && typeof test !== "string") return where.fail("{% correction %} test must be a quoted string; fix it by hand", node);
        out.corrections.push({ text: bulletText(innerLines(lines, node.lines)), test: typeof test === "string" && test !== "" ? test : undefined });
      }
      continue;
    }
    const edit = selfClosing(where, { node, ancestors });
    if ("failures" in edit) return edit;
    out.edits.push(edit);
  }
  return out;
}

/** Frontmatter after moving `purpose` in, or a failure. `null` means the frontmatter is already right. */
function mergePurpose(where: Where, { split, node, lines }: { split: ReturnType<typeof splitCardContent>; node: Node; lines: readonly string[] }): string | null | Failed {
  const purpose = innerLines(lines, node.lines).join("\n").trim();
  if (split.hasFrontmatter) {
    const existing: unknown = parseDocument(split.frontmatterText).get("purpose");
    if (existing !== undefined && existing !== null) {
      if (typeof existing === "string" && existing.trim() === purpose) return null;
      return where.fail("a purpose: key already exists with different text; reconcile by hand", node);
    }
  }
  return withPurpose(split, purpose) ?? where.fail("frontmatter does not parse as YAML; fix by hand", node);
}

function planCard(card: CardInput): { after: string | null } | Failed {
  const split = splitCardContent(card.text);
  const where = whereFor(card, split.lineOffset);
  const { tags, error, literal } = scan(parseMarkdown(split.body));
  if (tags.length === 0 && !(error !== null && RETIRED_TAG_PATTERN.test(split.body))) return { after: null };
  if (error !== null) return where.fail("Markdoc cannot parse this body (a malformed or single-quoted tag attribute); fix it by hand", error);
  if (literal !== null) return where.fail("a retired tag is quoted in a code span in this card; rewrite the card by hand", literal);
  const lines = split.body.split("\n");
  const found = collect(where, { tags, lines });
  if ("failures" in found) return found;
  if (found.purposes.length > 1) return where.fail("two {% purpose %} blocks; keep one by hand", found.purposes[1]);
  const edited = applyLineEdits(lines, found.edits);
  if (typeof edited !== "string") return where.fail(edited.reason, tags[edited.index]?.node);
  let body = edited;
  if (found.corrections.length > 0) {
    if (/^#{1,6}\s+Corrections\s*$/m.test(body)) return where.fail("the body already has a Corrections heading; merge by hand", tags[0]?.node);
    const bullets = found.corrections.map((c) => `- ${c.text}${c.test === undefined ? "" : ` Test: ${c.test}`}`).join("\n");
    body = `${body.trim() === "" ? "" : `${body.trim()}\n\n`}## Corrections\n\n${bullets}\n`;
  }
  const prefix = card.text.slice(0, card.text.length - split.body.length);
  const purposeNode = found.purposes[0];
  if (purposeNode === undefined) return { after: `${prefix}${body}` };
  const front = mergePurpose(where, { split, node: purposeNode, lines });
  if (front === null) return { after: `${prefix}${body}` };
  if (typeof front !== "string") return front;
  return { after: `---\n${front}\n---\n${body}` };
}

/** Plan every rewrite for one box. Pure: the same inputs give the same plan. */
export function planBodyTagRewrites(cards: ReadonlyArray<CardInput>, options: BodyTagOptions): BodyTagPlan {
  const plan: BodyTagPlan = { writes: [], failures: [], skipped: 0 };
  for (const card of cards) {
    if (card.path === ROOT_BRIEFING_PATH && options.stockSeedHashes.has(sha256(card.text))) {
      if (card.text === options.seed) plan.skipped++;
      else plan.writes.push({ path: card.path, before: card.text, after: options.seed });
      continue;
    }
    if (!RETIRED_TAG_PATTERN.test(card.text)) { plan.skipped++; continue; }
    const result = planCard(card);
    if ("failures" in result) plan.failures.push(...result.failures);
    else if (result.after === null || result.after === card.text) plan.skipped++;
    else plan.writes.push({ path: card.path, before: card.text, after: result.after });
  }
  return plan;
}
