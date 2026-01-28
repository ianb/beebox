import { z, type ZodType, type ZodObject, type ZodRawShape } from "zod";
import { CommentsSchema, ProvenanceSchema, TextSegmentSchema } from "./base.js";

/**
 * Base schema for any ElementNode without tag-specific validation.
 */
export const ElementNodeSchema: ZodType<{
  tagName: string;
  attrs: Record<string, string>;
  comments: { start?: string | undefined; end?: string | undefined };
  text?: string | undefined;
  textSegments?: Array<{ text: string; position: number }> | undefined;
  children: unknown[];
  provenance: {
    source: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  dirty: boolean;
}> = z.lazy(() =>
  z.object({
    tagName: z.string(),
    attrs: z.record(z.string(), z.string()),
    comments: CommentsSchema,
    text: z.string().optional(),
    textSegments: z.array(TextSegmentSchema).optional(),
    children: z.array(ElementNodeSchema),
    provenance: ProvenanceSchema,
    dirty: z.boolean(),
  })
);

/**
 * Configuration for the element() helper.
 */
export interface ElementConfig<
  TAttrs extends ZodRawShape = ZodRawShape,
  TChildren extends ZodType = ZodType,
  TText extends ZodType = ZodType,
> {
  /** Attribute schemas */
  attrs?: TAttrs;
  /** Children schema (typically z.array()) */
  children?: TChildren;
  /** Text content schema */
  text?: TText;
  /** Whether this element can contain mixed content (text + elements) */
  mixed?: boolean;
}

/**
 * Helper to create a Zod schema for an XML element with specific tag name.
 *
 * @param tagName - The required tag name for this element
 * @param config - Configuration for attributes, children, and text validation
 * @returns A Zod schema that validates the element structure
 */
export function element<
  TTag extends string,
  TAttrs extends ZodRawShape,
  TChildren extends ZodType,
  TText extends ZodType,
>(
  tagName: TTag,
  config: ElementConfig<TAttrs, TChildren, TText>
): ZodType<{
  tagName: TTag;
  attrs: TAttrs extends ZodRawShape ? z.infer<ZodObject<TAttrs>> : Record<string, string>;
  comments: { start?: string | undefined; end?: string | undefined };
  text?: TText extends ZodType ? z.infer<TText> : string | undefined;
  textSegments?: Array<{ text: string; position: number }> | undefined;
  children: TChildren extends ZodType ? z.infer<TChildren> : unknown[];
  provenance: {
    source: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  dirty: boolean;
}> {
  // Build the attrs schema
  const attrsSchema = config.attrs
    ? z.object(config.attrs)
    : z.record(z.string(), z.string());

  // Build the children schema
  const childrenSchema = config.children ?? z.array(z.unknown());

  // Build the text schema
  const textSchema = config.text ?? z.string().optional();

  // Build the complete schema
  const schema = z.object({
    tagName: z.literal(tagName),
    attrs: attrsSchema,
    comments: CommentsSchema,
    text: textSchema,
    textSegments: config.mixed
      ? z.array(TextSegmentSchema).optional()
      : z.array(TextSegmentSchema).optional(),
    children: childrenSchema,
    provenance: ProvenanceSchema,
    dirty: z.boolean(),
  });

  // We need to use passthrough to allow for optional properties that might not be present
  // and to handle the type casting properly
  return schema.passthrough() as unknown as ZodType<{
    tagName: TTag;
    attrs: TAttrs extends ZodRawShape ? z.infer<ZodObject<TAttrs>> : Record<string, string>;
    comments: { start?: string | undefined; end?: string | undefined };
    text?: TText extends ZodType ? z.infer<TText> : string | undefined;
    textSegments?: Array<{ text: string; position: number }> | undefined;
    children: TChildren extends ZodType ? z.infer<TChildren> : unknown[];
    provenance: {
      source: string;
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
    };
    dirty: boolean;
  }>;
}
