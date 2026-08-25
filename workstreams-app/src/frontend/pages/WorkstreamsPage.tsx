import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { WorkstreamIssueSummary } from "../components/WorkstreamIssueSummary.js";
import { Button, Pill } from "../components/ui.js";
import { relativeTime } from "../lib/format.js";
import { trpc } from "../trpc.js";
import type { ActionVerb, Issue, LifecycleJob, Workstream } from "../types.js";

function launchStateFor(row: Workstream): { section: string; note: string } | null {
  if (row.routing.state === "launching") return { section: "Launching", note: "setting up worktree and agent" };
  switch (row.session.launch.state) {
    case "failed": return { section: "Launch needs attention", note: "setup failed" };
    case "expired": return { section: "Launch needs attention", note: "setup lease expired" };
    case "unknown": return { section: "Launch needs attention", note: "launch state unreadable" };
    case "active":
    case "none": return null;
  }
}

export function workstreamStateFor(row: Workstream): { section: string; note: string } {
  if (row.session.archived) return { section: "Archived", note: `archived ${relativeTime(row.session.archived.at)}` };
  const launchState = launchStateFor(row);
  if (launchState) return launchState;
  if (row.session.removed?.merged) return { section: "Recently culled", note: `removed ${relativeTime(row.session.removed.at)}` };
  if (row.session.removed) return { section: "Removed with unmerged work", note: `final ${row.session.removed.finalSha?.slice(0, 10) ?? "SHA unavailable"}` };
  if (row.boxState.keepUnmerged || row.boxState.testSetup) return { section: "Held for testing", note: "worktree held for testing" };
  if (row.routing.state === "stale") return { section: "Stale", note: "new stream preferred" };
  if (row.git?.merged && row.agent.state === "live") return { section: "Merged ✓, session still open", note: "close freely" };
  if (row.git?.dirty === 0 && row.git.tip !== null && row.git.tip === row.session.baseSha && row.agent.state !== "live") return { section: "Untouched", note: "created, no work committed" };
  if (row.routing.state === "dormant" || row.routing.state === "removed") return { section: "Dormant", note: row.routing.state === "removed" ? "removed, revivable" : "session closed" };
  return { section: "In progress", note: row.agent.state === "live" ? "working" : "liveness unknown" };
}

function AgentState({ item }: { item: Workstream }) {
  const active = item.agent.state === "live";
  const agent = item.session.agent === "codex" ? "Codex" : item.session.agent === "claude" ? "Claude" : null;
  const label = active ? `● ${agent ?? "Agent"} active` : item.agent.state === "launching" ? `${agent ?? "Agent"} launching` : agent ? `${agent} · ${item.agent.state}` : item.agent.state;
  return <span className={`agent-state ${active ? "agent-state-live" : ""}`}>{label}</span>;
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
  const verbs = workstreamActionVerbs(row);
  return <div className="workstream-actions">{verbs.includes("focus") ? <Button type="button" disabled={action.isPending} onClick={() => run("focus")}>Focus</Button> : null}{verbs.includes("resume") ? <Button type="button" intent="primary" disabled={action.isPending} onClick={() => run("resume")}>{row.git === null ? "Retry" : "Resume"}</Button> : null}{verbs.includes("close") ? <Button type="button" disabled={action.isPending} onClick={() => run("close")}>Close</Button> : null}{job ? <ResumeProgress job={job} /> : null}{action.isError ? <span className="action-error" role="alert">{action.error.message}</span> : null}</div>;
}

export function workstreamActionVerbs(row: Workstream): ActionVerb[] {
  if (row.routing.action === "wait-for-launch") return [];
  if (row.session.removed) return ["focus", "resume"];
  if (row.git === null) return row.session.agent && (row.session.launch.state === "failed" || row.session.launch.state === "expired") ? ["resume"] : [];
  return ["focus", "close"];
}

function WorkstreamRow({ row, issues }: { row: Workstream; issues: Issue[] }) {
  const state = workstreamStateFor(row);
  const related = issues.filter((issue) => issue.frontmatter.workstream === row.name || issue.frontmatter.discoveredIn === row.name);
  const activity = row.routing.lastActivityAt ? relativeTime(row.routing.lastActivityAt) : "age unknown";
  return <li className="workstream-row"><div className="workstream-row-main"><Link to="/$name" params={{ name: row.name }} className="workstream-name"><span aria-hidden="true">{row.session.emoji ?? "·"}</span>{row.name}</Link><span className="workstream-description">{row.session.description ?? "No description"}</span><span className="workstream-note">{state.note} · {activity}</span><Pill tone={row.routing.action === "new-stream-preferred" ? "warning" : row.routing.action === "manual-forward" ? "manual" : "info"}>{row.routing.action}</Pill><AgentState item={row} />{row.boxState.keepUnmerged ? <Pill tone="warning">keep unmerged</Pill> : row.boxState.testSetup ? <Pill tone="warning">test1 {row.boxState.pristine ? "pristine" : "dirtied"}</Pill> : null}<Actions row={row} /></div>{related.length > 0 ? <div className="workstream-issues">{related.map((issue) => <WorkstreamIssueSummary key={`${issue.visibility}:${issue.relPath}`} issue={issue} owned={issue.frontmatter.workstream === row.name} discovered={issue.frontmatter.discoveredIn === row.name} />)}</div> : null}</li>;
}

const SECTION_ORDER = ["Launching", "Launch needs attention", "In progress", "Merged ✓, session still open", "Untouched", "Held for testing", "Dormant", "Stale", "Recently culled", "Removed with unmerged work", "Archived"];

function WorkstreamsContent({ rows, issues, warnings }: { rows: Workstream[]; issues: Issue[]; warnings: Array<{ message: string }> }) {
  const search = useSearch({ strict: false });
  const query = typeof search.q === "string" ? search.q : undefined;
  const navigate = useNavigate();
  const [text, setText] = useState(query ?? "");
  const filtered = text.trim() ? rows.filter((row) => `${row.name} ${row.session.description ?? ""}`.toLowerCase().includes(text.trim().toLowerCase())) : rows;
  const sections = new Map<string, Workstream[]>();
  for (const name of SECTION_ORDER) sections.set(name, []);
  for (const row of filtered) sections.get(workstreamStateFor(row).section)?.push(row);
  return <>{warnings.length > 0 ? <section className="warning-state" role="alert"><p>Workstream inventory warnings.</p><ul>{warnings.map((warning, index) => <li key={`${index}:${warning.message}`}>{warning.message}</li>)}</ul></section> : null}<form className="workstream-search" role="search" onSubmit={(event) => { event.preventDefault(); void navigate({ to: "/", search: text ? { q: text } : {} }); }}><input value={text} onChange={(event) => setText(event.target.value)} placeholder="Search names and descriptions" aria-label="Search workstreams" /><Button intent="primary">Search</Button></form>{text && filtered.length === 0 ? <p className="empty-state">No matching workstreams.</p> : null}{SECTION_ORDER.map((name) => { const section = sections.get(name) ?? []; return section.length > 0 ? <section className="workstream-section" key={name}><h2>{name} <small>{section.length}</small></h2><ul>{section.map((row) => <WorkstreamRow key={row.name} row={row} issues={issues} />)}</ul></section> : null; })}</>;
}

export function WorkstreamsPage() {
  const workstreams = trpc.workstreams.list.useQuery(undefined, { staleTime: 10_000, refetchOnWindowFocus: true });
  const issues = trpc.issues.list.useQuery(undefined, { staleTime: 10_000, refetchOnWindowFocus: true });
  const error = workstreams.error ? `Couldn’t load workstreams: ${workstreams.error.message}` : issues.error ? `Couldn’t load workstream issues: ${issues.error.message}` : null;
  return <main className="workstreams-page"><WorkstreamsHeader />{workstreams.isLoading || issues.isLoading ? <section className="loading-skeleton" aria-busy="true"><span /><span /><span /></section> : error ? <section className="error-state"><p>{error}</p><Button onClick={() => { void workstreams.refetch(); void issues.refetch(); }}>Retry</Button></section> : <WorkstreamsContent rows={workstreams.data?.items ?? []} issues={issues.data?.items ?? []} warnings={workstreams.data?.warnings ?? []} />}</main>;
}

export function WorkstreamsHeader() {
  return <header className="workstreams-header"><div><h1>workstreams</h1><p className="muted">Sessions, issue ownership, and testing state.</p></div></header>;
}
