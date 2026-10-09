const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** HTML-escape a value before interpolating it into markup or an attribute (either quote style). */
export function escapeHtml(value: string): string {
  return value.replace(/["&'<>]/g, (c) => HTML_ESCAPES[c] ?? c);
}
