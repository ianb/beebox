/**
 * The `cb tailscale status` state machine (Track B chunk 1 of
 * `docs/plans/tailscale-expose-and-protect.md`).
 *
 * Read-only and exhaustive over the plan's states 1-6, plus fail-closed
 * branches for schema drift, an unknown BackendState, and a Funnel allowance on
 * the target. Every state emits a concrete next step and, where a human action
 * is needed, links Tailscale's own docs (never transcribes their UI). The
 * boundary parsing and injected deps live in `tailscale.ts`.
 */

import { assertNever } from "../lib/invariant.js";
import {
  loopbackProxyPort,
  normalizeDnsName,
  parseServeConfig,
  parseStatusJson,
  resolveTarget,
  toBackendState,
  type BackendState,
  type TailscaleDeps,
  type TailscaleStatusJson,
  type TailscaleTarget,
} from "./tailscale.js";

// Doc links kept in one place so a moved Tailscale doc is a one-line fix.
// Uses tailscale.com/kb/<id>/ permalinks — the numeric kb IDs survive
// Tailscale's doc reorganizations, where the prettier /docs/... paths are
// redirect-dependent (the vendor-link-rot lesson from the Cloudflare
// dashboard incident; all verified live 2026-07-20).
const DOC = {
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
  | (ReportBase & { state: "ready"; url: string; status: number | null });

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

function binaryAbsent(): TailscaleReport {
  return {
    state: "binary-absent",
    ok: false,
    nextStep: "Install Tailscale for this platform, then run `tailscale up`.",
    docLink: DOC.install,
  };
}

/** The Running-backend branch: HTTPS cert → serve config → probe. */
async function runningStatus(
  deps: TailscaleDeps,
  { status, target }: { status: TailscaleStatusJson; target: TailscaleTarget },
): Promise<TailscaleReport> {
  const dnsName = normalizeDnsName(status.Self?.DNSName ?? "");

  // State 4: Running but tailnet HTTPS certs are off (CertDomains empty).
  if ((status.CertDomains ?? []).length === 0) {
    return {
      state: "https-disabled",
      ok: false,
      dnsName,
      nextStep: `Enable HTTPS certificates for your tailnet in the admin console (${DOC.adminDns}), then re-run.`,
      docLink: DOC.https,
    };
  }

  // Read the serve config back from Tailscale — never inferred from what setup
  // last wrote (OpenClaw #57241's bug class).
  const serveRun = await deps.run("tailscale", ["serve", "status", "--json"]);
  if (!serveRun.spawned) return binaryAbsent();
  const parsedServe = parseServeConfig(serveRun.stdout);
  if (!parsedServe.ok) {
    return {
      state: "unrecognized-serve-output",
      ok: false,
      detail: parsedServe.message,
      nextStep: "`tailscale serve status --json` did not match the expected shape — check your Tailscale version.",
      docLink: null,
    };
  }
  const serve = parsedServe.value;
  const hostPort = `${dnsName}:443`;

  // State 5a: a Funnel allowance on the target hostname-port is a FAILING
  // invariant — "nothing publicly exposed" is checked, not assumed.
  if (serve.AllowFunnel?.[hostPort] === true) {
    return {
      state: "funnel-enabled",
      ok: false,
      hostPort,
      nextStep: `Funnel is enabled for ${hostPort} — this target is PUBLIC. Disable it with \`tailscale funnel --https=443 off\`.`,
      docLink: DOC.funnel,
    };
  }

  // State 5b/5c: serve unconfigured or pointing at the wrong target.
  const handlers = serve.Web?.[hostPort]?.Handlers ?? {};
  const proxied = Object.values(handlers)
    .map((h) => h.Proxy)
    .filter((p): p is string => p !== undefined);
  if (proxied.length === 0) {
    return {
      state: "serve-unconfigured",
      ok: false,
      dnsName,
      target,
      nextStep: `Serve is not fronting ${hostPort} yet — run \`cb tailscale setup --target ${target.port}\` to configure it.`,
      docLink: DOC.serve,
    };
  }
  if (!proxied.some((proxy) => loopbackProxyPort(proxy) === target.port)) {
    return {
      state: "serve-drift",
      ok: false,
      dnsName,
      target,
      pointsAt: proxied.join(", "),
      nextStep: `Serve at ${hostPort} points at ${proxied.join(", ")}, not loopback:${target.port} — re-run \`cb tailscale setup --target ${target.port}\`.`,
      docLink: DOC.serve,
    };
  }

  // State 6: serve is correct — probe a semantic endpoint (not `/`, which can
  // 200 as a login SPA) on the https URL and report the working URL.
  const url = `https://${dnsName}/`;
  const probe = await deps.probe(`https://${dnsName}/auth/me`);
  if (!probe.reachable) {
    return {
      state: "probe-failed",
      ok: false,
      url,
      status: probe.status,
      nextStep: `Serve is configured for ${hostPort} but ${url}auth/me did not respond — check that the box server on loopback:${target.port} is running.`,
      docLink: null,
    };
  }
  return {
    state: "ready",
    ok: true,
    url,
    status: probe.status,
    nextStep: `Reachable at ${url} (proves the local serve path only; live acceptance comes from a second device on the tailnet).`,
    docLink: null,
  };
}

/** Machine-readable `--json` shape — the report as-is, structured for agents. */
export function reportToJson(report: TailscaleReport): TailscaleReport {
  return report;
}
