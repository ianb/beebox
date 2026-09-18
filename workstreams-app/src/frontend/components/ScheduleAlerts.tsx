import { Button, Pill } from "./ui.js";
import { Markdown } from "./Markdown.js";
import { useEffect, useRef } from "react";
import { friendlyTimestamp } from "../lib/format.js";
import { trpc } from "../trpc.js";
import type { ScheduleAlert, ScheduleAlertPriority } from "../../shared/schedules.js";

/** The same words and colours the popups use: the page and the notification
 *  say one thing. */
const priorityTones = {
  important: "danger",
  normal: "warning",
  fyi: "neutral",
} as const;

const PRIORITY_GROUPS = [
  { priority: "important", heading: "Important — act today" },
  { priority: "normal", heading: "Normal — review in the daily digest" },
  { priority: "fyi", heading: "FYI — closes after one digest" },
] as const satisfies ReadonlyArray<{ priority: ScheduleAlertPriority; heading: string }>;

const CLOSED_BY_TEXT = {
  person: "acknowledged",
  digest: "closed by the digest",
  schedule: "condition cleared",
} as const;

function AlertBody({ alert, showSchedule }: { alert: ScheduleAlert; showSchedule: boolean }) {
  return (
    <div className="schedule-alert-body">
      <div className="schedule-alert-head">
        <Pill tone={priorityTones[alert.priority]}>{alert.priority}</Pill>
        {showSchedule ? <span className="schedule-alert-schedule">{alert.workstream}</span> : null}
        <strong>{alert.title}</strong>
        <span className="muted">{friendlyTimestamp(alert.createdAt)}</span>
        {alert.runId ? <span className="muted">run {alert.runId}</span> : null}
      </div>
      {alert.condition !== null && alert.occurrences > 1 ? (
        <p className="muted schedule-alert-standing">
          seen {alert.occurrences} times since {friendlyTimestamp(alert.createdAt)}, last {friendlyTimestamp(alert.lastSeenAt)}
        </p>
      ) : null}
      {alert.issue !== null ? <p className="schedule-alert-standing">Filed as <code>{alert.issue}</code></p> : null}
      {alert.issue === null && alert.filingError !== null ? (
        <p className="action-error schedule-alert-standing">Could not file this as an issue: {alert.filingError}</p>
      ) : null}
      {alert.message ? <div className="schedule-alert-message"><Markdown source={alert.message} /></div> : null}
      {alert.details ? <Markdown source={alert.details} /> : null}
    </div>
  );
}

export interface ScheduleAlertListProps {
  alerts: ScheduleAlert[];
  onAcknowledge(id: string): void;
  acknowledging: string | null;
  error: string | null;
  selectedAlert?: string | null;
  /** Name each alert's schedule: the all-schedules page mixes them. */
  showSchedule?: boolean;
}

function rowClass(alert: ScheduleAlert, selected: string | null): string | undefined {
  return alert.id === selected ? "schedule-alert-selected" : undefined;
}

/** Presentational: open alerts grouped by priority, closed ones folded away. */
export function ScheduleAlertList({ alerts, onAcknowledge, acknowledging, error, selectedAlert, showSchedule }: ScheduleAlertListProps) {
  const open = alerts.filter((alert) => alert.state === "open");
  const closed = alerts.filter((alert) => alert.state === "acknowledged");
  const selected = selectedAlert ?? null;
  const named = showSchedule ?? false;
  const focusedAlert = useRef<string | null>(null);
  useEffect(() => {
    if (selected === null || focusedAlert.current === selected) return;
    const row = document.getElementById(`schedule-alert-${selected}`);
    if (row === null) return;
    row.scrollIntoView({ block: "center" });
    row.focus({ preventScroll: true });
    focusedAlert.current = selected;
  }, [selected]);
  const selectedMissing = selected !== null && !alerts.some((alert) => alert.id === selected);
  return (
    <section className="schedule-alerts" aria-label="Schedule alerts">
      <h2>Alerts <small>{open.length} open</small></h2>
      {error ? <p className="action-error" role="alert">{error}</p> : null}
      {selectedMissing ? <p className="action-error" role="alert">Alert {selected} is no longer available.</p> : null}
      {open.length === 0 ? <p className="empty-state">No open alerts.</p> : PRIORITY_GROUPS.map((group) => {
        const members = open.filter((alert) => alert.priority === group.priority);
        if (members.length === 0) return null;
        return (
          <div key={group.priority} className="schedule-alert-group">
            <h3>{group.heading} <small>{members.length}</small></h3>
            <ul className="schedule-alert-list">
              {members.map((alert) => (
                <li key={alert.id} id={`schedule-alert-${alert.id}`} className={rowClass(alert, selected)} tabIndex={-1}>
                  <AlertBody alert={alert} showSchedule={named} />
                  <Button
                    type="button"
                    disabled={acknowledging === alert.id}
                    onClick={() => onAcknowledge(alert.id)}
                  >
                    {acknowledging === alert.id ? "Acknowledging…" : "Acknowledge"}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {closed.length > 0 ? (
        <details className="schedule-alerts-acknowledged" open={closed.some((alert) => alert.id === selected)}>
          <summary>Closed in the last 14 days <small>{closed.length}</small></summary>
          <ul className="schedule-alert-list">
            {closed.map((alert) => (
              <li key={alert.id} id={`schedule-alert-${alert.id}`} className={rowClass(alert, selected)} tabIndex={-1}>
                <AlertBody alert={alert} showSchedule={named} />
                <span className="muted">
                  {CLOSED_BY_TEXT[alert.closedBy ?? "person"]} {alert.acknowledgedAt ? friendlyTimestamp(alert.acknowledgedAt) : "at an unrecorded time"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/**
 * The alerts of one scheduled workstream, or of every schedule when `name` is
 * null: fetched here, acknowledged through `bin/schedules ack` on the server,
 * rendered by the list above.
 */
export function ScheduleAlerts({ name, selectedAlert }: { name: string | null; selectedAlert?: string | null }) {
  const alerts = trpc.schedules.alerts.useQuery({ workstream: name }, { staleTime: 10_000 });
  const utils = trpc.useUtils();
  const acknowledge = trpc.schedules.acknowledge.useMutation({
    async onSuccess() {
      // Every alerts query: the per-schedule and all-schedules views share records.
      await utils.schedules.alerts.invalidate();
      await utils.workstreams.list.invalidate();
    },
  });
  if (alerts.isLoading) {
    return <div className="loading-skeleton" aria-busy="true"><span /><span /></div>;
  }
  if (alerts.isError) {
    return (
      <div className="error-state">
        <p>Couldn’t load alerts for {name ?? "all schedules"}: {alerts.error.message}</p>
        <Button type="button" onClick={() => void alerts.refetch()}>Retry</Button>
      </div>
    );
  }
  return (
    <ScheduleAlertList
      alerts={alerts.data?.items ?? []}
      acknowledging={acknowledge.isPending ? acknowledge.variables.id : null}
      error={acknowledge.isError ? acknowledge.error.message : null}
      selectedAlert={selectedAlert ?? null}
      showSchedule={name === null}
      onAcknowledge={(id) => acknowledge.mutate({ id })}
    />
  );
}
