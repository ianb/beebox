import { isRecord } from "../shared/is-record.js";

/**
 * Walk a parsed fields object and pull out every reference.
 *
 * Refs are identified by convention, not by schema declaration:
 *   - any key literally named `ref` whose value is a string
 *   - any key literally named `refs` whose value is an array of strings
 *
 * Refs can appear at any depth — inside nested objects, inside array
 * elements, etc. Each result carries a JSON path (with indices filled
 * in) so callers can attach lint errors to a specific position.
 */
export function extractRefs(
  fields: Record<string, unknown>
): Array<{ path: string; ref: string }> {
  const out: Array<{ path: string; ref: string }> = [];
  walkForRefs(fields, { currentPath: "", out });
  return out;
}

interface WalkForRefsOptions {
  currentPath: string;
  out: Array<{ path: string; ref: string }>;
}

function walkForRefs(value: unknown, { currentPath, out }: WalkForRefsOptions): void {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      walkForRefs(item, { currentPath: `${currentPath}[${String(i)}]`, out });
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = currentPath === "" ? key : `${currentPath}.${key}`;
    if (key === "ref" && typeof child === "string") {
      out.push({ path: childPath, ref: child });
      continue;
    }
    if (key === "refs" && Array.isArray(child)) {
      const items: unknown[] = child;
      for (const [i, item] of items.entries()) {
        if (typeof item === "string") {
          out.push({ path: `${childPath}[${String(i)}]`, ref: item });
        }
      }
      continue;
    }
    walkForRefs(child, { currentPath: childPath, out });
  }
}
