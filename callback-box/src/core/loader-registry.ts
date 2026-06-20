/**
 * Registry for FileLoaders — maps a file (by card type or path pattern) to a
 * loader that produces a typed FileSummary. One custom registration per match
 * key; additional matches are reported as warnings.
 *
 * Dispatch rule: exact card-type match wins over path-pattern match. If no
 * custom loader matches, the built-in fallback produces
 * { path, title: stripExt(basename) }.
 */

import { type FileLoader, type FileSummary, type LoaderInput, titleFromFilename } from "./file-summary.js";

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

export class LoaderCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoaderCollisionError";
  }
}

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
    loader: loader as FileLoader<unknown>,
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
    loader: loader as FileLoader<unknown>,
  });
}

/**
 * Built-in fallback loader. Reads nothing beyond the path.
 */
export const fallbackLoader: FileLoader<unknown> = (raw: LoaderInput) => ({
  path: raw.path,
  title: titleFromFilename(raw.path),
});

/**
 * Find the matching loader for a file. Dispatch order:
 *   1. card-type exact match (input.type)
 *   2. path predicate match
 *   3. fallback
 */
export function resolveLoader(input: LoaderInput): FileLoader<unknown> {
  const type = input.type;
  if (type) {
    const match = registrations.find(r => r.kind === "type" && r.type === type);
    if (match) return match.loader;
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
  if (pathMatch) return pathMatch.loader;
  return fallbackLoader;
}

/**
 * Run the resolved loader to produce a summary.
 */
export function summarize(input: LoaderInput): FileSummary<unknown> {
  const loader = resolveLoader(input);
  const summary = loader(input);
  // contains: is a global card field — surface it uniformly rather than
  // teaching every loader about it.
  if (summary.contains === undefined && input.fields !== undefined) {
    const contains = input.fields["contains"];
    if (typeof contains === "string" && contains !== "") {
      return { ...summary, contains };
    }
  }
  return summary;
}

/**
 * Reset the registry. Intended for tests only.
 */
export function resetLoaderRegistry(): void {
  registrations.length = 0;
}
