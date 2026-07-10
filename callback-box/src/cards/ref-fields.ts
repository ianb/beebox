/**
 * Ref-field constructors that make a schema author choose, at declaration time,
 * whether a `{ ref }` field's target is safe to auto-inline into an agent prompt.
 *
 * A job card's refs get their target files read and dropped verbatim into the
 * reactor prompt (`core/reactor/batch-jobs.ts`). For a ref that points at a
 * metadata card (an inbox item, a chat thread) that's the intended behaviour.
 * For a ref that points at raw external bytes — the canonical case is an
 * email-message's `body-file`, a `.txt` of attacker-authored email content —
 * auto-inlining would feed untrusted content straight into context. Which one a
 * ref is cannot be inferred from its shape (`{ ref: string }` either way), so it
 * must be declared:
 *
 *  - {@link cardRef} — the target is a card safe to auto-inline (metadata).
 *  - {@link opaqueContentRef} — the target is opaque; NEVER auto-inline it. An
 *    agent that needs the bytes must read the file deliberately.
 *
 * {@link collectInlineRefs} walks a schema + its parsed value together and
 * returns only the inline-safe refs. **Default (an un-migrated bare
 * `z.object({ ref: z.string() })`) is treated as inline** — that preserves the
 * pre-distinction behaviour, where every ref was inlined. Opacity is opt-in, so
 * a schema author must consciously mark a content ref opaque; the mechanism
 * fails open to the legacy behaviour rather than silently dropping refs.
 *
 * The kind rides on the schema via zod 4's `.meta()` (retrievable with
 * `.meta()`), not on the parsed value — a brand on the value would launder
 * across the JSON/YAML round-trip the card takes to disk (the serialization
 * boundary the trust-marking research flags), whereas the schema is the durable
 * source of truth consulted at inline time.
 */

import { z, type ZodType } from "zod";
import { isRecord } from "../lib/is-record.js";

/** Metadata key carrying a ref field's inline-safety kind (see module comment). */
const REF_KIND_META = "callbackBoxRefKind";

type RefKind = "card" | "opaque";

/**
 * The zod shape both constructors produce: `{ ref: string }`. The return type is
 * this precise ZodObject (not a widened `ZodType`) so `z.infer`/`InferCardFields`
 * still see `{ ref: string }` at the field — only the attached ref-kind meta,
 * read at inline time, distinguishes the two.
 */
type RefSchema = z.ZodObject<{ ref: z.ZodString }>;

/**
 * A ref to a card whose full text is SAFE to auto-inline into a prompt — the
 * target is box-authored metadata (an inbox item, a chat thread, a followup
 * question). Shape is `{ ref: string }`.
 */
export function cardRef(): RefSchema {
  return z.object({ ref: z.string() }).meta({ [REF_KIND_META]: "card" satisfies RefKind });
}

/**
 * A ref to OPAQUE content that must never be auto-inlined into a prompt — raw
 * external bytes (an email body file, a fetched page) an agent must choose to
 * read. Shape is `{ ref: string }`, identical on disk to {@link cardRef}; only
 * the inline treatment differs. {@link collectInlineRefs} skips these.
 */
export function opaqueContentRef(): RefSchema {
  return z.object({ ref: z.string() }).meta({ [REF_KIND_META]: "opaque" satisfies RefKind });
}

/** The declared ref-kind of `schema`, or null if it carries none. */
function refKindOf(schema: ZodType): RefKind | null {
  const kind = schema.meta()?.[REF_KIND_META];
  return kind === "card" || kind === "opaque" ? kind : null;
}

/** Wrapper defs whose `innerType` we peel through to reach a tagged/core schema. */
const WRAPPER_TYPES = new Set(["optional", "nullable", "default", "nonoptional", "readonly", "catch"]);

/**
 * Peel `.optional()`/`.default()`/etc. wrappers off `schema` to reach the schema
 * that carries the shape (and any ref-kind meta), stopping as soon as a tagged
 * ref schema is found. Uses zod 4's `_zod.def` introspection — localized here
 * and exercised by the doctest so a zod internals change fails loudly.
 */
function unwrap(schema: ZodType): ZodType {
  let current = schema;
  // A ref tag lives on the object schema itself; stop the moment we see one.
  while (refKindOf(current) === null) {
    // eslint-disable-next-line no-restricted-syntax -- reads zod 4's loosely-typed `_zod.def` internals; localized here and guarded by the doctest so a zod change fails loudly (see fn comment)
    const def = current._zod.def as { type: string; innerType?: ZodType };
    if (WRAPPER_TYPES.has(def.type) && def.innerType !== undefined) {
      current = def.innerType;
      continue;
    }
    break;
  }
  return current;
}

/**
 * Collect every inline-safe ref reachable in a card's validated `fields`,
 * consulting `schema` (the card's frontmatter schema) so that
 * {@link opaqueContentRef} fields are skipped and {@link cardRef} (or
 * un-migrated bare) fields are included. `fields` must already have been
 * validated against `schema` (the shapes are walked in lockstep).
 *
 * This is the schema-aware counterpart to `core/card-io.ts`'s convention-only
 * `collectRefs`; use this at the prompt-inlining boundary, `collectRefs` where
 * no schema is available (raw-frontmatter reads).
 */
export function collectInlineRefs(schema: ZodType, fields: Record<string, unknown>): string[] {
  const refs: string[] = [];
  // Walk schema + value in lockstep. Collection is SCHEMA-driven: a value is a
  // ref carrier only where its *schema* declares a `ref` key — so the walk skips
  // opaqueContentRef fields and, in a union, never double-counts a value against
  // a sibling option that doesn't declare `ref`. Descends objects, arrays, and
  // unions (both z.union and z.discriminatedUnion — same internal `union` def).
  const walk = (node: ZodType, value: unknown): void => {
    const core = unwrap(node);
    // eslint-disable-next-line no-restricted-syntax -- reads zod 4's loosely-typed `_zod.def` internals; localized here and guarded by the doctest so a zod change fails loudly
    const def = core._zod.def as {
      type: string;
      shape?: Record<string, ZodType>;
      element?: ZodType;
      options?: readonly ZodType[];
    };
    if (def.type === "object") {
      if (!isRecord(value)) return;
      const declaresRef = def.shape?.["ref"] !== undefined;
      // A declared `ref` field is inlined unless the schema marked it opaque.
      if (declaresRef && refKindOf(core) !== "opaque" && typeof value["ref"] === "string") {
        refs.push(value["ref"]);
      }
      if (def.shape !== undefined) {
        for (const [key, childSchema] of Object.entries(def.shape)) {
          if (key === "ref" && declaresRef) continue; // the ref leaf, handled above
          walk(childSchema, value[key]);
        }
      }
      return;
    }
    if (def.type === "array") {
      if (!Array.isArray(value) || def.element === undefined) return;
      for (const el of value) walk(def.element, el);
      return;
    }
    if (def.type === "union") {
      // The value validated against ONE option; walk them all. Since collection
      // is gated on a declared `ref` key, options that don't declare one no-op,
      // so a `cardRef() | z.object({ href })` union still inlines the ref and
      // doesn't double-count. (Mixing cardRef and opaqueContentRef in one union
      // is undefined — don't.)
      if (def.options !== undefined) {
        for (const option of def.options) walk(option, value);
      }
      return;
    }
    // z.record/z.tuple/z.lazy and other containers are NOT modeled: no schema in
    // the repo declares a ref inside one. This is deliberately fail-CLOSED — an
    // opaque ref hidden in an unmodeled container is never inlined; the cost is
    // that a (hypothetical) cardRef nested there wouldn't inline either. Declare
    // ref fields plainly (object/array/union) so they're seen.
  };
  walk(schema, fields);
  return refs;
}
