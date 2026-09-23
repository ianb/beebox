import { Link, useParams, useSearch } from "@tanstack/react-router";

import { ScheduleAlerts } from "../components/ScheduleAlerts.js";

/**
 * `/alerts` — every schedule's alerts, where the daily digest and every popup
 * land — and `/alerts/<schedule>`, the same list for one schedule.
 */
export function ScheduleAlertPage() {
  const params = useParams({ strict: false });
  const search = useSearch({ strict: false });
  const name = typeof params.name === "string" ? params.name : null;
  const selectedAlert = typeof search.alert === "string" ? search.alert : null;
  return (
    <main className="simple-page">
      <p>
        <Link to="/streams">← schedules</Link>
        {name === null ? null : <> · <Link to="/alerts">all alerts</Link></>}
      </p>
      <h1>{name === null ? "Schedule alerts" : `${name} alerts`}</h1>
      <ScheduleAlerts name={name} selectedAlert={selectedAlert} />
    </main>
  );
}
