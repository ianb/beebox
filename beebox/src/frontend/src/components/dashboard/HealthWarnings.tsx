/**
 * Health warnings — shows failed health checks on the dashboard.
 * Only renders when there are issues; invisible when everything is healthy.
 */

import type { RouterOutput } from "../../lib/trpc";
import { Button } from "../ui/Button";

type HealthResponse = RouterOutput["health"]["check"];

interface HealthWarningsProps {
  health: HealthResponse | null;
  canManageBoxGrowth: boolean;
  growthActionPending: "acknowledge" | "expect-rates" | null;
  growthActionError: string | null;
  onAcknowledgeBoxGrowth: () => Promise<void>;
  onExpectBoxGrowthRates: () => Promise<void>;
}

export function HealthWarnings({
  health,
  canManageBoxGrowth,
  growthActionPending,
  growthActionError,
  onAcknowledgeBoxGrowth,
  onExpectBoxGrowthRates,
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
          {check.actions !== undefined && canManageBoxGrowth ? (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-2">
                {check.actions.includes("acknowledge-box-growth") ? (
                  <Button
                    intent="secondary"
                    size="sm"
                    loading={growthActionPending === "acknowledge"}
                    disabled={growthActionPending !== null}
                    loadingLabel="Acknowledging…"
                    onClick={onAcknowledgeBoxGrowth}
                  >
                    Acknowledge this growth
                  </Button>
                ) : null}
                {check.actions.includes("expect-box-growth-rates") ? (
                  <Button
                    intent="secondary"
                    size="sm"
                    loading={growthActionPending === "expect-rates"}
                    disabled={growthActionPending !== null}
                    loadingLabel="Saving expectation…"
                    onClick={onExpectBoxGrowthRates}
                  >
                    Expect these rates
                  </Button>
                ) : null}
              </div>
              {check.actions.includes("expect-box-growth-rates") ? (
                <div className="text-xs text-warning-dark">
                  Acknowledge records this milestone but keeps rate limits. Expecting these rates gives the displayed rates 50% headroom.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
      {growthActionError !== null ? (
        <div role="alert" className="text-xs text-danger-dark">
          Could not update growth monitoring: {growthActionError}
        </div>
      ) : null}
    </section>
  );
}
