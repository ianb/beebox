/**
 * Registry for FileLoaders — maps a file (by card type or path pattern) to a
 * loader that produces a typed FileSummary. One custom registration per match
 * key; a colliding registration logs a warning and wins (last-wins).
 *
 * Dispatch rule: exact card-type match wins over path-pattern match. If no
 * custom loader matches, the built-in fallback produces
 * { path, title: stripExt(basename) }.
 */

import { type FileLoader, type FileSummary, type LoaderInput, titleFromFilename } from "./file-summary.js";
import { readCardSymbol } from "./card-symbol.js";
import { validateThemeChoice } from "../shared/card-theme.js";

interface TypeRegistration {
  kind: "type";
  type: string;
  loader: FileLoader<unknown>;
}

interface PathRegistration {
  kind: "match";
  match: (path: string) => boolean;
  loader: FileLoader<unknown>;
}

type Registration = TypeRegistration | PathRegistration;

const registrations: Registration[] = [];

/**
 * Register a loader for a specific card type.
 * Colliding type registrations log a warning — last-wins.
 */
export function registerTypeLoader<T>(type: string, loader: FileLoader<T>): void {
  const existing = registrations.find(r => r.kind === "type" && r.type === type);
  if (existing) {
    console.warn(`Loader collision for type "${type}": overriding previous registration`);
    const idx = registrations.indexOf(existing);
    registrations.splice(idx, 1);
  }
  registrations.push({
    kind: "type",
    type,
    loader,
  });
}

/**
 * Register a loader matched by path predicate (e.g. `p => p.endsWith(".md")`).
 * Path matches are checked after card-type matches miss.
 */
export function registerPathLoader<T>(
  match: (path: string) => boolean,
  loader: FileLoader<T>,
): void {
  registrations.push({
    kind: "match",
    match,
    loader,
  });
}

/**
 * Built-in fallback loader. Reads nothing beyond the path.
 */
const fallbackLoader: FileLoader<unknown> = (raw: LoaderInput) => ({
  path: raw.path,
  title: titleFromFilename(raw.path),
});

/**
 * Find the matching loader for a file. Dispatch order:
 *   1. card-type exact match (input.type)
 *   2. path predicate match
 *   3. fallback
 */
function resolveLoader(input: LoaderInput): { loader: FileLoader<unknown>; isFallback: boolean } {
  const type = input.type;
  if (type) {
    const match = registrations.find(r => r.kind === "type" && r.type === type);
    if (match) return { loader: match.loader, isFallback: false };
  }
  const pathMatches = registrations.filter(
    r => r.kind === "match" && r.match(input.path),
  );
  if (pathMatches.length > 1) {
    const paths = pathMatches.length;
    console.warn(
      `Path loader collision for "${input.path}": ${paths} matches; using first registered`,
    );
  }
  const pathMatch = pathMatches[0];
  if (pathMatch) return { loader: pathMatch.loader, isFallback: false };
  return { loader: fallbackLoader, isFallback: true };
}

/**
 * Run the resolved loader to produce a summary.
 */
export function summarize(input: LoaderInput): FileSummary<unknown> {
  const { loader, isFallback } = resolveLoader(input);
  const summary = loader(input);
  // `title`, `contains` and `symbol` are global card fields — surface them
  // uniformly rather than teaching every loader about them.
  let out = summary;
  if (out.type === undefined && input.type !== undefined) {
    out = { ...out, type: input.type };
  }
  const authoredTheme = input.fields?.["theme"];
  if (authoredTheme !== undefined) {
    // Preserve an explicit but malformed choice as the resolver's plain
    // fallback: it must block lower-precedence defaults just like a full card.
    out = { ...out, cardTheme: validateThemeChoice(authoredTheme, "card theme").choice };
  }
  // A card's own `title:` beats the FALLBACK loader's filename-derived title,
  // and never beats a title a real loader computed on purpose — a memo's title
  // IS its text (`schemas/memo.ts`). Asking the resolver which one ran, rather
  // than comparing the title against the filename: a memo whose body happens to
  // read "Bread" in `Bread.memo.card` would lose to its frontmatter under a
  // string comparison.
  const declared = input.fields?.["title"];
  if (isFallback && typeof declared === "string" && declared.trim() !== "") {
    out = { ...out, title: declared.trim() };
  }
  if (out.contains === undefined && input.fields !== undefined) {
    const contains = input.fields["contains"];
    if (typeof contains === "string" && contains !== "") out = { ...out, contains };
  }
  if (out.symbol === undefined && input.fields?.["symbol"] !== undefined) {
    const symbol = readCardSymbol(input.fields["symbol"], { cardPath: input.path });
    if (symbol !== null) out = { ...out, symbol };
  }
  return out;
}

/**
 * Reset the registry. Intended for tests only.
 */
export function resetLoaderRegistry(): void {
  registrations.length = 0;
}
