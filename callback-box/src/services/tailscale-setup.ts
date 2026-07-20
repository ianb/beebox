/**
 * `cb tailscale setup` (the guided serve-config loop) and `cb tailscale stop`
 * (Track B chunk 2 of `docs/plans/tailscale-expose-and-protect.md`).
 *
 * `setup` runs the chunk-1 status state machine (`tailscale-status.ts`) as a
 * loop: in the human-action states (1–4) it prints the ONE next step and either
 * waits-and-rechecks (a TTY prompt) or, with `--no-wait`, exits with the
 * instruction and a nonzero code; in the serve states (5) it probes the running
 * target's AUTH POSTURE over loopback and REFUSES to configure an open server
 * (the OpenClaw-#50630 analog), then writes a persistent, path-scoped `tailscale
 * serve` mapping — preserving every unrelated mapping — re-verifies, and only
 * then records exposure intent (`tailscale-exposure.ts`). `stop` removes only
 * this target's mapping, clears the intent entry, and re-verifies.
 *
 * All subprocess + probe access goes through the injected {@link TailscaleDeps},
 * and all operator I/O through the injected {@link SetupIo}, so the whole flow
 * is testable with no tailnet and no TTY.
 */

import { isRecord } from "../lib/is-record.js";
import { clearExposure, loadExposureFile, recordExposure } from "./tailscale-exposure.js";
import {
  normalizeDnsName,
  parseServeConfig,
  parseStatusJson,
  resolveTarget,
  type ProbeResult,
  type ServeConfigJson,
  type TailscaleDeps,
} from "./tailscale.js";
import { runTailscaleStatus } from "./tailscale-status.js";

/** Injected operator I/O so the guided loop is testable without a real TTY. */
export interface SetupIo {
  /** Whether we can prompt-and-wait (a real TTY); `--no-wait` forces this false. */
  interactive: boolean;
  log(line: string): void;
  /** Resolve once the operator signals the human step is done (Enter). */
  waitForContinue(): Promise<void>;
}

/** The terminal outcome of `setup`/`stop`: `ok` maps to a zero exit code. */
export interface TailscaleActionResult {
  ok: boolean;
  message: string;
}

/** The running target's effective auth posture, from a loopback `/auth/me` probe. */
export type AuthPosture = "enforced" | "open" | "unreachable" | "ambiguous";

/**
 * Classify a loopback `/auth/me` probe. `{ open: true }` ⇒ the box is
 * unauthenticated (`open`) and must NOT be exposed; a `401` or an
 * authenticated-user body ⇒ auth is `enforced`; no response ⇒ `unreachable`;
 * anything else (503, unparseable, unexpected 200) ⇒ `ambiguous`. Every
 * non-`enforced` outcome is a refusal — fail closed, no override flag.
 */
export function classifyAuthPosture(probe: ProbeResult): AuthPosture {
  if (!probe.reachable) return "unreachable";
  if (probe.status === 401) return "enforced";
  if (probe.status === 200) {
    const body = probe.body;
    if (body === undefined || body === null) return "ambiguous";
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (_e) {
      return "ambiguous";
    }
    if (isRecord(parsed)) {
      if (parsed["open"] === true) return "open";
      if (typeof parsed["email"] === "string" && parsed["email"].length > 0) return "enforced";
    }
    return "ambiguous";
  }
  return "ambiguous";
}

function postureRefusal(posture: Exclude<AuthPosture, "enforced">, port: number): string {
  const probed = `http://127.0.0.1:${port}/auth/me`;
  switch (posture) {
    case "open":
      return (
        `REFUSING to expose loopback:${port} — it reports open (UNAUTHENTICATED) mode at ${probed}. ` +
        "Fronting it with Tailscale Serve would hand the whole tailnet an unauthenticated box. " +
        "Unset CB_ALLOW_UNAUTHENTICATED and give the server real auth first."
      );
    case "unreachable":
      return (
        `REFUSING to expose loopback:${port} — nothing answered at ${probed}. ` +
        "Start the auth-gated cb serve/hub on that port first, then re-run `cb tailscale setup`."
      );
    case "ambiguous":
      return (
        `REFUSING to expose loopback:${port} — ${probed} did not report a recognizable auth posture ` +
        "(neither a 401 nor an authenticated user nor open mode). Refusing to assume it is protected."
      );
    default:
      return posture;
  }
}

/** Configure a persistent, path-scoped serve mapping for the loopback target.
 *  `--bg` makes it survive the command (a plain `tailscale serve` is foreground
 *  and dies with the shell); a path-scoped write leaves unrelated mappings
 *  untouched. */
async function configureServe(deps: TailscaleDeps, port: number): Promise<TailscaleActionResult> {
  const run = await deps.run("tailscale", [
    "serve",
    "--bg",
    "--https=443",
    "--set-path=/",
    `http://127.0.0.1:${port}`,
  ]);
  if (!run.spawned) return { ok: false, message: "the `tailscale` CLI is not on PATH." };
  if (run.code !== 0) {
    return { ok: false, message: `\`tailscale serve\` failed (exit ${run.code ?? "null"}): ${run.stderr.trim()}` };
  }
  return { ok: true, message: "configured" };
}

async function probePosture(deps: TailscaleDeps, port: number): Promise<AuthPosture> {
  return classifyAuthPosture(await deps.probe(`http://127.0.0.1:${port}/auth/me`));
}

/** Guard the two probe-then-record paths: refuse unless auth is enforced. */
async function ensureEnforced(deps: TailscaleDeps, port: number): Promise<TailscaleActionResult | null> {
  const posture = await probePosture(deps, port);
  if (posture !== "enforced") return { ok: false, message: postureRefusal(posture, port) };
  return null;
}

const MAX_SETUP_STEPS = 12;

/**
 * Run the guided setup loop. Returns once it reaches a terminal outcome (the
 * working URL, or a refusal/error), or after a non-interactive human step, or
 * once the step budget is exhausted.
 */
export async function runTailscaleSetup(
  deps: TailscaleDeps,
  { target, io }: { target: string | undefined; io: SetupIo },
): Promise<TailscaleActionResult> {
  const resolved = resolveTarget(target);
  if (!resolved.ok) return { ok: false, message: resolved.message };
  const port = resolved.target.port;

  let configuredThisRun = false;
  for (let step = 0; step < MAX_SETUP_STEPS; step++) {
    const report = await runTailscaleStatus(deps, { target: String(port) });
    switch (report.state) {
      // States 1–4 and a downed box: one human action, then wait-and-recheck.
      case "binary-absent":
      case "needs-login":
      case "needs-machine-auth":
      case "stopped":
      case "starting":
      case "in-use-other-user":
      case "https-disabled":
      case "probe-failed": {
        io.log(`Next: ${report.nextStep}`);
        if (report.docLink !== null) io.log(`Docs: ${report.docLink}`);
        if (!io.interactive) {
          return { ok: false, message: "Not done yet — do the step above, then re-run `cb tailscale setup`." };
        }
        io.log("Waiting… press Enter once that step is done.");
        await io.waitForContinue();
        continue;
      }

      // State 5: serve unconfigured / pointing elsewhere — the automatable step.
      case "serve-unconfigured":
      case "serve-drift": {
        if (configuredThisRun) {
          return {
            ok: false,
            message:
              `Configured serve for loopback:${port} but \`tailscale serve status\` still does not reflect it — ` +
              "the write did not take. Check `tailscale serve status --json` manually.",
          };
        }
        const refusal = await ensureEnforced(deps, port);
        if (refusal) return refusal;
        const configured = await configureServe(deps, port);
        if (!configured.ok) return configured;
        configuredThisRun = true;
        continue;
      }

      // Terminal success: serve already fronts the target and it responded.
      case "ready": {
        const refusal = await ensureEnforced(deps, port);
        if (refusal) return refusal;
        const dnsName = new URL(report.url).hostname;
        recordExposure({ port, dnsName });
        return { ok: true, message: `Exposed at ${report.url} (loopback:${port}). Serve config + exposure intent recorded.` };
      }

      // Funnel on the target is PUBLIC exposure — never enabled by us; refuse.
      case "funnel-enabled":
        return { ok: false, message: report.nextStep };

      // Unrecoverable states — can't guide past these.
      case "ambiguous-target":
      case "unrecognized-status-output":
      case "unknown-backend-state":
      case "unrecognized-serve-output":
        return { ok: false, message: report.nextStep };
    }
  }
  return {
    ok: false,
    message: `Gave up after ${MAX_SETUP_STEPS} checks without reaching a working state. Run \`cb tailscale status --target ${port}\`.`,
  };
}

/** Does the serve config front `hostPort` at loopback:`port` on any path? */
function serveFrontsPort(serve: ServeConfigJson, { hostPort, port }: { hostPort: string; port: number }): boolean {
  const handlers = serve.Web?.[hostPort]?.Handlers ?? {};
  return Object.values(handlers).some((h) => h.Proxy?.includes(`:${port}`) === true);
}

/**
 * Remove only this target's serve mapping and clear its exposure intent. A
 * clean no-op (exit 0) when nothing is configured for the port. Unrelated serve
 * mappings are preserved — the removal is path-scoped, never a `serve reset`.
 */
export async function runTailscaleStop(
  deps: TailscaleDeps,
  { target }: { target: string | undefined },
): Promise<TailscaleActionResult> {
  const resolved = resolveTarget(target);
  if (!resolved.ok) return { ok: false, message: resolved.message };
  const port = resolved.target.port;
  const hadIntent = loadExposureFile().targets.some((t) => t.port === port);

  const statusRun = await deps.run("tailscale", ["status", "--json"]);
  if (!statusRun.spawned) {
    if (hadIntent) {
      clearExposure(port);
      return {
        ok: true,
        message: `\`tailscale\` CLI not found — cleared the local exposure intent for loopback:${port}, but could not update serve config.`,
      };
    }
    return { ok: true, message: `\`tailscale\` CLI not found and nothing recorded for loopback:${port} — nothing to do.` };
  }
  const parsedStatus = parseStatusJson(statusRun.stdout);
  if (!parsedStatus.ok) return { ok: false, message: `\`tailscale status --json\` was unreadable: ${parsedStatus.message}` };
  const dnsName = normalizeDnsName(parsedStatus.value.Self?.DNSName ?? "");
  const hostPort = `${dnsName}:443`;

  const serveRun = await deps.run("tailscale", ["serve", "status", "--json"]);
  if (!serveRun.spawned) return { ok: false, message: "the `tailscale` CLI is not on PATH." };
  const parsedServe = parseServeConfig(serveRun.stdout);
  if (!parsedServe.ok) return { ok: false, message: `\`tailscale serve status --json\` was unreadable: ${parsedServe.message}` };

  const mappingPresent = serveFrontsPort(parsedServe.value, { hostPort, port });
  if (!mappingPresent && !hadIntent) {
    return { ok: true, message: `Nothing configured for loopback:${port} — nothing to stop.` };
  }

  if (mappingPresent) {
    const off = await deps.run("tailscale", ["serve", "--https=443", "--set-path=/", "off"]);
    if (!off.spawned) return { ok: false, message: "the `tailscale` CLI is not on PATH." };
    if (off.code !== 0) {
      return { ok: false, message: `\`tailscale serve … off\` failed (exit ${off.code ?? "null"}): ${off.stderr.trim()}` };
    }
  }
  clearExposure(port);

  // Re-verify: the mapping must be gone (unrelated mappings stay).
  const afterRun = await deps.run("tailscale", ["serve", "status", "--json"]);
  const afterParsed = afterRun.spawned ? parseServeConfig(afterRun.stdout) : null;
  if (afterParsed?.ok === true && serveFrontsPort(afterParsed.value, { hostPort, port })) {
    return {
      ok: false,
      message: `Cleared exposure intent for loopback:${port}, but the serve mapping is still present — remove it manually with \`tailscale serve status\`.`,
    };
  }
  return {
    ok: true,
    message: `Removed the serve mapping for ${hostPort} → loopback:${port} and cleared its exposure intent.`,
  };
}
