/**
 * The template definition shape and its variance-erasing helper. A leaf
 * module with no dependency on the registry store (`templates-registry.ts`)
 * or the built-in template groups (`templates.ts`): both of those depend on
 * this module, so keeping it dependency-free is what lets `templates.ts`
 * (built-in groups) and `templates-registry.ts` (the store, which loads
 * `templates.ts` at its own module load) sit in a single direction without an
 * import cycle. `templates-registry.ts` re-exports `TemplateDefinition` for
 * its existing consumers.
 */
import { type z, type ZodObject, type ZodRawShape } from "zod";

/**
 * Template definition with typed arguments.
 */
export interface TemplateDefinition<T extends ZodRawShape = ZodRawShape> {
  /** Unique template name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Zod schema for arguments */
  argsSchema: ZodObject<T>;
  /** Function to generate card content */
  generate: (args: z.infer<ZodObject<T>>) => string;
  /**
   * Optional starter files written into the new card's attach scope. Each
   * `relPath` is relative to `<basename>.attach/` (e.g. "sketch.ts"). Used by
   * card types whose body points at a runnable attachment (figures), so a
   * single `bbx create` scaffolds a working card + its source.
   */
  attachments?: (args: z.infer<ZodObject<T>>) => Array<{ relPath: string; content: string }>;
  /** Card types this template can create (e.g., "memo", "question") */
  cardTypes: string[];
  /** If set, this template is the default when creating cards of these types */
  defaultForTypes?: string[];
}

/**
 * Type-erase one template definition's concrete argument shape so a set of
 * definitions with different `T`s can share one `TemplateDefinition[]` list
 * (a builtins catalogue file, the registry's own storage). `generate`/
 * `attachments` are contravariant in the arg type, so a concrete-shape
 * definition isn't assignable to the erased `TemplateDefinition<ZodRawShape>`
 * a list of them is typed as. Sound because an erased definition is only ever
 * read back and invoked with the args its own `argsSchema` parsed, never
 * another member's.
 */
export function eraseTemplateArgs<T extends ZodRawShape>(definition: TemplateDefinition<T>): TemplateDefinition {
  // eslint-disable-next-line no-restricted-syntax -- variance bridge, see doc comment above
  return definition as unknown as TemplateDefinition;
}
