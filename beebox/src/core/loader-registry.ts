/**
 * Produces a `FileSummary` for a file.
 *
 * A CARD's summary belongs to its card type: `summarize` builds the standard
 * base (title, `contains:`, `symbol:`) and hands it to the schema's
 * `summarize` hook, which extends or replaces it. A card that failed
 * validation has no fields to hand over, so it keeps the base summary derived
 * from its filename.
 *
 * NON-card files still go through path loaders registered here
 * (`registerPathLoader`), because a plain file has no schema to ask.
 */

import type { CardSchema, CardSummaryBase, CardSummaryParts } from "../cards/schema.js";
import { cardFields, formatZodIssues } from "./card-io.js";
import { type FileLoader, type FileSummary, type LoaderInput, titleFromFilename } from "./file-summary.js";
import { readCardSymbol } from "./card-symbol.js";
import { validateThemeChoice } from "../shared/card-theme.js";

interface PathRegistration {
  match: (path: string) => boolean;
  loader: FileLoader<unknown>;
}

const registrations: PathRegistration[] = [];

/**
 * Register a loader matched by path predicate (e.g. `p => p.endsWith(".md")`).
 * Cards never reach these — their type's schema answers for them.
 */
export function registerPathLoader<T>(
  match: (path: string) => boolean,
  loader: FileLoader<T>,
): void {
  registrations.push({ match, loader });
}

/**
 * The summary every file gets before its type has a say: an authored `title:`
 * or the filename, plus the global `contains:` and `symbol:` fields.
 */
function buildBase(input: LoaderInput): CardSummaryBase {
  const declared = input.fields?.["title"];
  const title = typeof declared === "string" && declared.trim() !== ""
    ? declared.trim()
    : titleFromFilename(input.path);
  let base: CardSummaryBase = { title };
  const contains = input.fields?.["contains"];
  if (typeof contains === "string" && contains !== "") {
    base = { ...base, contains };
  }
  const rawSymbol = input.fields?.["symbol"];
  if (rawSymbol !== undefined) {
    const symbol = readCardSymbol(rawSymbol, { cardPath: input.path });
    if (symbol !== null) base = { ...base, symbol };
  }
  return base;
}

/**
 * Ask the card type how it wants to appear. A type with no `summarize`, and a
 * card whose fields didn't validate, keep the base summary. A hook that throws
 * is a bug in that schema, not a reason to lose the row: warn and fall back.
 *
 * A `summarize` hook is TYPED as receiving fields this schema vouched for, so
 * the fields are checked against it here before the hook sees them. The
 * production callers (`files.summarize`, `summarizeCardText`) load the card
 * first and would pass anyway; `summarize` is exported, though, and a direct
 * caller's raw bag must not reach a hook that is entitled to trust its
 * argument. Only a type WITH a hook pays for the check.
 */
function cardParts(
  input: LoaderInput,
  { base, cardSchemas }: { base: CardSummaryBase; cardSchemas: Map<string, CardSchema> },
): CardSummaryParts<unknown> {
  const type = input.type;
  const fields = input.fields;
  if (type === undefined || fields === undefined) return base;
  const schema = cardSchemas.get(type);
  if (schema?.summarize === undefined) return base;
  const check = schema.frontmatterSchema.safeParse(fields);
  if (!check.success) {
    console.warn(
      `summarize() was handed unvalidated "${type}" fields for ${input.path}; using the base summary:`,
      formatZodIssues(check.error.issues),
    );
    return base;
  }
  try {
    const parts = schema.summarize(cardFields({ schema, fields }, schema), base);
    // An empty title would render a blank row; the base title always says
    // something, so it stands in.
    if (parts.title.trim() === "") return { ...parts, title: base.title };
    return parts;
  } catch (e) {
    console.warn(`summarize() for card type "${type}" failed on ${input.path}; using the base summary:`, e);
    return base;
  }
}

/**
 * Non-card files: the first matching path loader, else the base summary.
 * A path loader's own title wins over the filename — it computed it on
 * purpose — but an empty one falls back.
 */
function pathParts(input: LoaderInput, base: CardSummaryBase): CardSummaryParts<unknown> {
  const matches = registrations.filter(r => r.match(input.path));
  if (matches.length > 1) {
    console.warn(
      `Path loader collision for "${input.path}": ${matches.length} matches; using first registered`,
    );
  }
  const first = matches[0];
  if (first === undefined) return base;
  const summary = first.loader(input);
  let parts: CardSummaryParts<unknown> = base;
  if (summary.title.trim() !== "") parts = { ...parts, title: summary.title };
  if (summary.contains !== undefined) parts = { ...parts, contains: summary.contains };
  if (summary.symbol !== undefined) parts = { ...parts, symbol: summary.symbol };
  if (summary.detail !== undefined) parts = { ...parts, detail: summary.detail };
  if (summary.attrs !== undefined) parts = { ...parts, attrs: summary.attrs };
  return parts;
}

/**
 * Build the summary for one file. `cardSchemas` is the box's schema map (the
 * same one `buildLoadContext` produced to read the card), so a box-local card
 * type summarizes its own cards.
 */
export function summarize(
  input: LoaderInput,
  cardSchemas: Map<string, CardSchema>,
): FileSummary<unknown> {
  const base = buildBase(input);
  const parts = input.type === undefined
    ? pathParts(input, base)
    : cardParts(input, { base, cardSchemas });

  let out: FileSummary<unknown> = { path: input.path, title: parts.title };
  if (input.type !== undefined) out = { ...out, type: input.type };
  const authoredTheme = input.fields?.["theme"];
  if (authoredTheme !== undefined) {
    // Preserve an explicit but malformed choice as the resolver's plain
    // fallback: it must block lower-precedence defaults just like a full card.
    out = { ...out, cardTheme: validateThemeChoice(authoredTheme, "card theme").choice };
  }
  if (parts.contains !== undefined) out = { ...out, contains: parts.contains };
  if (parts.symbol !== undefined) out = { ...out, symbol: parts.symbol };
  if (parts.detail !== undefined) out = { ...out, detail: parts.detail };
  if (parts.attrs !== undefined) out = { ...out, attrs: parts.attrs };
  return out;
}

/**
 * Reset the path-loader registry. Intended for tests only.
 */
export function resetLoaderRegistry(): void {
  registrations.length = 0;
}
