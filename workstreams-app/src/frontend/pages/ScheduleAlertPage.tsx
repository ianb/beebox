import { Link, useParams, useSearch } from "@tanstack/react-router";

import { ScheduleAlerts } from "../components/ScheduleAlerts.js";

export function ScheduleAlertPage() {
  const params = useParams({ strict: false });
  const search = useSearch({ strict: false });
  const name = typeof params.name === "string" ? params.name : "schedule";
  const selectedAlert = typeof search.alert === "string" ? search.alert : null;
  return (
    <main className="simple-page">
      <p><Link to="/streams">← schedules</Link></p>
      <h1>{name} alerts</h1>
      <ScheduleAlerts name={name} selectedAlert={selectedAlert} />
    </main>
  );
}
