import { Button, Pill } from "./ui.js";
import { Markdown } from "./Markdown.js";
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
      {alert.message ? <p className="schedule-alert-message">{alert.message}</p> : null}
      {alert.details ? <Markdown source={alert.details} /> : null}
    </div>
  );
}

export interface ScheduleAlertListProps {
  alerts: ScheduleAlert[];
  onAcknowledge(id: string): void;
  acknowledging: string | null;
  error: string | null;
}

/** Presentational: open alerts in full, the acknowledged ones folded away. */
export function ScheduleAlertList({ alerts, onAcknowledge, acknowledging, error }: ScheduleAlertListProps) {
  const open = alerts.filter((alert) => alert.state === "open");
  const acknowledged = alerts.filter((alert) => alert.state === "acknowledged");
  return (
    <section className="schedule-alerts" aria-label="Schedule alerts">
      <h2>Alerts <small>{open.length} open</small></h2>
      {error ? <p className="action-error" role="alert">{error}</p> : null}
      {open.length === 0 ? <p className="empty-state">No open alerts.</p> : (
        <ul className="schedule-alert-list">
          {open.map((alert) => (
            <li key={alert.id}>
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
        <details className="schedule-alerts-acknowledged">
          <summary>Acknowledged in the last 14 days <small>{acknowledged.length}</small></summary>
          <ul className="schedule-alert-list">
            {acknowledged.map((alert) => (
              <li key={alert.id}>
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
export function ScheduleAlerts({ name }: { name: string }) {
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
      onAcknowledge={(id) => acknowledge.mutate({ id })}
    />
  );
}
