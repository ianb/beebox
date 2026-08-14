import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { QuotaPanel } from "../components/QuotaPanel.js";
import { WorkstreamIssueSummary } from "../components/WorkstreamIssueSummary.js";
import { Button, Pill } from "../components/ui.js";
import { relativeTime } from "../lib/format.js";
import { trpc } from "../trpc.js";
import type { ActionVerb, Issue, LifecycleJob, Quota, Workstream } from "../types.js";

function stateFor(row: Workstream): { section: string; note: string } {
  if (row.session.archived) return { section: "Archived", note: `archived ${relativeTime(row.session.archived.at)}` };
  if (row.session.removed?.merged) return { section: "Recently culled", note: `removed ${relativeTime(row.session.removed.at)}` };
  if (row.session.removed) return { section: "Removed with unmerged work", note: `final ${row.session.removed.finalSha?.slice(0, 10) ?? "SHA unavailable"}` };
  if (row.boxState.keepUnmerged || row.boxState.testSetup) return { section: "Held for testing", note: "worktree held for testing" };
  if (row.git?.merged && row.agent.state === "live") return { section: "Merged ✓, session still open", note: "close freely" };
  if (row.git?.dirty === 0 && row.git.tip !== null && row.git.tip === row.session.baseSha && row.agent.state !== "live") return { section: "Untouched", note: "created, no work committed" };
  return { section: "In progress", note: row.agent.state === "live" ? "working" : row.agent.state === "unknown" ? "liveness unknown" : "session closed" };
}

function AgentState({ item }: { item: Workstream }) {
  const active = item.agent.state === "live";
  const agent = item.session.agent === "codex" ? "Codex" : item.session.agent === "claude" ? "Claude" : null;
  return <span className={`agent-state ${active ? "agent-state-live" : ""}`}>{active ? `● ${agent ?? "Agent"} active` : agent ? `${agent} · ${item.agent.state}` : item.agent.state}</span>;
}

const resumeLabels: Record<LifecycleJob["stage"], string> = { queued: "Request accepted", checking: "Checking workstream", restoring: "Restoring worktree", preparing: "Preparing session", "opening-terminal": "Opening Terminal", opened: "Terminal opened", ready: "Session ready", failed: "Resume failed" };

function ResumeProgress({ job }: { job: LifecycleJob }) {
  const state = trpc.actions.job.useQuery({ id: job.id }, { refetchInterval: (query) => { const value = query.state.data; return value && (value.stage === "ready" || value.stage === "opened" || value.stage === "failed") ? false : 750; } });
  const current = state.data ?? job;
  return <span className={current.stage === "failed" ? "action-error" : "action-progress"} role="status">{resumeLabels[current.stage]}{current.error ? ` · ${current.error}` : ""}</span>;
}

function Actions({ row }: { row: Workstream }) {
  const action = trpc.actions.run.useMutation();
  const [job, setJob] = useState<LifecycleJob | null>(null);
  function run(verb: ActionVerb): void { action.mutate({ verb, name: row.name }, { onSuccess(result) { if (result.status === "started") setJob(result.job); } }); }
  return <div className="workstream-actions"><Button type="button" disabled={action.isPending} onClick={() => run("focus")}>Focus</Button>{row.session.removed ? <Button type="button" intent="primary" disabled={action.isPending} onClick={() => run("resume")}>Resume</Button> : <Button type="button" disabled={action.isPending} onClick={() => run("close")}>Close</Button>}{job ? <ResumeProgress job={job} /> : null}{action.isError ? <span className="action-error" role="alert">{action.error.message}</span> : null}</div>;
}

function WorkstreamRow({ row, issues }: { row: Workstream; issues: Issue[] }) {
  const state = stateFor(row);
  const related = issues.filter((issue) => issue.frontmatter.workstream === row.name || issue.frontmatter.discoveredIn === row.name);
  return <li className="workstream-row"><div className="workstream-row-main"><Link to="/workstreams/$name" params={{ name: row.name }} className="workstream-name"><span aria-hidden="true">{row.session.emoji ?? "·"}</span>{row.name}</Link><span className="workstream-note">{state.note}</span><AgentState item={row} />{row.boxState.keepUnmerged ? <Pill tone="warning">keep unmerged</Pill> : row.boxState.testSetup ? <Pill tone="warning">test1 {row.boxState.pristine ? "pristine" : "dirtied"}</Pill> : null}<Actions row={row} /></div>{related.length > 0 ? <div className="workstream-issues">{related.map((issue) => <WorkstreamIssueSummary key={`${issue.visibility}:${issue.relPath}`} issue={issue} owned={issue.frontmatter.workstream === row.name} discovered={issue.frontmatter.discoveredIn === row.name} />)}</div> : null}</li>;
}

const SECTION_ORDER = ["In progress", "Merged ✓, session still open", "Untouched", "Held for testing", "Recently culled", "Removed with unmerged work", "Archived"];

function WorkstreamsContent({ rows, issues }: { rows: Workstream[]; issues: Issue[] }) {
  const search = useSearch({ strict: false });
  const query = typeof search.q === "string" ? search.q : undefined;
  const navigate = useNavigate();
  const [text, setText] = useState(query ?? "");
  const filtered = text.trim() ? rows.filter((row) => row.name.toLowerCase().includes(text.trim().toLowerCase())) : rows;
  const sections = new Map<string, Workstream[]>();
  for (const name of SECTION_ORDER) sections.set(name, []);
  for (const row of filtered) sections.get(stateFor(row).section)?.push(row);
  return <><form className="workstream-search" role="search" onSubmit={(event) => { event.preventDefault(); void navigate({ to: "/", search: text ? { q: text } : {} }); }}><input value={text} onChange={(event) => setText(event.target.value)} placeholder="Search workstreams" aria-label="Search workstreams" /><Button intent="primary">Search</Button></form>{text && filtered.length === 0 ? <p className="empty-state">No matching workstreams.</p> : null}{SECTION_ORDER.map((name) => { const section = sections.get(name) ?? []; return section.length > 0 ? <section className="workstream-section" key={name}><h2>{name} <small>{section.length}</small></h2><ul>{section.map((row) => <WorkstreamRow key={row.name} row={row} issues={issues} />)}</ul></section> : null; })}</>;
}

export function WorkstreamsPage() {
  const dashboard = trpc.dashboard.get.useQuery(undefined, { staleTime: 10_000, refetchOnWindowFocus: true });
  const quotaItems: Quota[] = dashboard.data?.quotas ?? [];
  return <main className="workstreams-page"><header className="workstreams-header"><div><h1>workstreams</h1><p className="muted">Sessions, issue ownership, and testing state.</p></div><QuotaPanel quotas={quotaItems} /></header>{dashboard.isLoading ? <section className="loading-skeleton" aria-busy="true"><span /><span /><span /></section> : dashboard.isError ? <section className="error-state"><p>Couldn’t load workstreams: {dashboard.error.message}</p><Button onClick={() => void dashboard.refetch()}>Retry</Button></section> : <WorkstreamsContent rows={dashboard.data?.workstreams ?? []} issues={dashboard.data?.issues ?? []} />}</main>;
}
