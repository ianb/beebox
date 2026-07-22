/**
 * `cb tailscale setup` (the guided serve-config loop) and `cb tailscale stop`
 * (Track B chunk 2 of `docs/implemented-plans/tailscale-expose-and-protect.md`).
 *
 * `setup` runs the status state machine (`tailscale-status.ts`) as a loop: human
 * steps print the ONE next action and wait-and-recheck (or exit nonzero under
 * `--no-wait`); the serve step classifies the loopback target (`tailscale-target.ts`)
 * and REFUSES to expose anything but a proven auth-enforcing cb, records exposure
 * intent BEFORE mutating Serve (over-record is fail-closed), writes a persistent
 * path-scoped mapping (preserving unrelated ones), and re-verifies. `stop`
 * removes only this target's mapping(s) and clears intent ONLY after a readback
 * proves removal.
 *
 * All subprocess + probe access goes through the injected {@link TailscaleDeps},
 * and all operator I/O through the injected {@link SetupIo}, so the whole flow
 * is testable with no tailnet and no TTY.
 */

import { clearExposure, loadExposureFile, recordExposure } from "./tailscale-exposure.js";
import {
  loopbackProxyPort,
  parseServeConfig,
  parseStatusJson,
  type ProbeResult,
  type ServeConfigJson,
  type TailscaleDeps,
  type TailscaleTarget,
} from "./tailscale.js";
import { classifyTargetPosture, describeRefusal, looksLikeGuardedRouter } from "./tailscale-target.js";
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

/** Configure a persistent (`--bg`), path-scoped serve mapping for the loopback
 *  target — a path-scoped write leaves unrelated mappings untouched. */
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

/** The two postures that clear exposure — a normal auth-enforcing cb serve/hub,
 *  or the Track-B-guarded dev router (its gate denies anonymous access). */
type ExposablePosture = "enforced" | "router-guarded";
type ExposableOutcome = { ok: true; posture: ExposablePosture } | { ok: false; message: string };

/** Classify the loopback target into an exposable posture, or a refusal. Fail
 *  closed on everything that is neither an enforced cb nor a guarded router. */
async function classifyExposable(deps: TailscaleDeps, port: number): Promise<ExposableOutcome> {
  const posture = await classifyTargetPosture(deps, port);
  if (posture.kind === "enforced") return { ok: true, posture: "enforced" };
  if (posture.kind === "router-guarded") return { ok: true, posture: "router-guarded" };
  return { ok: false, message: describeRefusal(posture, port) };
}

/** Best-effort removal of the `--https=443 --set-path=/` mapping this run wrote
 *  for the router — used when the over-Serve proof fails. Returns a human note
 *  (whether it came down, or must be removed manually). */
async function tearDownRouterServe(deps: TailscaleDeps): Promise<string> {
  const off = await deps.run("tailscale", ["serve", "--https=443", "--set-path=/", "off"]);
  if (!off.spawned) {
    return "Could NOT tear the serve mapping down (`tailscale` not on PATH) — remove it manually with `tailscale serve status`.";
  }
  if (off.code !== 0) {
    return `Could NOT tear the serve mapping down (\`tailscale serve … off\` exited ${off.code ?? "null"}) — remove it manually with \`tailscale serve status\`.`;
  }
  return "Tore the serve mapping back down (nothing left exposed).";
}

/**
 * The router's anonymous-denial-over-Serve PROOF (Track C): Serve is already
 * fronting the loopback router port, so probe the SERVED
 * `https://<dnsName>/__router/status` with NO credentials and REQUIRE a 401 plus
 * the `x-cb-router-guarded` header. Only that confirmed guarded denial records
 * exposure intent. A 200 (ungated router) or a missing header (the gate is not
 * live end-to-end, or Serve is not isolating) means anonymous access is NOT
 * denied over the real tailnet path — tear the just-written mapping back down and
 * refuse WITHOUT recording. Serve is live here, so refusing-and-tearing-down is
 * the fail-closed direction.
 */
/**
 * Poll the SERVED `/__router/status` to absorb first-serve TLS cert
 * provisioning. The FIRST `tailscale serve --https=443` on a tailnet triggers
 * Let's Encrypt cert issuance (a few seconds), during which the HTTPS handshake
 * fails and the probe comes back `!reachable`. Retry ONLY that case: a
 * REACHABLE probe (guarded 401 OR an ungated 200) is a definitive answer — an
 * ungated router will never become guarded, so we must not spin on it. Budget:
 * 6 attempts over ≤13s (delays 2s,2s,3s,3s,3s), then return the last probe.
 */
async function pollServedRouter(deps: TailscaleDeps, statusUrl: string): Promise<ProbeResult> {
  const retryDelaysMs = [2000, 2000, 3000, 3000, 3000];
  let probe = await deps.probe(statusUrl);
  for (const delayMs of retryDelaysMs) {
    if (probe.reachable) break;
    await deps.sleep(delayMs);
    probe = await deps.probe(statusUrl);
  }
  return probe;
}

async function settleRouterExposure(
  deps: TailscaleDeps,
  { port, dnsName }: { port: number; dnsName: string },
): Promise<TailscaleActionResult> {
  const url = `https://${dnsName}/`;
  const statusUrl = `${url}__router/status`;
  const probe = await pollServedRouter(deps, statusUrl);
  if (looksLikeGuardedRouter(probe)) {
    await recordExposure({ port, dnsName });
    return {
      ok: true,
      message: `Exposed the guarded dev router at ${url} (loopback:${port}). Anonymous \`/__router/status\` over Serve returned 401 — the auth gate is live end-to-end. Serve config + exposure intent recorded.`,
    };
  }
  const detail = probe.reachable
    ? `the served ${statusUrl} returned ${probe.status ?? "no status"} WITHOUT the guarded-router 401+header`
    : `the served ${statusUrl} never became reachable after retries — Tailscale HTTPS certs may still be provisioning; try again in a minute`;
  await tearDownRouterServe(deps);
  // Fail CLOSED on the teardown itself: Serve is live at this point, so if the
  // proof failed we must PROVE the mapping came back down (readback), not assume
  // it. If it can't be proven gone (teardown errored, or the mapping survives),
  // a live Serve mapping may still front a NOT-proven-guarded router — record the
  // exposure intent so `cb tailscale stop`/`status` can find and remove it, and
  // fail loudly, rather than silently orphaning it.
  const after = await readServeConfig(deps);
  const stillMapped = !after.ok || matchingTargetMappings(after.serve, port).length > 0;
  if (stillMapped) {
    await recordExposure({ port, dnsName });
    return {
      ok: false,
      message:
        `REFUSING to expose loopback:${port} — ${detail}, so anonymous access is NOT proven denied over Serve. ` +
        `The serve mapping could NOT be proven torn down (${after.ok ? "it still fronts the port" : after.reason}) — ` +
        "it may still be LIVE fronting a router whose gate is unproven. Recorded exposure intent so it is tracked; " +
        `remove it NOW with \`cb tailscale stop --target ${port}\` (or \`tailscale serve status\`).`,
    };
  }
  return {
    ok: false,
    message: `REFUSING to expose loopback:${port} — ${detail}, so anonymous access is NOT proven denied end-to-end over Serve. Tore the serve mapping back down (confirmed removed); no exposure recorded.`,
  };
}

const MAX_SETUP_STEPS = 12;

/** Print the one human step and, in a TTY, wait for the operator; returns a
 *  terminal result (non-interactive giving up) or `null` to re-check. */
async function guideHumanStep(
  io: SetupIo,
  { nextStep, docLink }: { nextStep: string; docLink: string | null },
): Promise<TailscaleActionResult | null> {
  io.log(`Next: ${nextStep}`);
  if (docLink !== null) io.log(`Docs: ${docLink}`);
  if (!io.interactive) {
    return { ok: false, message: "Not done yet — do the step above, then re-run `cb tailscale setup`." };
  }
  io.log("Waiting… press Enter once that step is done.");
  await io.waitForContinue();
  return null;
}

/**
 * The serve-write step (F1): refuse unless the loopback target is a proven
 * auth-enforcing cb, then record intent BEFORE mutating Serve, then write.
 * Returns `{ done }` for a terminal result, or `{ retry: true }` to re-check.
 */
async function writeServeWithIntent(
  deps: TailscaleDeps,
  { port, dnsName, configuredThisRun }: { port: number; dnsName: string; configuredThisRun: boolean },
): Promise<{ done: TailscaleActionResult } | { retry: true }> {
  if (configuredThisRun) {
    return {
      done: {
        ok: false,
        message:
          `Configured serve for loopback:${port} but \`tailscale serve status\` still does not reflect it — ` +
          "the write did not take. Check `tailscale serve status --json` manually.",
      },
    };
  }
  const exposable = await classifyExposable(deps, port);
  if (!exposable.ok) return { done: { ok: false, message: exposable.message } };

  if (exposable.posture === "router-guarded") {
    // The router case is proven over Serve, not on loopback: configure Serve
    // first, then require the served anonymous 401+header BEFORE recording. On a
    // failed proof `settleRouterExposure` tears the mapping down and records
    // nothing, so we return its terminal result directly (no F1 pre-record).
    const configured = await configureServe(deps, port);
    if (!configured.ok) return { done: configured };
    return { done: await settleRouterExposure(deps, { port, dnsName }) };
  }

  // F1: record intent BEFORE mutating Serve. Over-recording is the fail-closed
  // direction — if the write/verify then fails, intent STAYS and the startup
  // guard, a re-run, or `stop` heals it (never a live mapping with no guard).
  await recordExposure({ port, dnsName });
  const configured = await configureServe(deps, port);
  if (!configured.ok) return { done: configured };
  return { retry: true };
}

/** Terminal success: serve already fronts the target — re-prove auth, then
 *  (idempotently) record the intent for the already-configured path. */
async function finishReady(
  deps: TailscaleDeps,
  { port, url }: { port: number; url: string },
): Promise<TailscaleActionResult> {
  const exposable = await classifyExposable(deps, port);
  if (!exposable.ok) return { ok: false, message: exposable.message };
  const dnsName = new URL(url).hostname;
  // The router re-proves the anonymous denial over Serve (and records only on
  // that proof); a normal enforced cb records idempotently.
  if (exposable.posture === "router-guarded") return settleRouterExposure(deps, { port, dnsName });
  await recordExposure({ port, dnsName });
  return { ok: true, message: `Exposed at ${url} (loopback:${port}). Serve config + exposure intent recorded.` };
}

/**
 * Run the guided setup loop. Returns once it reaches a terminal outcome (the
 * working URL, or a refusal/error), or after a non-interactive human step, or
 * once the step budget is exhausted.
 */
export async function runTailscaleSetup(
  deps: TailscaleDeps,
  { target, io }: { target: TailscaleTarget; io: SetupIo },
): Promise<TailscaleActionResult> {
  const port = target.port;

  let configuredThisRun = false;
  for (let step = 0; step < MAX_SETUP_STEPS; step++) {
    const report = await runTailscaleStatus(deps, { target });
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
        const outcome = await guideHumanStep(io, report);
        if (outcome) return outcome;
        continue;
      }

      // State 5: serve unconfigured / pointing elsewhere — the automatable step.
      case "serve-unconfigured":
      case "serve-drift": {
        const outcome = await writeServeWithIntent(deps, { port, dnsName: report.dnsName, configuredThisRun });
        if ("done" in outcome) return outcome.done;
        configuredThisRun = true;
        continue;
      }

      case "ready":
        return finishReady(deps, { port, url: report.url });

      // Every remaining state is a refusal we can't guide past: Funnel/open
      // exposure, an ambiguous posture, a cli-error, or drifted CLI output.
      case "funnel-enabled":
      case "exposed-unauthenticated":
      case "posture-ambiguous":
      case "cli-error":
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

interface TargetMapping {
  hostPort: string;
  servePath: string;
  servePort: number;
}

/** Every serve handler — across ALL Web hosts, not just the current DNS name —
 *  whose proxy targets loopback:`port`, as an EXACT parsed match (loopback
 *  host, exact port; never a substring like `:321` inside `:3210`). Scanning
 *  every host matters for `stop`: a mapping created before a node rename, or
 *  on a non-443 serve port, still fronts the target and must be found by both
 *  teardown and the clear-the-guard proof. */
function matchingTargetMappings(serve: ServeConfigJson, port: number): TargetMapping[] {
  const out: TargetMapping[] = [];
  for (const [hostPort, site] of Object.entries(serve.Web ?? {})) {
    const servePort = Number(hostPort.slice(hostPort.lastIndexOf(":") + 1));
    for (const [servePath, h] of Object.entries(site.Handlers ?? {})) {
      if (h.Proxy !== undefined && loopbackProxyPort(h.Proxy) === port) {
        out.push({ hostPort, servePath, servePort });
      }
    }
  }
  return out;
}

type ServeReadOutcome = { ok: true; serve: ServeConfigJson } | { ok: false; reason: string };

/** Read + validate `tailscale serve status --json`, gating on spawn AND exit
 *  code (empty stdout is a valid empty config ONLY at exit 0). */
async function readServeConfig(deps: TailscaleDeps): Promise<ServeReadOutcome> {
  const run = await deps.run("tailscale", ["serve", "status", "--json"]);
  if (!run.spawned) return { ok: false, reason: "the `tailscale` CLI is not on PATH" };
  if (run.code !== 0) return { ok: false, reason: `\`tailscale serve status --json\` exited ${run.code ?? "null"}` };
  const parsed = parseServeConfig(run.stdout);
  if (!parsed.ok) return { ok: false, reason: `\`tailscale serve status --json\` was unreadable: ${parsed.message}` };
  return { ok: true, serve: parsed.value };
}

/** F2: removal could NOT be proven — keep the intent (fail closed) and fail. */
function unproven({ port, reason, hadIntent }: { port: number; reason: string; hadIntent: boolean }): TailscaleActionResult {
  const kept = hadIntent ? ` KEEPING the exposure intent for loopback:${port} (fail closed).` : "";
  return {
    ok: false,
    message:
      `Could not prove the Tailscale serve mapping for loopback:${port} is gone (${reason}).${kept} ` +
      `Re-run \`cb tailscale stop --target ${port}\` once Tailscale is reachable.`,
  };
}

/**
 * Remove only this target's serve mapping and clear its exposure record. The
 * record is teardown bookkeeping (it does not gate server startup — there is no
 * open mode to guard), so it is cleared ONLY after a readback PROVES no matching
 * serve mapping remains (F2): CLI-absent, a spawn/exit failure, or an
 * unparseable readback all keep the record and exit nonzero. Unrelated serve
 * mappings are preserved — teardown is scoped to exactly the paths that map to
 * this target, never a hardcoded `/` or a `serve reset`.
 */
export async function runTailscaleStop(
  deps: TailscaleDeps,
  { target }: { target: TailscaleTarget },
): Promise<TailscaleActionResult> {
  const port = target.port;
  const hadIntent = loadExposureFile().targets.some((t) => t.port === port);

  const statusRun = await deps.run("tailscale", ["status", "--json"]);
  if (!statusRun.spawned) {
    if (!hadIntent) {
      return { ok: true, message: `\`tailscale\` CLI not found and nothing recorded for loopback:${port} — nothing to do.` };
    }
    return unproven({ port, reason: "the `tailscale` CLI is not on PATH", hadIntent });
  }
  if (statusRun.code !== 0) {
    return unproven({ port, reason: `\`tailscale status --json\` exited ${statusRun.code ?? "null"}`, hadIntent });
  }
  const parsedStatus = parseStatusJson(statusRun.stdout);
  if (!parsedStatus.ok) {
    return unproven({ port, reason: `\`tailscale status --json\` was unreadable: ${parsedStatus.message}`, hadIntent });
  }
  const before = await readServeConfig(deps);
  if (!before.ok) return unproven({ port, reason: before.reason, hadIntent });

  const mappings = matchingTargetMappings(before.serve, port);
  if (mappings.length === 0 && !hadIntent) {
    return { ok: true, message: `Nothing configured for loopback:${port} — nothing to stop.` };
  }

  // Tear down exactly the mappings that front this target — across every Web
  // host and serve port (a pre-rename hostname or an 8443 mapping still counts).
  for (const m of mappings) {
    if (!Number.isInteger(m.servePort)) {
      return unproven({ port, reason: `serve host ${JSON.stringify(m.hostPort)} has no parseable port — cannot tear it down`, hadIntent });
    }
    const off = await deps.run("tailscale", ["serve", `--https=${m.servePort}`, `--set-path=${m.servePath}`, "off"]);
    if (!off.spawned) return unproven({ port, reason: "the `tailscale` CLI is not on PATH (during teardown)", hadIntent });
    if (off.code !== 0) {
      return unproven({ port, reason: `\`tailscale serve … off\` for ${m.hostPort}${m.servePath} exited ${off.code ?? "null"}: ${off.stderr.trim()}`, hadIntent });
    }
  }

  // Prove removal by reading serve back — clear the guard ONLY on proof, and
  // the proof re-scans every host, not just the hostname we tore down under.
  const after = await readServeConfig(deps);
  if (!after.ok) return unproven({ port, reason: `${after.reason} (readback)`, hadIntent });
  if (matchingTargetMappings(after.serve, port).length > 0) {
    return {
      ok: false,
      message:
        `A serve mapping for loopback:${port} is still present after teardown — KEEPING the exposure intent ` +
        "(fail closed). Remove it manually with `tailscale serve status`.",
    };
  }

  if (hadIntent) await clearExposure(port);
  const removed = mappings.map((m) => `${m.hostPort}${m.servePath}`).join(", ");
  return {
    ok: true,
    message:
      mappings.length > 0
        ? `Removed ${removed} → loopback:${port} and cleared its exposure intent.`
        : `No serve mapping remained for loopback:${port}; cleared its stale exposure intent.`,
  };
}
