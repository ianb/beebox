/**
 * Shared vocabulary for the `bbx tailscale status` state machine: the doc-link
 * table, the {@link TailscaleReport} discriminated union every state produces,
 * and the two constructors used by more than one branch (`binaryAbsent`,
 * `cliError`). Kept in its own module so `tailscale-status.ts` (the entry +
 * backend switch) and `tailscale-status-running.ts` (the Running branch) can
 * both import it without a value-import cycle.
 */

import type { BackendState, TailscaleTarget } from "./tailscale.js";

// Doc links kept in one place so a moved Tailscale doc is a one-line fix.
// Uses tailscale.com/kb/<id>/ permalinks — the numeric kb IDs survive
// Tailscale's doc reorganizations, where the prettier /docs/... paths are
// redirect-dependent (the vendor-link-rot lesson from the Cloudflare
// dashboard incident; all verified live 2026-07-20).
export const DOC = {
  install: "https://tailscale.com/download",
  up: "https://tailscale.com/kb/1080/cli",
  authKeys: "https://tailscale.com/kb/1085/auth-keys",
  https: "https://tailscale.com/kb/1153/enabling-https",
  serve: "https://tailscale.com/kb/1242/tailscale-serve",
  funnel: "https://tailscale.com/kb/1223/funnel",
  adminDns: "https://login.tailscale.com/admin/dns",
} as const;

interface ReportBase {
  /** True only for the terminal success (`ready`); every other state is failing. */
  ok: boolean;
  nextStep: string;
  docLink: string | null;
}

export type TailscaleReport =
  | (ReportBase & { state: "ambiguous-target"; detail: string })
  | (ReportBase & { state: "binary-absent" })
  | (ReportBase & { state: "cli-error"; command: string; code: number | null; detail: string })
  | (ReportBase & { state: "unrecognized-status-output"; detail: string })
  | (ReportBase & { state: "unknown-backend-state"; backendState: string })
  | (ReportBase & { state: "needs-login"; backendState: BackendState })
  | (ReportBase & { state: "needs-machine-auth" })
  | (ReportBase & { state: "stopped" })
  | (ReportBase & { state: "starting" })
  | (ReportBase & { state: "in-use-other-user" })
  | (ReportBase & { state: "https-disabled"; dnsName: string })
  | (ReportBase & { state: "unrecognized-serve-output"; detail: string })
  | (ReportBase & { state: "funnel-enabled"; hostPort: string })
  | (ReportBase & { state: "serve-unconfigured"; dnsName: string; target: TailscaleTarget })
  | (ReportBase & { state: "serve-drift"; dnsName: string; target: TailscaleTarget; pointsAt: string })
  | (ReportBase & { state: "probe-failed"; url: string; status: number | null })
  | (ReportBase & { state: "exposed-unauthenticated"; url: string })
  | (ReportBase & { state: "posture-ambiguous"; url: string; detail: string })
  | (ReportBase & { state: "ready"; url: string; status: number | null; guarded: boolean });

/** No usable target: `--target` was omitted/invalid AND no hub config was found
 *  to auto-detect a port. Built at the command boundary (after discovery) so the
 *  `status` path still reports through the normal {@link TailscaleReport} +
 *  exit-code channel rather than a bespoke error. */
export function ambiguousTarget(detail: string): TailscaleReport {
  return {
    state: "ambiguous-target",
    ok: false,
    detail,
    nextStep: "Re-run with `bbx tailscale status --target <port>`, or configure a hub so the port can be auto-detected.",
    docLink: null,
  };
}

export function binaryAbsent(): TailscaleReport {
  return {
    state: "binary-absent",
    ok: false,
    nextStep: "Install Tailscale for this platform, then run `tailscale up`.",
    docLink: DOC.install,
  };
}

/** A `tailscale` subprocess that spawned but exited nonzero — a distinct state,
 *  never parsed as config (fail closed, F8). */
export function cliError(command: string, { code, stderr }: { code: number | null; stderr: string }): TailscaleReport {
  const detail = stderr.trim() || "(no stderr)";
  return {
    state: "cli-error",
    ok: false,
    command,
    code,
    detail,
    nextStep: `\`${command}\` exited ${code ?? "null"}: ${detail}. Fix the Tailscale daemon/permissions, then re-run.`,
    docLink: null,
  };
}
