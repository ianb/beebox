import { Link, useParams } from "@tanstack/react-router";
import { Button } from "../components/ui.js";
import { WorkstreamIssueSummary } from "../components/WorkstreamIssueSummary.js";
import { trpc } from "../trpc.js";

export function WorkstreamDetailPage() {
  const params = useParams({ strict: false });
  const name = typeof params.name === "string" ? params.name : "workstream";
  const detail = trpc.workstreams.detail.useQuery({ name });
  if (detail.isLoading) return <main className="simple-page"><section className="loading-skeleton" aria-busy="true"><span /><span /></section></main>;
  if (detail.isError) return <main className="simple-page"><section className="error-state"><p>Couldn’t load {name}: {detail.error.message}</p><Button onClick={() => void detail.refetch()}>Retry</Button></section></main>;
  const value = detail.data;
  if (!value) return null;
  return <main className="simple-page"><p><Link to="/">← workstreams</Link></p><h1>{value.workstream.session.emoji ?? "·"} {value.workstream.name}</h1><dl className="detail-facts"><dt>Agent</dt><dd>{value.workstream.session.agent ?? "unknown"} · {value.workstream.agent.state}</dd><dt>Git</dt><dd>{value.workstream.git ? `${value.workstream.git.ahead ?? "?"} ahead, ${value.workstream.git.dirty ?? "?"} dirty` : "unavailable"}</dd><dt>Box</dt><dd>{value.workstream.boxState.testSetup ? "test setup" : value.workstream.boxState.keepUnmerged ? "keep unmerged" : "no pin"}</dd></dl><section><h2>Issues <small>{value.issues.length}</small></h2><div className="workstream-detail-issues">{value.issues.map((association) => <WorkstreamIssueSummary key={`${association.issue.visibility}:${association.issue.relPath}`} {...association} />)}</div></section></main>;
}
