/**
 * Value-to-string serialization for check() assertions.
 *
 * Custom serializers let application code control how domain objects
 * (Card, GitStatus, etc.) render in test output.
 */

type Serializer = (value: unknown) => string | null;

const serializers: Serializer[] = [];

/**
 * Register a serializer. Serializers are tried in order; the first
 * one that returns a non-null string wins. Application code registers
 * domain-specific serializers; the framework provides fallbacks.
 */
export function registerSerializer(fn: Serializer): void {
  serializers.push(fn);
}

/**
 * Convert any value to a string for comparison.
 *
 * Tries registered serializers first, then falls back to:
 *  - strings pass through unchanged
 *  - undefined/null become "undefined"/"null"
 *  - objects get JSON.stringify with 2-space indent
 *  - everything else gets String()
 */
export function serialize(value: unknown): string {
  for (const s of serializers) {
    const result = s(value);
    if (result !== null) return result;
  }

  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  if (value === null) return "null";

  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  return String(value);
}
