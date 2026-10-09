/** Markup helpers for the few pages the hub renders itself. */
import { invariant } from "../../shared/invariant.js";

/** HTML-escape a value before interpolating it into markup or an attribute. */
export function escapeHtml(value: string): string {
  const escapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/["&'<>]/g, (c) => {
    const escaped = escapes[c];
    invariant(escaped !== undefined, `escapeHtml: no mapping for matched character "${c}"`);
    return escaped;
  });
}
