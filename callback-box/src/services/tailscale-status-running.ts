/**
 * The `Running`-backend branch of `cb tailscale status`: HTTPS cert → serve
 * config readback → the no-Funnel invariant → serve-target match → a live probe
 * of the served endpoint classified with the same strictness setup uses. Split
 * out of `tailscale-status.ts` for the file-size budget; imports the shared
 * report vocabulary from `tailscale-report.ts` (no value cycle).
 */

import {
  hasFunnelForTarget,
  loopbackProxyPort,
  normalizeDnsName,
  parseServeConfig,
  type TailscaleDeps,
  type TailscaleStatusJson,
  type TailscaleTarget,
} from "./tailscale.js";
import { binaryAbsent, cliError, DOC, type TailscaleReport } from "./tailscale-report.js";
import { classifyAuthPosture, looksLikeGuardedRouter } from "./tailscale-target.js";
import { assertNever } from "../lib/invariant.js";

/** The Running-backend branch: HTTPS cert → serve config → probe. */
export async function runningStatus(
  deps: TailscaleDeps,
  { status, target }: { status: TailscaleStatusJson; target: TailscaleTarget },
): Promise<TailscaleReport> {
  // `Self`/`Self.DNSName` are always-emitted status members; a Running node with
  // a null Self or empty DNSName is genuinely broken output — treat as drift and
  // NEVER build a `:443` URL from an empty host.
  const rawDnsName = status.Self?.DNSName ?? "";
  if (rawDnsName.trim() === "") {
    return {
      state: "unrecognized-status-output",
      ok: false,
      detail: "BackendState is Running but Self.DNSName is empty — cannot resolve the tailnet hostname.",
      nextStep: "`tailscale status --json` reported Running without a Self.DNSName — check your Tailscale version/state.",
      docLink: null,
    };
  }
  const dnsName = normalizeDnsName(rawDnsName);

  // State 4: Running but tailnet HTTPS certs are off (CertDomains empty/null).
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
  if (serveRun.code !== 0) {
    return cliError("tailscale serve status --json", { code: serveRun.code, stderr: serveRun.stderr });
  }
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
  // invariant — checked at the top level AND in every foreground config (the
  // shape `tailscale funnel` without `--bg` writes), never assumed absent.
  if (hasFunnelForTarget(serve, hostPort)) {
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

  // State 6: serve is correct — probe the LIVE served endpoint. First check the
  // guarded-dev-router path (anonymous `/__router/status` must be 401 + the
  // self-identifying header); a guarded router is a healthy `ready`. A normal cb
  // serve/hub answers `/__router/status` with a non-guarded response and falls
  // through to the `/auth/me` posture read below. Serve is live here, so an
  // open/unrecognized posture is a serious failing state — never a healthy "ready".
  const url = `https://${dnsName}/`;
  const routerProbe = await deps.probe(`https://${dnsName}/__router/status`);
  if (looksLikeGuardedRouter(routerProbe)) {
    return {
      state: "ready",
      ok: true,
      url,
      status: routerProbe.status,
      guarded: true,
      nextStep: `The guarded dev router is reachable at ${url} and denies anonymous \`/__router/status\` (401) over Serve (proves the local serve path only; live acceptance comes from a second device on the tailnet).`,
      docLink: null,
    };
  }

  const probe = await deps.probe(`https://${dnsName}/auth/me`);
  const posture = classifyAuthPosture(probe);
  switch (posture) {
    case "enforced":
      return {
        state: "ready",
        ok: true,
        url,
        status: probe.status,
        guarded: false,
        nextStep: `Reachable at ${url} (proves the local serve path only; live acceptance comes from a second device on the tailnet).`,
        docLink: null,
      };
    case "unreachable":
      return {
        state: "probe-failed",
        ok: false,
        url,
        status: probe.status,
        nextStep: `Serve is configured for ${hostPort} but ${url}auth/me did not respond — check that the box server on loopback:${target.port} is running.`,
        docLink: null,
      };
    case "open":
      // Defensive against an older/foreign server: current `cb serve`/`cb hub`
      // can no longer run unauthenticated (the open-mode opt-out was removed),
      // but a legacy or third-party server on this port might still report it.
      return {
        state: "exposed-unauthenticated",
        ok: false,
        url,
        nextStep:
          `${url} is served to the tailnet but reports open (UNAUTHENTICATED) mode — Serve is live in front of an ` +
          "unprotected box. Run `cb tailscale stop`, or give the box real authentication, immediately.",
        docLink: null,
      };
    case "ambiguous":
      return {
        state: "posture-ambiguous",
        ok: false,
        url,
        detail: `${url}auth/me did not report a recognizable callback-box auth posture (status ${probe.status ?? "none"}).`,
        nextStep:
          `${url}auth/me responded but not with a callback-box auth shape — refusing to call this ready. ` +
          "Confirm the loopback target is the auth-gated cb server.",
        docLink: null,
      };
    default:
      return assertNever(posture);
  }
}
