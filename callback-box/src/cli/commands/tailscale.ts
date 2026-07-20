/**
 * `cb tailscale` — the Tailscale expose-and-protect command family (Track B of
 * `docs/plans/tailscale-expose-and-protect.md`). Chunk 1 ships one subcommand,
 * `status`, which inspects real state and prints the single next concrete step.
 * `setup` (the guided serve-config loop) is chunk 2.
 *
 * This file is presentation only: it wires the real deps, runs the state
 * machine in `src/services/tailscale-status.ts`, formats the report, and maps
 * the terminal state to the process exit code (like `health.ts` over
 * `health-box.ts`). All logic and the injectable seam live in the service
 * modules.
 */

import { Command } from "commander";

import { errorMessage } from "../../lib/error-guards.js";
import { assertNever } from "../../lib/invariant.js";
import { createRealTailscaleDeps } from "../../services/tailscale.js";
import {
  reportToJson,
  runTailscaleStatus,
  type TailscaleReport,
} from "../../services/tailscale-status.js";

/** A per-state one-line description of the observed condition. */
function summaryLine(report: TailscaleReport): string {
  switch (report.state) {
    case "ambiguous-target":
      return report.detail;
    case "binary-absent":
      return "the `tailscale` CLI is not on PATH";
    case "unrecognized-status-output":
      return `unrecognized \`tailscale status --json\` output: ${report.detail}`;
    case "unknown-backend-state":
      return `BackendState '${report.backendState}' is not one of the known ipn.State values`;
    case "needs-login":
      return `BackendState ${report.backendState}: Tailscale is not logged in`;
    case "needs-machine-auth":
      return "BackendState NeedsMachineAuth: awaiting admin approval for this machine";
    case "stopped":
      return "BackendState Stopped: Tailscale is installed but not running";
    case "starting":
      return "BackendState Starting: Tailscale is coming up";
    case "in-use-other-user":
      return "BackendState InUseOtherUser: tailscaled is owned by another OS user";
    case "https-disabled":
      return `Running as ${report.dnsName}, but tailnet HTTPS certificates are disabled (CertDomains empty)`;
    case "unrecognized-serve-output":
      return `unrecognized \`tailscale serve status --json\` output: ${report.detail}`;
    case "funnel-enabled":
      return `Funnel is ENABLED for ${report.hostPort} — the target is publicly exposed`;
    case "serve-unconfigured":
      return `Running as ${report.dnsName}; serve is not fronting loopback:${report.target.port}`;
    case "serve-drift":
      return `serve at ${report.dnsName}:443 points at ${report.pointsAt}, not loopback:${report.target.port}`;
    case "probe-failed":
      return `serve is configured but ${report.url}auth/me did not respond`;
    case "ready":
      return `serve is fronting the target; ${report.url}auth/me responded (${report.status ?? "no status"})`;
    default:
      return assertNever(report);
  }
}

/** One glyph line, the observed condition, the next step, and the doc link. */
export function formatReportHuman(report: TailscaleReport): string {
  const glyph = report.ok ? "✓" : "✗";
  const lines = [`${glyph} tailscale: ${report.state}`, `  ${summaryLine(report)}`, `  next: ${report.nextStep}`];
  if (report.docLink !== null) lines.push(`  docs: ${report.docLink}`);
  return lines.join("\n");
}

const statusCommand = new Command("status")
  .description("Inspect Tailscale state for a loopback target and print the single next step to expose it")
  .option("--target <port>", "The loopback port of the auth-gated cb serve/hub to expose (e.g. 3210)")
  .option("--json", "Machine-readable output")
  .action(async (options: { target?: string; json?: boolean }) => {
    try {
      const report = await runTailscaleStatus(createRealTailscaleDeps(), { target: options.target });
      if (options.json) {
        console.log(JSON.stringify(reportToJson(report), null, 2));
      } else {
        console.log(formatReportHuman(report));
      }
      if (!report.ok) process.exitCode = 1;
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exitCode = 1;
    }
  });

export const tailscaleCommand = new Command("tailscale")
  .description("Expose a loopback cb server over Tailscale, off the public internet (status; setup is chunk 2)")
  .addCommand(statusCommand);
