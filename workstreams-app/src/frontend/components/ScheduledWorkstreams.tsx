import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ScheduleAlerts } from "./ScheduleAlerts.js";
import { WorkstreamIssueSummary } from "./WorkstreamIssueSummary.js";
import { Button, Pill } from "./ui.js";
import { relativeTime } from "../lib/format.js";
import type { Issue, Workstream } from "../types.js";

/** A tick older than this is a dead scheduler, not a quiet one. */
const HEARTBEAT_STALE_MS = 60 * 60 * 1000;

export interface HeartbeatStatus {
  text: string;
  stale: boolean;
}

/**
 * The scheduler's own liveness, carried per row because a consumer that only
 * ever sees rows still has to be able to tell that the tick itself died.
 */
export function scheduleHeartbeatStatus(rows: Workstream[], now?: Date): HeartbeatStatus {
  const ticks = rows
    .map((row) => row.schedule?.heartbeat?.lastTickAt)
    .filter((value): value is string => value !== undefined);
  const latest = ticks.toSorted().at(-1);
  if (latest === undefined) return { text: "scheduler never ticked", stale: true };
  const reference = now ?? new Date();
  const elapsed = reference.getTime() - new Date(latest).getTime();
  return {
    text: `scheduler: last tick ${relativeTime(latest, reference)}`,
    stale: !Number.isFinite(elapsed) || elapsed > HEARTBEAT_STALE_MS,
  };
}

/** Cadence, last run, next due, and the two things that mean act now. */
export function ScheduleFacts({ schedule }: { schedule: NonNullable<Workstream["schedule"]> }) {
  return (
    <>
      <span className="schedule-fact">every {schedule.cadence}</span>
      <span className="schedule-fact">
        last run {schedule.lastRunAt ? relativeTime(schedule.lastRunAt) : "never"}
        {schedule.lastOutcome ? ` · ${schedule.lastOutcome}` : ""}
      </span>
      <span className="schedule-fact">
        next due {schedule.nextDueAt ? relativeTime(schedule.nextDueAt) : "—"}
      </span>
      {schedule.enabled ? null : <Pill tone="neutral">disabled</Pill>}
      {schedule.overdue ? <Pill tone="danger">overdue</Pill> : null}
      {schedule.openAlerts > 0
        ? <Pill tone="warning">{schedule.openAlerts} open alert{schedule.openAlerts === 1 ? "" : "s"}</Pill>
        : null}
    </>
  );
}

function ScheduledRow({ row, issues }: { row: Workstream; issues: Issue[] }) {
  const [open, setOpen] = useState(false);
  const related = issues.filter((issue) =>
    issue.frontmatter.workstream === row.name || issue.frontmatter.discoveredIn === row.name);
  return (
    <li className="workstream-row">
      <div className="workstream-row-main">
        <Link to="/$name" params={{ name: row.name }} className="workstream-name">
          <span aria-hidden="true">{row.session.emoji ?? "·"}</span>{row.name}
        </Link>
        <span className="workstream-description">{row.session.description ?? "No description"}</span>
        {row.schedule ? <ScheduleFacts schedule={row.schedule} /> : <span className="workstream-note">schedule unreadable</span>}
        <div className="workstream-actions">
          <Button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide alerts" : "Alerts"}
          </Button>
        </div>
      </div>
      {open ? <ScheduleAlerts name={row.name} /> : null}
      {related.length > 0 ? (
        <div className="workstream-issues">
          {related.map((issue) => (
            <WorkstreamIssueSummary
              key={`${issue.visibility}:${issue.relPath}`}
              issue={issue}
              owned={issue.frontmatter.workstream === row.name}
              discovered={issue.frontmatter.discoveredIn === row.name}
            />
          ))}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The Scheduled section of the workstream inventory. Owns its own landmark and
 * its own heading, heartbeat included: a section of schedules whose scheduler
 * is dead is exactly the state the plan exists to make visible.
 */
export function ScheduledSection({ rows, issues, now }: { rows: Workstream[]; issues: Issue[]; now?: Date }) {
  const heartbeat = scheduleHeartbeatStatus(rows, now);
  return (
    <section className="workstream-section">
      <h2>
        Scheduled <small>{rows.length}</small>
        <span className={heartbeat.stale ? "schedule-heartbeat schedule-heartbeat-stale" : "schedule-heartbeat"}>
          {heartbeat.text}
        </span>
      </h2>
      <ul>
        {rows.map((row) => <ScheduledRow key={row.name} row={row} issues={issues} />)}
      </ul>
    </section>
  );
}
