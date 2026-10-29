/** Select representations (whole, or a leading excerpt when one is too large) while budgeting the actual serialized request. */
import * as path from "node:path";
import { parseFrontmatterObject, splitCardContent } from "../../../exports/cards.js";
import { parseRef, resolveRefPath } from "../../../shared/ref-path/core.js";
import { invariant } from "../../../shared/invariant.js";
import { JEV_MAX_REQUEST_CHARS } from "../../../services/jev-wire.js";
import type { Evidence } from "./core.js";
import type { InstructionSnapshot } from "../snapshot.js";
import { serializeTriageRequest } from "../request.js";

type Part = Evidence["parts"][number];
interface Representations {
  owners: Map<string, string>;
  textLayers: Map<string, string>;
  pages: Map<string, string>;
  sidecars: Set<string>;
}
export function fieldRef(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("ref" in value)) return undefined;
  return typeof value.ref === "string" ? value.ref : undefined;
}
function attachmentRef(card: string, ref: string): string {
  const relative = resolveRefPath({ fromPath: card, ref: parseRef(ref).path, kind: "card" });
  invariant(relative !== null, `Invalid PDF attachment ref: ${ref}`);
  return `/${relative}`;
}

/** Only the PDF card's declared local source and generated derivatives qualify. */
export function scanRepresentations(parts: Part[], manifestRefs?: string[]): Representations {
  const result: Representations = { owners: new Map(), textLayers: new Map(), pages: new Map(), sidecars: new Set() };
  const refs = manifestRefs ?? parts.map((part) => part.ref);
  for (const part of parts) {
    if (!part.ref.endsWith(".pdf.card")) continue;
    const fields = parseFrontmatterObject(part.text);
    if (!fields) continue;
    const filename = fieldRef(fields.filename);
    if (filename === undefined || !/^attach\/[^/]+\.pdf$/u.test(filename)) continue;
    const source = attachmentRef(part.ref, filename);
    const layer = attachmentRef(part.ref, "attach/text-layer.txt");
    result.textLayers.set(source, layer);
    if (fields.status === "analyzed" && splitCardContent(part.text).body.trim()) {
      result.owners.set(source, part.ref);
      result.owners.set(layer, part.ref);
      for (const ref of refs) {
        const name = path.posix.basename(ref);
        if (/^page-\d{3,}\.(?:avif|webp)$/u.test(name) && attachmentRef(part.ref, `attach/${name}`) === ref) {
          result.pages.set(ref, part.ref);
        }
      }
    }
    if (fieldRef(fields.docling) === "attach/docling.json.gz") result.sidecars.add(attachmentRef(part.ref, "attach/docling.json.gz"));
  }
  return result;
}

type Budget = "Text" | "Serialized request";
interface Selection {
  selected: Set<string>;
  textLimited: Set<string>;
  /** Selected parts sent as a leading excerpt: characters kept and the budget that cut the rest. */
  excerpts: Map<string, { chars: number; budget: Budget }>;
  representations: Representations;
}
/** Below this, an excerpt carries too little to judge; the part is excluded with an omission instead. */
const MIN_EXCERPT_CHARS = 200;
function excerptPart(part: Part, excerpt: { chars: number; budget: Budget }): Part {
  return { ...part, text: part.text.slice(0, excerpt.chars), status: "partial",
    omissions: [...part.omissions, `Excerpt: the first ${String(excerpt.chars)} of ${String(part.text.length)} characters; the ${excerpt.budget.toLowerCase()} budget excluded the rest`] };
}
function selectedTexts(parts: Part[]): Map<string, string> {
  const texts = new Map<string, string>();
  for (const part of parts) {
    if (!texts.has(part.text)) texts.set(part.text, part.ref);
  }
  return texts;
}
function representedPart(part: Part, ref: string): Part {
  // Representation selection is not a claim that its bytes equal the original.
  // The selected card/layer carries its own omissions; the original keeps its digest.
  return { ...part, text: "", method: "representation-selected", duplicateOf: ref, status: "ready", omissions: [] };
}
function renderSelection(evidence: Evidence, selection: Selection): Evidence {
  const { selected, textLimited, excerpts, representations } = selection;
  const retained = evidence.parts.filter((part) => selected.has(part.ref));
  const texts = selectedTexts(retained);
  const bodies = new Map<string, string>();
  for (const part of retained) {
    if (!part.ref.endsWith(".card")) continue;
    const body = splitCardContent(part.text).body;
    if (body.trim()) bodies.set(body, part.ref);
  }
  const parts = evidence.parts.map((part): Part => {
    const pageOwner = representations.pages.get(part.ref);
    if (pageOwner !== undefined && selected.has(pageOwner)) return representedPart(part, pageOwner);
    const owner = representations.owners.get(part.ref);
    if (owner !== undefined && selected.has(owner)) return representedPart(part, owner);
    const layer = representations.textLayers.get(part.ref);
    if (layer !== undefined && selected.has(layer)) return representedPart(part, layer);
    const excerpt = excerpts.get(part.ref);
    if (excerpt !== undefined && selected.has(part.ref)) return excerptPart(part, excerpt);
    if (!part.text || selected.has(part.ref)) return { ...part, omissions: [...part.omissions] };
    const duplicate = texts.get(part.text) ?? (part.ref.endsWith(".card") ? undefined : bodies.get(part.text));
    if (duplicate !== undefined) return { ...part, text: "", method: "duplicate-text", duplicateOf: duplicate, omissions: [...part.omissions] };
    const budget: Budget = textLimited.has(part.ref) ? "Text" : "Serialized request";
    return { ...part, text: "", status: "unavailable", omissions: [...part.omissions, `${budget} budget excluded all ${String(part.text.length)} characters of this part`] };
  });
  const status = !parts.some((part) => part.text.trim()) ? "unavailable" : parts.every((part) => part.status === "ready") ? "ready" : "partial";
  return { ...evidence, status, parts, recipe: { ...evidence.recipe, steps: parts.map((part) => `${part.ref}: ${part.method}`) } };
}

/** Parts that are versions of one PDF: the source, its text layer and its analyzed card. */
function representationGroup(representations: Representations, ref: string): string[] {
  for (const [source, layer] of representations.textLayers) {
    const group = [source, layer, representations.owners.get(source)].filter((member) => member !== undefined);
    if (group.includes(ref)) return group;
  }
  return [ref];
}

/**
 * Rebuild all metadata for every trial, so no late duplicate marker can overflow.
 * Whole parts come first. With `excerpts`, a part still excluded afterwards, whose
 * document no other selected representation covers, sends a leading excerpt.
 * Callers enable it only after deferred PDF and page fallbacks are resolved.
 */
export function packEvidence(evidence: Evidence, options: { instructions: InstructionSnapshot; excerpts?: boolean }): Evidence {
  const { instructions } = options;
  const selection: Selection = { selected: new Set(), textLimited: new Set(), excerpts: new Map(), representations: scanRepresentations(evidence.parts) };
  const maxRequestChars = evidence.recipe.maxRequestChars ?? JEV_MAX_REQUEST_CHARS;
  const fits = (trial: Evidence): boolean => serializeTriageRequest({ evidence: trial, instructions }).length <= maxRequestChars;
  let packed = renderSelection(evidence, selection);
  let remaining = evidence.recipe.maxTextChars;
  for (const candidate of evidence.parts) {
    if (!candidate.text.trim()) continue;
    const current = packed.parts.find((part) => part.ref === candidate.ref);
    if (current?.method === "representation-selected" || current?.method === "duplicate-text") continue;
    if (candidate.text.length > remaining) {
      selection.textLimited.add(candidate.ref);
      packed = renderSelection(evidence, selection);
      continue;
    }
    selection.selected.add(candidate.ref);
    const trial = renderSelection(evidence, selection);
    if (fits(trial)) {
      packed = trial;
      remaining -= candidate.text.length;
    } else selection.selected.delete(candidate.ref);
  }
  if (options.excerpts) {
    for (const candidate of evidence.parts) {
      const current = packed.parts.find((part) => part.ref === candidate.ref);
      if (!candidate.text.trim() || current?.status !== "unavailable" || current.method === "representation-selected" || current.method === "duplicate-text") continue;
      if (representationGroup(selection.representations, candidate.ref).some((member) => selection.selected.has(member))) continue;
      const excerpted = excerptWithin({ evidence, selection, fits }, { ref: candidate.ref, max: Math.min(remaining, candidate.text.length - 1), budget: candidate.text.length > remaining ? "Text" : "Serialized request" });
      if (excerpted === null) continue;
      packed = excerpted;
      remaining -= selection.excerpts.get(candidate.ref)?.chars ?? 0;
    }
  }
  invariant(fits(packed),
    `Serialized Jev request exceeds request budget ${String(maxRequestChars)} characters even with all evidence parts excluded`);
  return packed;
}

/** Select the largest leading excerpt of at most `max` characters whose request still fits; null below the minimum. */
function excerptWithin(
  context: { evidence: Evidence; selection: Selection; fits: (trial: Evidence) => boolean },
  target: { ref: string; max: number; budget: Budget },
): Evidence | null {
  const { evidence, selection, fits } = context;
  let low = MIN_EXCERPT_CHARS;
  let high = target.max;
  let best: { chars: number; packed: Evidence } | null = null;
  selection.selected.add(target.ref);
  while (low <= high) {
    const chars = Math.floor((low + high) / 2);
    selection.excerpts.set(target.ref, { chars, budget: target.budget });
    const trial = renderSelection(evidence, selection);
    if (fits(trial)) { best = { chars, packed: trial }; low = chars + 1; } else high = chars - 1;
  }
  if (best === null) {
    selection.selected.delete(target.ref);
    selection.excerpts.delete(target.ref);
    return null;
  }
  selection.excerpts.set(target.ref, { chars: best.chars, budget: target.budget });
  return best.packed;
}
