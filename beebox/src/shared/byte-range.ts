/**
 * HTTP byte ranges for box files: the file route (`webapp/routes/api/register/files.ts`)
 * serves them, and `bbx view check`'s settled render answers a view's
 * `readFile` with the same rule (`cli/commands/view/settle.ts`).
 */

/**
 * Parse a single-range `Range: bytes=...` header against a file size.
 * Returns the inclusive byte range, "unsatisfiable" (→ 416), or null for
 * forms we don't serve (multi-range, malformed) — those get the full file.
 */
export function parseByteRange(
  header: string,
  size: number
): { start: number; end: number } | "unsatisfiable" | null {
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (match === null) return null;
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return null;
  if (startStr === "") {
    // Suffix form: bytes=-N → the last N bytes.
    const suffix = Number(endStr);
    if (suffix === 0) return "unsatisfiable";
    const start = Math.max(0, size - suffix);
    return size === 0 ? "unsatisfiable" : { start, end: size - 1 };
  }
  const start = Number(startStr);
  if (start >= size) return "unsatisfiable";
  const end = endStr === "" ? size - 1 : Math.min(Number(endStr), size - 1);
  if (end < start) return null;
  return { start, end };
}

/** The `Range` header a view's `readFile` sends (`useViewFileHelpers.ts`), or null for the whole file. */
export function viewReadRangeHeader(opts: { start?: number; end?: number } | undefined): string | null {
  if (opts === undefined || (opts.start === undefined && opts.end === undefined)) return null;
  const start = opts.start ?? 0;
  return start < 0 ? `bytes=${String(start)}` : `bytes=${String(start)}-${opts.end === undefined ? "" : String(opts.end)}`;
}
