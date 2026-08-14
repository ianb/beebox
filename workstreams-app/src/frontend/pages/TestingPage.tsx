import { Link } from "@tanstack/react-router";
import { Button } from "../components/ui.js";
import { trpc } from "../trpc.js";
import type { ActionVerb, Issue, Workstream } from "../types.js";

function TestingRow({ issue, worktree, row }: { issue: Issue; worktree?: string | undefined; row?: Workstream | undefined }) {
  const target = worktree ? `/${worktree}/test1/` : "/main/test1/";
  const action = trpc.actions.run.useMutation();
  function run(verb: ActionVerb, name: string): void { action.mutate({ verb, name }); }
  const issueName = issue.relPath.split("/").at(-1) ?? issue.relPath;
  return <li><Link to="/issues" search={{ issue: issue.relPath }}>{issue.frontmatter.title}</Link><Link to="/workstreams/$name" params={{ name: issue.frontmatter.workstream }}>{issue.frontmatter.workstream}</Link><a href={target}>{worktree ? "worktree test1" : "main test1"}</a><span>{row ? <Button disabled={action.isPending} onClick={() => run("resume", row.name)}>Resume</Button> : null}{row?.boxState.testSetup ? <Button disabled={action.isPending} onClick={() => run("reset-test", row.name)}>Reset test</Button> : null}{!worktree ? <Button intent="primary" disabled={action.isPending} onClick={() => run("confirm-tested", issueName)}>Confirm</Button> : null}{action.isError ? <span className="action-error" role="alert">{action.error.message}</span> : null}</span></li>;
}

export function TestingQueue({ landed, pending, rows }: { landed: Issue[]; pending: Array<{ worktree: string; issue: Issue }>; rows?: Workstream[] | undefined }) {
  const availableRows = rows ?? [];
  const byName = new Map(availableRows.map((row) => [row.name, row]));
  return <main className="simple-page"><h1>manual testing</h1><section><h2>Landed, awaiting verification <small>{landed.length}</small></h2>{landed.length > 0 ? <ul className="testing-list">{landed.map((issue) => <TestingRow key={issue.relPath} issue={issue} row={byName.get(issue.frontmatter.workstream)} />)}</ul> : <p className="empty-state">Nothing waiting.</p>}</section><section><h2>Pre-merge, testable in place <small>{pending.length}</small></h2>{pending.length > 0 ? <ul className="testing-list">{pending.map(({ issue, worktree }) => <TestingRow key={`${worktree}:${issue.relPath}`} issue={issue} worktree={worktree} row={byName.get(worktree)} />)}</ul> : <p className="empty-state">Nothing waiting.</p>}</section></main>;
}

export function TestingPage() {
  const testing = trpc.testing.list.useQuery();
  const workstreams = trpc.workstreams.list.useQuery();
  if (testing.isLoading || workstreams.isLoading) return <main className="simple-page"><section className="loading-skeleton" aria-busy="true"><span /><span /></section></main>;
  if (testing.isError || workstreams.isError) { const message = testing.error?.message ?? workstreams.error?.message ?? "Unknown error"; return <main className="simple-page"><section className="error-state"><p>Couldn’t load manual testing: {message}</p><Button onClick={() => { void testing.refetch(); void workstreams.refetch(); }}>Retry</Button></section></main>; }
  return <TestingQueue landed={testing.data?.landed ?? []} pending={testing.data?.pending ?? []} rows={workstreams.data?.items ?? []} />;
}
