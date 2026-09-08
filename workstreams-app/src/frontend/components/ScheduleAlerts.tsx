import { Button, Pill } from "./ui.js";
import { Markdown } from "./Markdown.js";
import { useEffect, useRef } from "react";
import { friendlyTimestamp } from "../lib/format.js";
import { trpc } from "../trpc.js";
import type { ScheduleAlert } from "../../shared/schedules.js";

const priorityTones = {
  important: "danger",
  normal: "info",
  backlog: "neutral",
  fyi: "neutral",
} as const;

function AlertBody({ alert }: { alert: ScheduleAlert }) {
  return (
    <div className="schedule-alert-body">
      <div className="schedule-alert-head">
        <Pill tone={priorityTones[alert.priority]}>{alert.priority}</Pill>
        <strong>{alert.title}</strong>
        <span className="muted">{friendlyTimestamp(alert.createdAt)}</span>
        {alert.runId ? <span className="muted">run {alert.runId}</span> : null}
      </div>
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
}

/** Presentational: open alerts in full, the acknowledged ones folded away. */
export function ScheduleAlertList({ alerts, onAcknowledge, acknowledging, error, selectedAlert }: ScheduleAlertListProps) {
  const open = alerts.filter((alert) => alert.state === "open");
  const acknowledged = alerts.filter((alert) => alert.state === "acknowledged");
  const selected = selectedAlert ?? null;
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
      {open.length === 0 ? <p className="empty-state">No open alerts.</p> : (
        <ul className="schedule-alert-list">
          {open.map((alert) => (
            <li
              key={alert.id}
              id={`schedule-alert-${alert.id}`}
              className={alert.id === selected ? "schedule-alert-selected" : undefined}
              tabIndex={-1}
            >
              <AlertBody alert={alert} />
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
      )}
      {acknowledged.length > 0 ? (
        <details className="schedule-alerts-acknowledged" open={acknowledged.some((alert) => alert.id === selected)}>
          <summary>Acknowledged in the last 14 days <small>{acknowledged.length}</small></summary>
          <ul className="schedule-alert-list">
            {acknowledged.map((alert) => (
              <li
                key={alert.id}
                id={`schedule-alert-${alert.id}`}
                className={alert.id === selected ? "schedule-alert-selected" : undefined}
                tabIndex={-1}
              >
                <AlertBody alert={alert} />
                <span className="muted">
                  acknowledged {alert.acknowledgedAt ? friendlyTimestamp(alert.acknowledgedAt) : "at an unrecorded time"}
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
 * The alerts of one scheduled workstream: fetched here, acknowledged through
 * `bin/schedules ack` on the server, rendered by the list above.
 */
export function ScheduleAlerts({ name, selectedAlert }: { name: string; selectedAlert?: string | null }) {
  const alerts = trpc.schedules.alerts.useQuery({ workstream: name }, { staleTime: 10_000 });
  const utils = trpc.useUtils();
  const acknowledge = trpc.schedules.acknowledge.useMutation({
    async onSuccess() {
      await utils.schedules.alerts.invalidate({ workstream: name });
      await utils.workstreams.list.invalidate();
    },
  });
  if (alerts.isLoading) {
    return <div className="loading-skeleton" aria-busy="true"><span /><span /></div>;
  }
  if (alerts.isError) {
    return (
      <div className="error-state">
        <p>Couldn’t load alerts for {name}: {alerts.error.message}</p>
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
      onAcknowledge={(id) => acknowledge.mutate({ id })}
    />
  );
}
