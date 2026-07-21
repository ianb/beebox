/**
 * The `cb tailscale status` state machine (Track B chunk 1 of
 * `docs/implemented-plans/tailscale-expose-and-protect.md`).
 *
 * Read-only and exhaustive over the plan's states 1-6, plus fail-closed
 * branches for schema drift, an unknown BackendState, a nonzero CLI exit, and a
 * Funnel allowance on the target. Every state emits a concrete next step and,
 * where a human action is needed, links Tailscale's own docs (never transcribes
 * their UI). The boundary parsing and injected deps live in `tailscale.ts`; the
 * report vocabulary in `tailscale-report.ts`; the Running branch in
 * `tailscale-status-running.ts`.
 */

import { assertNever } from "../lib/invariant.js";
import {
  parseStatusJson,
  resolveTarget,
  toBackendState,
  type TailscaleDeps,
} from "./tailscale.js";
import { binaryAbsent, cliError, DOC, type TailscaleReport } from "./tailscale-report.js";
import { runningStatus } from "./tailscale-status-running.js";

/**
 * Run the read-only `cb tailscale status` state machine against injected deps.
 * Returns exactly one {@link TailscaleReport}; the caller formats it and maps
 * `ok` to the process exit code.
 */
export async function runTailscaleStatus(
  deps: TailscaleDeps,
  { target }: { target: string | undefined },
): Promise<TailscaleReport> {
  const resolved = resolveTarget(target);
  if (!resolved.ok) {
    return {
      state: "ambiguous-target",
      ok: false,
      detail: resolved.message,
      nextStep: "Re-run with `cb tailscale status --target <port>`.",
      docLink: null,
    };
  }

  // State 1: binary absent.
  const statusRun = await deps.run("tailscale", ["status", "--json"]);
  if (!statusRun.spawned) return binaryAbsent();
  // A nonzero exit is a DISTINCT cli-error — never parsed as state (a failed
  // daemon/permission call must not become "unconfigured" and trigger a write).
  if (statusRun.code !== 0) {
    return cliError("tailscale status --json", { code: statusRun.code, stderr: statusRun.stderr });
  }

  // Parse at the boundary — a parse failure is its own state (schema drift),
  // never a silent undefined.
  const parsedStatus = parseStatusJson(statusRun.stdout);
  if (!parsedStatus.ok) {
    return {
      state: "unrecognized-status-output",
      ok: false,
      detail: parsedStatus.message,
      nextStep: "`tailscale status --json` did not match the expected shape — check your Tailscale version.",
      docLink: null,
    };
  }

  const status = parsedStatus.value;
  const backend = toBackendState(status.BackendState);
  if (backend === null) {
    // Fail-closed unknown branch (the anti-#50630 guard): a future ipn.State is
    // treated as not-ready, never permissively.
    return {
      state: "unknown-backend-state",
      ok: false,
      backendState: status.BackendState,
      nextStep: `Unrecognized BackendState '${status.BackendState}' — refusing to assume a working state. Check your Tailscale version.`,
      docLink: null,
    };
  }

  // States 2-3: not-yet-running backend states, each its own branch.
  switch (backend) {
    case "NoState":
    case "NeedsLogin":
      return {
        state: "needs-login",
        ok: false,
        backendState: backend,
        nextStep:
          "Interactive: run `tailscale up`. Headless: run `tailscale up --auth-key=<key>` with a single-use key from the admin console.",
        docLink: DOC.authKeys,
      };
    case "NeedsMachineAuth":
      return {
        state: "needs-machine-auth",
        ok: false,
        nextStep: "This machine is waiting for admin approval — approve it in the Tailscale admin console.",
        docLink: DOC.up,
      };
    case "Stopped":
      return {
        state: "stopped",
        ok: false,
        nextStep: "Tailscale is installed but stopped — run `tailscale up` to bring it up.",
        docLink: DOC.up,
      };
    case "Starting":
      return {
        state: "starting",
        ok: false,
        nextStep: "Tailscale is still starting — wait a moment and re-run `cb tailscale status`.",
        docLink: null,
      };
    case "InUseOtherUser":
      return {
        state: "in-use-other-user",
        ok: false,
        nextStep:
          "The tailscaled daemon is owned by another OS user — switch to that user, or run `tailscale up` as the intended user to take it over.",
        docLink: DOC.up,
      };
    case "Running":
      return runningStatus(deps, { status, target: resolved.target });
    default:
      return assertNever(backend);
  }
}

/** Machine-readable `--json` shape — the report as-is, structured for agents. */
export function reportToJson(report: TailscaleReport): TailscaleReport {
  return report;
}
