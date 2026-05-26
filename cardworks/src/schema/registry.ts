import type { ZodType } from "zod";
import type { ElementSchema } from "./element.js";

/**
 * A registry of element schemas indexed by tag name.
 */
export class SchemaRegistry {
  private schemas = new Map<string, ZodType>();

  /**
   * Create a new schema registry.
   *
   * @param schemas - Optional array of ElementSchemas to register
   */
  constructor(schemas: ElementSchema[] = []) {
    for (const schema of schemas) {
      this.register(schema);
    }
  }

  /**
   * Register an element schema.
   *
   * @param schema - The ElementSchema to register (must have .tagName)
   */
  register(schema: ElementSchema): void {
    this.schemas.set(schema.tagName, schema);
  }

  /**
   * Get the schema for a tag name.
   *
   * @param tagName - The tag name to look up
   * @returns The schema, or undefined if not registered
   */
  get(tagName: string): ZodType | undefined {
    return this.schemas.get(tagName);
  }

  /**
   * Check if a schema is registered for a tag name.
   *
   * @param tagName - The tag name to check
   */
  has(tagName: string): boolean {
    return this.schemas.has(tagName);
  }

  /**
   * Get all registered tag names.
   */
  tagNames(): string[] {
    return Array.from(this.schemas.keys());
  }

  /**
   * Check if any schemas are registered.
   */
  isEmpty(): boolean {
    return this.schemas.size === 0;
  }
}
