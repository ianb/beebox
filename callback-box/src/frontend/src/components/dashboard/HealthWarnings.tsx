/**
 * Health warnings — shows failed health checks on the dashboard.
 * Only renders when there are issues; invisible when everything is healthy.
 */

import type { RouterOutput } from "../../lib/trpc";

type HealthResponse = RouterOutput["health"]["check"];

interface HealthWarningsProps {
  health: HealthResponse | null;
}

export function HealthWarnings({ health }: HealthWarningsProps) {
  if (!health) return null;
  if (health.status === "healthy") return null;

  const failures = health.checks.filter((c) => !c.ok);
  if (failures.length === 0) return null;

  return (
    <div className="rounded-lg border border-warning-light bg-warning-50 p-3 space-y-1">
      <div className="text-sm font-medium text-warning-dark">
        {health.status === "unhealthy" ? "Box health issues" : "Box warnings"}
      </div>
      {failures.map((check) => (
        <div
          key={check.name}
          className={`text-xs ${check.severity === "error" ? "text-danger-dark" : "text-warning-dark"}`}
        >
          {check.severity === "error" ? "\u2718" : "\u26A0"} {check.message}
        </div>
      ))}
    </div>
  );
}
