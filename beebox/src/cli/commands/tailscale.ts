/**
 * `bbx tailscale` — the Tailscale expose-and-protect command family (Track B of
 * `docs/implemented-plans/tailscale-expose-and-protect.md`). Chunk 1 ships one subcommand,
 * `status`, which inspects real state and prints the single next concrete step.
 * `setup` (the guided serve-config loop) is chunk 2.
 *
 * This file is presentation only: it wires the real deps, runs the state
 * machine in `src/services/tailscale-status.ts`, formats the report, and maps
 * the terminal state to the process exit code (like `health.ts` over
 * `health-box.ts`). All logic and the injectable seam live in the service
 * modules.
 */

import * as readline from "node:readline";

import { Command } from "commander";

import { errorMessage } from "../../lib/error-guards.js";
import { assertNever } from "../../lib/invariant.js";
import { createRealTailscaleDeps, type TailscaleTarget } from "../../services/tailscale.js";
import { defaultHubConfigPath, resolveTargetOrDiscover } from "../../services/tailscale-discovery.js";
import {
  runTailscaleSetup,
  runTailscaleStop,
  type SetupIo,
} from "../../services/tailscale-setup.js";
import { reportToJson, runTailscaleStatus } from "../../services/tailscale-status.js";
import { ambiguousTarget, type TailscaleReport } from "../../services/tailscale-report.js";

/** The `--target` help shared by all three subcommands: optional, auto-detected
 *  from the hub config when omitted. */
const TARGET_OPTION_DESC =
  "The loopback port of the bbx serve/hub to expose. Optional — omit to auto-detect from the hub config (~/.config/beebox/hub.json).";

/** Resolve `--target`/auto-discovery at the command boundary. Prints the
 *  discovery announcement (and, on refusal, returns null so the caller reports
 *  it in its own idiom). The one place the hub-config read happens. */
async function resolveTargetForCommand(
  target: string | undefined,
): Promise<{ ok: true; target: TailscaleTarget } | { ok: false; message: string }> {
  return resolveTargetOrDiscover({
    target,
    hubConfigPath: defaultHubConfigPath(),
    log: (line) => console.log(line),
  });
}

/** A per-state one-line description of the observed condition. */
function summaryLine(report: TailscaleReport): string {
  switch (report.state) {
    case "ambiguous-target":
      return report.detail;
    case "binary-absent":
      return "the `tailscale` CLI is not on PATH";
    case "cli-error":
      return `\`${report.command}\` exited ${report.code ?? "null"}: ${report.detail}`;
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
    case "exposed-unauthenticated":
      return `serve is LIVE at ${report.url} but the box reports open (UNAUTHENTICATED) mode`;
    case "posture-ambiguous":
      return report.detail;
    case "ready":
      return report.guarded
        ? `serve is fronting the guarded dev router; anonymous ${report.url}__router/status was denied (${report.status ?? "no status"})`
        : `serve is fronting the target; ${report.url}auth/me responded (${report.status ?? "no status"})`;
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
  .option("--target <port>", TARGET_OPTION_DESC)
  .option("--json", "Machine-readable output")
  .action(async (options: { target?: string; json?: boolean }) => {
    try {
      const resolved = await resolveTargetForCommand(options.target);
      // A no-target/no-hub refusal still reports through the normal report +
      // exit-code channel (as `ambiguous-target`) so `--json` stays consistent.
      const report = resolved.ok
        ? await runTailscaleStatus(createRealTailscaleDeps(), { target: resolved.target })
        : ambiguousTarget(resolved.message);
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

/** Real operator I/O for the guided setup loop: log to stdout, and (in a TTY)
 *  block on a single line of stdin between human steps. `--no-wait` forces
 *  `interactive: false` so a non-interactive caller never hangs on the prompt. */
function createRealSetupIo(wait: boolean): SetupIo {
  return {
    interactive: wait && process.stdin.isTTY === true,
    log: (line) => console.log(line),
    waitForContinue: () =>
      new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question("", () => {
          rl.close();
          resolve();
        });
      }),
  };
}

const setupCommand = new Command("setup")
  .description("Guided loop: configure `tailscale serve` to front an auth-gated loopback bbx server, off the public internet")
  .option("--target <port>", TARGET_OPTION_DESC)
  .option("--no-wait", "Non-interactive: print the next human step and exit nonzero instead of waiting")
  .action(async (options: { target?: string; wait?: boolean }) => {
    try {
      const resolved = await resolveTargetForCommand(options.target);
      if (!resolved.ok) {
        console.log(`✗ ${resolved.message}`);
        process.exitCode = 1;
        return;
      }
      const io = createRealSetupIo(options.wait ?? true);
      const result = await runTailscaleSetup(createRealTailscaleDeps(), { target: resolved.target, io });
      console.log(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exitCode = 1;
    }
  });

const stopCommand = new Command("stop")
  .description("Remove this target's `tailscale serve` mapping and clear its exposure intent (preserves unrelated mappings)")
  .option("--target <port>", TARGET_OPTION_DESC)
  .action(async (options: { target?: string }) => {
    try {
      const resolved = await resolveTargetForCommand(options.target);
      if (!resolved.ok) {
        console.log(`✗ ${resolved.message}`);
        process.exitCode = 1;
        return;
      }
      const result = await runTailscaleStop(createRealTailscaleDeps(), { target: resolved.target });
      console.log(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exitCode = 1;
    }
  });

export const tailscaleCommand = new Command("tailscale")
  .description("Expose a loopback bbx server over Tailscale, off the public internet (status, setup, stop)")
  .addCommand(statusCommand)
  .addCommand(setupCommand)
  .addCommand(stopCommand);
