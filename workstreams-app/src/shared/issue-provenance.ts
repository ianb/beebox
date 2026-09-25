/**
 * Split a `discovered-in:` value into the place it names and the context clause
 * after it.
 *
 * The field is provenance: *where* an issue was noticed and what was happening
 * (`issues/CLAUDE.md`). Its documented machine-readable form is
 * `worktree-<name> — <context>`, but the most common value in practice is
 * `main session — <context>`, because anything the boxholder and an agent file
 * from the primary session has no worktree to name. Both are honest, so both are
 * sources here and the split is on the em dash rather than on a prefix.
 *
 * The place is short enough for a pill; the context is a sentence and belongs in
 * the detail pane. Keeping them apart is the point: the browser used to show
 * `discovered-by` instead, so every agent-filed issue read `discovered:agent`
 * while the informative half of the provenance was invisible.
 */

export interface IssueProvenance {
  /** The place: a bare workstream name, `main session`, a schedule run, … */
  source: string;
  /** What was happening there, or null when the value names only a place. */
  context: string | null;
}

/** The em dash the convention uses, plus the hyphen form a hand-typed value may carry. */
const SEPARATOR = /\s+(?:—|--)\s+/u;

export function issueProvenance(discoveredIn?: string): IssueProvenance | null {
  const value = discoveredIn?.trim();
  if (value === undefined || value === "") return null;
  const [head, ...rest] = value.split(SEPARATOR);
  // A stray opening quote is trimmed from the PLACE only — one value in the queue
  // carries one. Trimming quotes from the whole string would eat the closing
  // quote of a context clause that quotes the boxholder, which is the most
  // valuable shape the field takes.
  const source = (head ?? value).trim().replace(/^"+/u, "").trim();
  if (source === "") return null;
  const context = rest.join(" — ").trim();
  // `worktree-foo` is stored and displayed as `foo` everywhere else in the repo
  // — the router prefix, `workstream:`, `bin/workstreams` — so a pill showing
  // the token would be the one place spelling it differently.
  const bare = source.startsWith("worktree-") ? source.slice("worktree-".length) : source;
  return { source: bare === "" ? source : bare, context: context === "" ? null : context };
}
