/**
 * Health warnings — shows failed health checks on the dashboard.
 * Only renders when there are issues; invisible when everything is healthy.
 */

import type { RouterOutput } from "../../lib/trpc";
import { Button } from "../ui/Button";

type HealthResponse = RouterOutput["health"]["check"];

/** Which owner action is in flight: a growth decision, or dismissing one check's connector episode. */
export type HealthActionPending =
  | { kind: "acknowledge" }
  | { kind: "expect-rates" }
  | { kind: "dismiss"; check: string }
  | null;

interface HealthWarningsProps {
  health: HealthResponse | null;
  canManage: boolean;
  actionPending: HealthActionPending;
  actionError: string | null;
  onAcknowledgeBoxGrowth: () => Promise<void>;
  onExpectBoxGrowthRates: () => Promise<void>;
  onDismissConnectorEpisode: (check: string) => Promise<void>;
}

export function HealthWarnings({
  health,
  canManage,
  actionPending,
  actionError,
  onAcknowledgeBoxGrowth,
  onExpectBoxGrowthRates,
  onDismissConnectorEpisode,
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
          {check.actions !== undefined && canManage ? (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-2">
                {check.actions.includes("acknowledge-box-growth") ? (
                  <Button
                    intent="secondary"
                    size="sm"
                    loading={actionPending?.kind === "acknowledge"}
                    disabled={actionPending !== null}
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
                    loading={actionPending?.kind === "expect-rates"}
                    disabled={actionPending !== null}
                    loadingLabel="Saving expectation…"
                    onClick={onExpectBoxGrowthRates}
                  >
                    Expect these rates
                  </Button>
                ) : null}
                {check.actions.includes("dismiss-connector-episode") ? (
                  <Button
                    intent="secondary"
                    size="sm"
                    loading={actionPending?.kind === "dismiss" && actionPending.check === check.name}
                    disabled={actionPending !== null}
                    loadingLabel="Dismissing…"
                    onClick={() => onDismissConnectorEpisode(check.name)}
                  >
                    This is expected
                  </Button>
                ) : null}
              </div>
              {check.actions.includes("expect-box-growth-rates") ? (
                <div className="text-xs text-warning-dark">
                  Acknowledge makes this measurement the new baseline but keeps rate limits. Expecting these rates gives the displayed rates 50% headroom.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
      {actionError !== null ? (
        <div role="alert" className="text-xs text-danger-dark">
          Could not save that decision: {actionError}
        </div>
      ) : null}
    </section>
  );
}
