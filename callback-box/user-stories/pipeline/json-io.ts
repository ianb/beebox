import { readFileSync } from "node:fs";

/**
 * Read and parse a JSON file the pipeline wrote.
 *
 * Every stage of this pipeline hands work to the next one through JSON files, so the whole thing
 * is one big parse boundary. Rather than scatter a cast at each of ~25 read sites, the unavoidable
 * one lives here. Callers state the shape they expect; the validator is what actually enforces it.
 */
export function readJson<T>(path: string): T {
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: JSON.parse returns `any`, and this is the single place the pipeline converts file bytes into a typed record.
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * Parse one line of a JSONL file. Same parse boundary as {@link readJson}; separate because the
 * frozen catalog is line-delimited so git can diff it one capability at a time.
 */
export function parseJsonLine<T>(line: string): T {
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: JSON.parse returns `any`.
  return JSON.parse(line) as T;
}
