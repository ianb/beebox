/**
 * One row of `runHealthChecks` (`webapp/trpc/routers/health/router.ts`).
 * Lives here, not in the router, so a plugin's `healthChecks` hook
 * (`cards/plugin-definition.ts`) can type its result without importing
 * the webapp.
 */
export interface HealthCheck {
  name: string;
  ok: boolean;
  message: string;
  severity: "error" | "warning";
  actions?: Array<"acknowledge-box-growth" | "expect-box-growth-rates" | "dismiss-connector-episode">;
}
