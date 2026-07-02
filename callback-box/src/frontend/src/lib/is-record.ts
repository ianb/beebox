/**
 * Type guard for a plain object (non-null, non-array). Shared by the renderers
 * and views that narrow untyped card/figure data before indexing into it;
 * these each kept their own identical copy.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
