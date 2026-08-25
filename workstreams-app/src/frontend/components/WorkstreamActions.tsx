import { useState } from "react";
import { Button } from "./ui.js";
import { trpc } from "../trpc.js";
import type { ActionVerb, LifecycleJob, Workstream } from "../types.js";

/**
 * A schedule is sticky and always shown as one, worktree or not: the boxholder
 * asked for these in their own section rather than mixed into "In progress"
 * whenever a run happens to have a live session
 * (callback-box/docs/plans/scheduled-workstreams.md, Track D).
 */
export function isScheduled(row: Workstream): boolean {
  return row.routing.state === "scheduled" || row.schedule !== null;
}

/**
 * A scheduled record routes to `resume-with-briefing`, and `bin/workstreams
 * resume` already recreates its worktree and launches — so a resting schedule
 * gets the same Resume the dormant and culled rows get, and one whose run is
 * under way gets Focus like any live row. The boxholder's way into a schedule
 * is to go into the workstream and chat.
 */
export function workstreamActionVerbs(row: Workstream): ActionVerb[] {
  if (row.routing.action === "wait-for-launch") return [];
  if (isScheduled(row)) return row.agent.state === "live" ? ["focus"] : ["resume"];
  if (row.session.removed) return ["focus", "resume"];
  if (row.git === null) return row.session.agent && (row.session.launch.state === "failed" || row.session.launch.state === "expired") ? ["resume"] : [];
  return ["focus", "close"];
}

const resumeLabels: Record<LifecycleJob["stage"], string> = { queued: "Request accepted", checking: "Checking workstream", restoring: "Restoring worktree", preparing: "Preparing session", "opening-terminal": "Opening Terminal", opened: "Terminal opened", ready: "Session ready", failed: "Resume failed" };

function ResumeProgress({ job }: { job: LifecycleJob }) {
  const state = trpc.actions.job.useQuery({ id: job.id }, { refetchInterval: (query) => { const value = query.state.data; return value && (value.stage === "ready" || value.stage === "opened" || value.stage === "failed") ? false : 750; } });
  const current = state.data ?? job;
  return <span className={current.stage === "failed" ? "action-error" : "action-progress"} role="status">{resumeLabels[current.stage]}{current.error ? ` · ${current.error}` : ""}</span>;
}

/** The lifecycle buttons a row is entitled to, plus resume's progress readout. */
export function WorkstreamActions({ row, children }: { row: Workstream; children?: React.ReactNode }) {
  const action = trpc.actions.run.useMutation();
  const [job, setJob] = useState<LifecycleJob | null>(null);
  function run(verb: ActionVerb): void { action.mutate({ verb, name: row.name }, { onSuccess(result) { if (result.status === "started") setJob(result.job); } }); }
  const verbs = workstreamActionVerbs(row);
  return <div className="workstream-actions">{verbs.includes("focus") ? <Button type="button" disabled={action.isPending} onClick={() => run("focus")}>Focus</Button> : null}{verbs.includes("resume") ? <Button type="button" intent="primary" disabled={action.isPending} onClick={() => run("resume")}>{row.git === null && !isScheduled(row) ? "Retry" : "Resume"}</Button> : null}{verbs.includes("close") ? <Button type="button" disabled={action.isPending} onClick={() => run("close")}>Close</Button> : null}{children}{job ? <ResumeProgress job={job} /> : null}{action.isError ? <span className="action-error" role="alert">{action.error.message}</span> : null}</div>;
}
