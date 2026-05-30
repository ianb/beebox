/**
 * Template registry core — the in-memory map of template definitions and the
 * accessors used to register and look them up. Kept as a leaf module so that
 * the built-in registrations and the describe helpers can both depend on it
 * without forming an import cycle.
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
  /** Card types this template can create (e.g., "memo", "question") */
  cardTypes: string[];
  /** If set, this template is the default when creating cards of these types */
  defaultForTypes?: string[];
}

/**
 * Template registry mapping names to definitions.
 */
const templateRegistry = new Map<string, TemplateDefinition>();

/**
 * Register a template.
 */
export function registerTemplate<T extends ZodRawShape>(
  definition: TemplateDefinition<T>
): void {
  templateRegistry.set(definition.name, definition as unknown as TemplateDefinition);
}

/**
 * Get a template by name.
 */
export function getTemplate(name: string): TemplateDefinition | undefined {
  return templateRegistry.get(name);
}

/**
 * Get all registered template names.
 */
export function getTemplateNames(): string[] {
  return Array.from(templateRegistry.keys());
}

/**
 * Get all template definitions.
 */
export function getAllTemplates(): TemplateDefinition[] {
  return Array.from(templateRegistry.values());
}

/**
 * Find templates that can create a given card type.
 */
export function getTemplatesForCardType(cardType: string): TemplateDefinition[] {
  return getAllTemplates().filter((t) => t.cardTypes.includes(cardType));
}

/**
 * Get the default template for a given card type.
 * Returns the template whose defaultForTypes includes this card type.
 */
export function getDefaultTemplate(cardType: string): TemplateDefinition | undefined {
  return getAllTemplates().find((t) => t.defaultForTypes?.includes(cardType));
}
