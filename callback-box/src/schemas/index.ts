/**
 * Schema registry
 *
 * All card types must have a schema registered here.
 * Schemas are defined using Zod via cardworks.
 */

import { z } from "zod";

// Placeholder - actual schemas will be defined per card type
// and use cardworks' element() helper

export interface SchemaDefinition {
  name: string;
  schema: z.ZodType;
}

const registry = new Map<string, SchemaDefinition>();

export function registerSchema(name: string, schema: z.ZodType): void {
  registry.set(name, { name, schema });
}

export function getSchema(name: string): SchemaDefinition | undefined {
  return registry.get(name);
}

export function getAllSchemas(): SchemaDefinition[] {
  return Array.from(registry.values());
}

export function validateCard(cardType: string, data: unknown): z.SafeParseReturnType<unknown, unknown> {
  const schemaDef = registry.get(cardType);
  if (!schemaDef) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: "custom",
          path: [],
          message: `No schema registered for card type: ${cardType}`,
        },
      ]),
    };
  }
  return schemaDef.schema.safeParse(data);
}
