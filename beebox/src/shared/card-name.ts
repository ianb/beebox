/**
 * Canonical card filename grammar, shared by backend and frontend.
 *
 * Two identity modes (docs/plans/interface-as-cards.md):
 *
 * - **Nominal** — `Name.<type>.card`: identity from the name.
 * - **Positional** — bare `<type>.card`: "the ‹type› of this directory";
 *   identity from location, `name` is null. At most one per directory falls
 *   out of filename uniqueness.
 *
 * Job cards use the dotted convention `Name.<kind>.job.card` (the reactor
 * discovers jobs by that suffix — see reactor/job-discovery.ts) while their
 * schemas are registered under hyphenated names, so `Foo.intake.job.card`
 * resolves to type `intake-job`. There is no positional job form —
 * `intake.job.card` parses as nominal name "intake", type "job".
 */
export interface ParsedCardFileName {
  /** null for positional cards (bare `<type>.card`) */
  name: string | null;
  type: string;
}

/**
 * Parse a card file basename (no directory part). Returns null when the
 * name doesn't follow the card naming convention.
 */
export function parseCardFileName(fileName: string): ParsedCardFileName | null {
  const job = fileName.match(/^(.+)\.([^.]+)\.job\.card$/);
  if (job?.[1] !== undefined && job[2] !== undefined) return { name: job[1], type: `${job[2]}-job` };
  const nominal = fileName.match(/^(.+)\.([^.]+)\.card$/);
  if (nominal?.[1] !== undefined && nominal[2] !== undefined) return { name: nominal[1], type: nominal[2] };
  const positional = fileName.match(/^([^.]+)\.card$/);
  if (positional?.[1] !== undefined) return { name: null, type: positional[1] };
  return null;
}

/**
 * Card type from a path or ref (directory part and `?query` suffix
 * tolerated), or undefined when the basename isn't card-shaped.
 */
export function cardTypeFromName(pathOrRef: string): string | undefined {
  const noQuery = pathOrRef.split("?")[0] ?? pathOrRef;
  const base = noQuery.split("/").pop() ?? noQuery;
  return parseCardFileName(base)?.type;
}
