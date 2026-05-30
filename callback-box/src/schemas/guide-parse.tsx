/**
 * Parse a validated guide element into a typed `ParsedGuide` structure.
 *
 * The guide's children/attrs arrive as cardworks' generic XML AST, which the
 * Zod-inferred `Guide` type models as unions rather than the concrete
 * `ElementNode` shape. The handful of casts that bridge that gap are
 * centralized in the typed helpers below (`childrenOf`, `attrString`) so call
 * sites stay cast-free.
 */

import { type ElementNode } from "cardworks";
import {
  type BeliefSource,
  type ConfidenceLevel,
  type ExperimentStatus,
  type Guide,
  type ParsedGuide,
  type ReactionSentiment,
} from "./guide-elements.js";

// ============================================
// Centralized AST cast helpers
// ============================================

/**
 * An element-like node: anything carrying the `children`/`attrs`/`text` shape
 * of a cardworks `ElementNode`. The Zod-inferred guide types describe these as
 * unions, so we accept the loose shape and narrow it through the helpers.
 */
interface ElementLike {
  children?: unknown;
  attrs?: Record<string, unknown>;
  text?: unknown;
}

/**
 * Return an element's child nodes as a concrete `ElementNode[]`.
 *
 * The cast is sound because every value reaching this code path has already
 * passed `GuideSchema` validation, so `children` is the parsed XML AST — an
 * array of `ElementNode`. The Zod-inferred type merely models it as a union.
 */
function childrenOf(el: ElementLike | undefined): ElementNode[] {
  const children = el?.children ?? [];
  // eslint-disable-next-line no-restricted-syntax -- validated guide AST: children is always ElementNode[]
  return children as ElementNode[];
}

/**
 * Read a string attribute, returning undefined when absent.
 *
 * `attrs` values are typed `string`, but optional attributes may be missing;
 * this narrows to `string | undefined` once so call sites need no cast.
 * `Reflect.get` is used so the dynamic key isn't an object-injection sink.
 */
function attrString(el: ElementLike, name: string): string | undefined {
  const attrs = el.attrs;
  if (!attrs) {
    return undefined;
  }
  const value: unknown = Reflect.get(attrs, name);
  return typeof value === "string" ? value : undefined;
}

/**
 * Read an attribute and narrow it to one of an enum's members, applying a
 * default when the attribute is absent.
 *
 * The cast is sound: the value comes from a guide that already passed
 * `GuideSchema`, where the enum + `.default()` validators guarantee any present
 * attribute is one of `T`'s members. This is the single place the narrowing
 * happens, so call sites stay cast-free.
 */
function attrEnum<T extends string>(
  el: ElementLike,
  { name, fallback }: { name: string; fallback: T }
): T {
  const value = attrString(el, name);
  // eslint-disable-next-line no-restricted-syntax -- validated guide AST: enum attrs are constrained to T by GuideSchema
  return (value ?? fallback) as T;
}

function getChild(children: ElementNode[], tagName: string): ElementNode | undefined {
  return children.find((c) => c.tagName === tagName);
}

function getChildren(children: ElementNode[], tagName: string): ElementNode[] {
  return children.filter((c) => c.tagName === tagName);
}

// ============================================
// Parse
// ============================================

/**
 * Parse a guide element into a typed structure.
 */
export function parseGuide(guide: Guide): ParsedGuide {
  const children = childrenOf(guide);
  const jobTypesAttr = attrString(guide, "job-types");

  const appliesToEl = getChild(children, "applies-to");
  const triageEl = getChild(children, "triage");
  const actionsEl = getChild(children, "actions");
  const experimentsEl = getChild(children, "experiments");
  const reactionsEl = getChild(children, "reactions");
  const contextNotesEl = getChild(children, "context-notes");

  // Parse triage
  const triageChildren = childrenOf(triageEl);
  const triageRules = getChildren(triageChildren, "rule").map((r) => ({
    text: r.text ?? "",
    confidence: attrEnum<ConfidenceLevel>(r, { name: "confidence", fallback: "low" }),
    source: attrEnum<BeliefSource>(r, { name: "source", fallback: "inferred" }),
    ref: attrString(r, "ref"),
    action: attrString(r, "action"),
  }));

  const defaultActionEl = getChild(triageChildren, "default-action");
  const defaultAction = defaultActionEl
    ? {
        action: attrString(defaultActionEl, "action") ?? "",
        text: defaultActionEl.text ?? undefined,
      }
    : undefined;

  // Parse actions
  const actions = getChildren(childrenOf(actionsEl), "action").map((a) => {
    const aChildren = childrenOf(a);
    const whenEl = getChild(aChildren, "when");
    const instrEl = getChild(aChildren, "instructions");
    return {
      name: attrString(a, "name") ?? "",
      when: whenEl?.text ?? undefined,
      instructions: instrEl?.text ?? undefined,
    };
  });

  // Parse experiments
  const experiments = getChildren(childrenOf(experimentsEl), "experiment").map((e) => {
    const expChildren = childrenOf(e);
    const hypothesisEl = getChild(expChildren, "hypothesis");
    const approachEl = getChild(expChildren, "approach");
    const conclusionEl = getChild(expChildren, "conclusion");
    const observationEls = getChildren(expChildren, "observation");

    return {
      id: attrString(e, "id") ?? "",
      status: attrEnum<ExperimentStatus>(e, { name: "status", fallback: "proposed" }),
      createdAt: attrString(e, "created-at"),
      updatedAt: attrString(e, "updated-at"),
      hypothesis: hypothesisEl?.text,
      approach: approachEl?.text,
      observations: observationEls.map((o) => ({
        text: o.text ?? "",
        ref: attrString(o, "ref"),
        date: attrString(o, "date"),
      })),
      conclusion: conclusionEl?.text,
    };
  });

  // Parse reactions
  const reactions = getChildren(childrenOf(reactionsEl), "reaction").map((r) => ({
    id: attrString(r, "id") ?? "",
    sentiment: attrEnum<ReactionSentiment>(r, { name: "sentiment", fallback: "neutral" }),
    text: r.text ?? "",
  }));

  // Parse context notes
  const contextNotes = getChildren(childrenOf(contextNotesEl), "context").map((c) => ({
    text: c.text ?? "",
    duration: attrEnum<"ongoing" | "temporary" | "past">(c, {
      name: "duration",
      fallback: "ongoing",
    }),
    addedAt: attrString(c, "added-at"),
  }));

  return {
    version: attrString(guide, "version") ?? "",
    jobTypes: jobTypesAttr ? jobTypesAttr.split(/\s+/).filter(Boolean) : [],
    appliesTo: appliesToEl?.text ?? undefined,
    triageRules,
    defaultAction,
    actions,
    experiments,
    reactions,
    contextNotes,
  };
}
