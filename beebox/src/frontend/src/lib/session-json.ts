/**
 * Typed JSON in this tab's sessionStorage. A missing key, unparseable JSON, a
 * value the schema rejects, or a browser without sessionStorage all read as
 * `fallback`; a failed read or write warns with `what` and never throws, since
 * per-tab state is a convenience the page must render without.
 */

import type { z } from "zod";

export function readSessionJson<T>({ key, schema, fallback, what }: {
  key: string;
  schema: z.ZodType<T>;
  fallback: T;
  what: string;
}): T {
  if (!("sessionStorage" in globalThis)) return fallback;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch (error) {
    console.warn(`${what} could not be restored`, error);
    return fallback;
  }
}

export function writeSessionJson({ key, value, what }: { key: string; value: unknown; what: string }): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`${what} could not be saved`, error);
  }
}
