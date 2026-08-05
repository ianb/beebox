/**
 * Health warnings — shows failed health checks on the dashboard.
 * Only renders when there are issues; invisible when everything is healthy.
 */

import type { RouterOutput } from "../../lib/trpc";
import { Button } from "../ui/Button";

type HealthResponse = RouterOutput["health"]["check"];

interface HealthWarningsProps {
  health: HealthResponse | null;
  canAcceptBoxGrowth: boolean;
  acceptingBoxGrowth: boolean;
  acceptanceError: string | null;
  onAcceptBoxGrowth: () => Promise<void>;
}

export function HealthWarnings({
  health,
  canAcceptBoxGrowth,
  acceptingBoxGrowth,
  acceptanceError,
  onAcceptBoxGrowth,
}: HealthWarningsProps) {
  if (!health) return null;
  if (health.status === "healthy") return null;

  const failures = health.checks.filter((c) => !c.ok);
  if (failures.length === 0) return null;

  const heading = health.status === "unhealthy" ? "Box health issues" : "Box warnings";
  return (
    <section aria-label={heading} className="min-w-0 rounded-lg border border-warning-light bg-warning-50 p-3 space-y-1">
      <div className="text-sm font-medium text-warning-dark">
        {heading}
      </div>
      {failures.map((check) => (
        <div key={check.name} className="space-y-2">
          <div
            className={`text-xs break-words ${check.severity === "error" ? "text-danger-dark" : "text-warning-dark"}`}
          >
            {check.severity === "error" ? "\u2718" : "\u26A0"} {check.message}
          </div>
          {check.action === "accept-box-growth" && canAcceptBoxGrowth ? (
            <Button
              intent="secondary"
              size="sm"
              loading={acceptingBoxGrowth}
              loadingLabel="Accepting…"
              onClick={onAcceptBoxGrowth}
            >
              Accept current size
            </Button>
          ) : null}
        </div>
      ))}
      {acceptanceError !== null ? (
        <div role="alert" className="text-xs text-danger-dark">
          Could not accept current size: {acceptanceError}
        </div>
      ) : null}
    </section>
  );
}
