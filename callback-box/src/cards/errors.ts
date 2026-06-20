/**
 * Card parse error. Absorbed from the former `cardworks` package
 * (parser/parse.ts). Raised when a card body can't be parsed; callback-box's
 * `search/refresh-file.ts` catches it via `instanceof` to distinguish a
 * malformed body from other IO errors.
 */

import type { Location } from "./lint-format.js";

/** Location details for a {@link ParseError}. */
export interface ParseErrorLocation {
  source: string;
  line?: number | undefined;
  column?: number | undefined;
}

export class ParseError extends Error {
  public readonly location: Location;

  constructor(message: string, { source, line, column }: ParseErrorLocation) {
    const col = column === undefined ? 1 : column;
    const loc = line ? `${source}:${String(line)}:${String(col)}` : source;
    super(`${loc}: ${message}`);
    this.name = "ParseError";
    const ln = line === undefined ? 0 : line;
    const cn = column === undefined ? 0 : column;
    this.location = { source, startLine: ln, startColumn: cn, endLine: ln, endColumn: cn };
  }
}
