/**
 * Mechanical coverage check for a MAP.md.
 *
 * Finalize used to stamp a map only when it could prove the agent rewrote it.
 * A map whose correct result is "no change" — an existing map with no state
 * entry, or an update whose only addition is a plain file the map should not
 * list — could then never be stamped, and came back in every run
 * (`issues/bugs/2026-09-16-refresh-maps-reports-existing-maps-as-create-forever.md`).
 * This check proves a map correct directly, so finalize can stamp it without a
 * change.
 *
 * The rules restate the format section of the refresh-maps procedure prompt
 * (`templates/procedures/refresh-maps.procedure.card`). They are strict on
 * purpose: a false failure costs one agent rewrite (which then stamps because
 * it changed the file); a false pass marks a stale map current.
 */

/** Files that anchor a directory and so must be listed, per the prompt. */
const ANCHOR_FILE = /^(README\.md|.+\.briefing\.card|.+\.landmark\.card)$/;

/** A top-level bullet whose first token is a backticked name. */
const BULLET = /^[*-]\s+`([^`]+)`/;

export type MapCoverage = { ok: true } | { ok: false; problems: string[] };

export interface VerifyMapCoverageParams {
  /** Directory the map describes, relative to box root. */
  dir: string;
  /** The MAP.md text. */
  content: string;
  /** The directory's current listing, as the brief gives it (dirs end in "/"). */
  children: readonly string[];
}

/**
 * Does this MAP.md cover `children` in the prompt's format?
 *
 * - The first non-blank line is exactly `# Map: <dir>`.
 * - Every subdirectory appears as a top-level bullet `` `name/` ``.
 * - Every anchor file (`README.md`, `*.briefing.card`, `*.landmark.card`)
 *   appears as a bullet.
 * - Every top-level backticked bullet names an entry in `children` — which
 *   catches deleted entries and entries the ignore policy hides.
 *
 * Plain files are optional: the prompt says to list subdirectories, not every
 * file. Nested bullets and prose are not checked.
 */
export function verifyMapCoverage(params: VerifyMapCoverageParams): MapCoverage {
  const { dir, content, children } = params;
  const problems: string[] = [];
  const lines = content.split("\n");

  const expectedHeader = `# Map: ${dir}`;
  const header = lines.find((l) => l.trim() !== "")?.trimEnd() ?? "";
  if (header !== expectedHeader) {
    problems.push(`header is ${JSON.stringify(header)}, expected ${JSON.stringify(expectedHeader)}`);
  }

  const named = new Set<string>();
  for (const line of lines) {
    const match = BULLET.exec(line);
    if (match?.[1] !== undefined) named.add(match[1]);
  }

  const listing = new Set(children);
  for (const child of children) {
    const required = child.endsWith("/") || ANCHOR_FILE.test(child);
    if (required && !named.has(child)) problems.push(`does not list ${child}`);
  }
  for (const name of named) {
    if (!listing.has(name)) problems.push(`lists ${name}, which is not in the directory's listing`);
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
