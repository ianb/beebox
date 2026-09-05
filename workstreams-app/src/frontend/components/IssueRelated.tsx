import { Link } from "@tanstack/react-router";

import { Pill } from "./ui.js";
import { trpc } from "../trpc.js";
import type { Issue, RelatedResult, RelatedRow } from "../types.js";

/**
 * The nearest issues and design docs to the open issue — the same ranking
 * `bin/issues similar <path> --all --docs` prints, so what an agent quotes
 * from the CLI and what the boxholder sees here are the same eight rows.
 *
 * There is deliberately no search box: this answers "what else is about
 * this?" for the issue already on screen, which is the question that comes
 * up while reading one.
 */

function RelatedTarget({ row }: { row: RelatedRow }) {
  const issue = row.issue;
  if (issue === null) {
    return <Link className="related-path" to="/browse" search={{ file: row.path }}>{row.path}</Link>;
  }
  return <Link
    className="related-path"
    to="/issues"
    search={(previous) => ({ ...previous, issue: issue.relPath, issueVisibility: issue.visibility })}
  >{row.path}</Link>;
}

function RelatedRows({ result }: { result: RelatedResult }) {
  if (result.problem !== null) return <p className="muted">{result.problem.detail}</p>;
  if (result.rows.length === 0) {
    return <p className="muted">Nothing in the queue or the design docs ranks close to this one.</p>;
  }
  return <>
    <ol className="related-list">{result.rows.map((row) => <li key={row.path}>
      <span className="related-score">{row.score.toFixed(3)}</span>
      <RelatedTarget row={row} />
      {row.status === null ? <Pill tone="accent">doc</Pill> : <Pill tone={row.status === "closed" ? "neutral" : "info"}>{row.status}</Pill>}
      <span className="related-title">{row.title}</span>
    </li>)}</ol>
    {result.unembedded > 0
      ? <p className="muted">{result.unembedded} document(s) have no embedding yet, so this ranking cannot see them.</p>
      : null}
  </>;
}

export function IssueRelated({ issue }: { issue: Pick<Issue, "relPath" | "visibility"> }) {
  const related = trpc.issues.related.useQuery({ relPath: issue.relPath, visibility: issue.visibility });
  return <section className="issue-related" aria-label="Related issues and documents">
    <h3>Related</h3>
    {related.isLoading ? <section className="loading-skeleton" aria-busy="true"><span /></section> : null}
    {related.isError ? <p className="muted">Couldn’t rank related documents: {related.error.message}</p> : null}
    {related.data ? <RelatedRows result={related.data} /> : null}
  </section>;
}
