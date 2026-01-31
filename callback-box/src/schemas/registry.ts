/**
 * Central schema registration with cardworks.
 *
 * All card schemas are registered here and exported for use
 * by the CardLoader factory.
 */

import { SchemaRegistry, type ElementSchema } from "cardworks";
import { MemoSchema } from "./memo.js";
import { QuestionSchema } from "./question.js";

/**
 * All registered card schemas.
 */
export const schemas: ElementSchema[] = [
  MemoSchema,
  QuestionSchema,
];

/**
 * Create a SchemaRegistry populated with all known schemas.
 */
export function createSchemaRegistry(): SchemaRegistry {
  const registry = new SchemaRegistry();
  for (const schema of schemas) {
    registry.register(schema);
  }
  return registry;
}

/**
 * Get the list of known card types.
 */
export function getCardTypes(): string[] {
  return schemas.map(s => s.tagName);
}

/**
 * Check if a card type is known.
 */
export function isKnownCardType(type: string): boolean {
  return schemas.some(s => s.tagName === type);
}

// Re-export individual schemas for direct access
export { MemoSchema } from "./memo.js";
export { QuestionSchema } from "./question.js";
