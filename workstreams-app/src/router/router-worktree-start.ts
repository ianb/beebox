// Cold-starting one worktree generation: resolve the checkout, allocate ports,
// build the child environment, spawn vite + the backend, wait for both to serve
// HTTP, then publish `ready` — or capture the failure for the failed-startup
// page. Split out of router-core.ts, which now owns only the map, the
// registration guard (`ensureRunning`), and the assembly.
//
// Invariant #5 (guarded publication at BOTH terminals) lives here, with a
// pointing comment at the code implementing it. Invariant #3 (swallow the execa
// rejection at the spawn site) moved to router-generation.ts with the spawn
// itself, which also owns the children's exit listeners and the readiness
// budget. Read bin/docs/router-protocol.md before changing either file.

import { createWriteStream, type WriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type WorktreeHandle,
  type CapturedError,
  transitionLifecycle,
  retryDecision,
} from "./router-lifecycle.js";
import type { PidExpectation } from "./router-pidfile.js";
import {
  errMessage,
  statusError,
  readEnvFile,
  type ResolvedWorktree,
} from "./router-effects.js";
import { READY_BUDGET_MS, spawnGeneration, type Generation } from "./router-generation.js";
import {
  browseDirsFor,
  isolatedSecretsFileFor,
  killChildren,
  stopDashboardCmd,
  touch,
  type CoreState,
} from "./router-worktree-teardown.js";

/** Everything resolved before a single child is spawned. */
export interface StartPlan {
  wt: ResolvedWorktree;
  logFile: string;
  logStream: WriteStream;
  frontendPort: number;
  backendPort: number;
  dashboardPort: number;
  socketDir: string;
  profileDir: string;
  baseUrl: string;
  childEnv: NodeJS.ProcessEnv;
  browseEnv: NodeJS.ProcessEnv;
}

/** Which stage the startup reached, for the failed-startup page. */
export interface StartProgress {
  failurePhase: string;
  dashboardStarted: boolean;
}

async function prepareStart(state: CoreState, handle: WorktreeHandle): Promise<StartPlan> {
  const { effects, config, log } = state;
  const name = handle.name;
  const wt = await effects.resolveWorktree(name);
  if (!wt) throw statusError(`Worktree ${JSON.stringify(name)} not found`, 404);
  log(`[${name}] starting`);

  await fs.mkdir(config.logDir, { recursive: true });
  const logFile = path.join(config.logDir, `${name}.log`);
  const logStream = createWriteStream(logFile, { flags: "a" });
  logStream.write(`\n=== router start ${new Date(effects.now()).toISOString()} ===\n`);

  const [frontendPort, backendPort, dashboardPort] = await Promise.all([
    effects.getPort(),
    effects.getPort(),
    effects.getPort(),
  ]);
  const { socketDir, profileDir } = browseDirsFor(state, name);
  const isolatedSecretsFile = isolatedSecretsFileFor(state.config.browseDir, name);
  await Promise.all([
    fs.mkdir(socketDir, { recursive: true }),
    fs.mkdir(profileDir, { recursive: true }),
    ...(isolatedSecretsFile === undefined ? [] : [fs.mkdir(path.dirname(isolatedSecretsFile), { recursive: true })]),
  ]);

  const baseUrl = `/${name}/`;
  // --disable-warning=DEP0040 silences the punycode deprecation that
  // transitive deps (ajv@6, node-fetch 2) trigger on every node start.
  const nodeOptions = [process.env.NODE_OPTIONS, "--disable-warning=DEP0040"].filter(Boolean).join(" ");
  const childEnv: NodeJS.ProcessEnv = {
    // This checkout's own `beebox/.env` is local dev config for the
    // processes we spawn (BBX_BROWSE_API_KEY, …), not just the `BOXES=` line
    // the router greps out of it elsewhere. A real exported variable wins
    // over the file, so `FOO=x pnpm dev` still overrides — standard dotenv
    // precedence. Worktrees get their copy from the WorktreeCreate hook;
    // nothing here reaches into another checkout.
    ...(await readEnvFile(path.join(wt.root, "beebox", ".env"), config.log)),
    ...process.env,
    FRONTEND_PORT: String(frontendPort),
    BACKEND_PORT: String(backendPort),
    VITE_BASE: baseUrl,
    PORT: String(backendPort),
    BBX_DEV_SURFACES: "1",
    NODE_OPTIONS: nodeOptions,
    // A worktree's box must never touch the boxholder's real secret store:
    // its test keys are its own, its Secrets panel is drivable by an agent,
    // and a bug there cannot cost a real credential. `main` IS the real
    // deployment surface on this machine and keeps the default store.
    ...(isolatedSecretsFile !== undefined && { BBX_SECRETS_FILE: isolatedSecretsFile, BBX_SECRETS_STORE_ISOLATED: "1" }),
  };
  // `main` may inherit an override path from the shell or `.env` — that is
  // its operator's store to use, but never a throwaway one: the isolation
  // assertion is the router's to make, and it makes it only for worktrees.
  if (isolatedSecretsFile === undefined) delete childEnv.BBX_SECRETS_STORE_ISOLATED;
  const browseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    AGENT_BROWSER_SOCKET_DIR: socketDir,
    AGENT_BROWSER_PROFILE: profileDir,
    AGENT_BROWSER_IDLE_TIMEOUT_MS: String(config.idleTimeoutMs),
  };

  log(`[${name}] frontend=${frontendPort} backend=${backendPort} dashboard=${dashboardPort} base=${baseUrl}`);

  return {
    wt,
    logFile,
    logStream,
    frontendPort,
    backendPort,
    dashboardPort,
    socketDir,
    profileDir,
    baseUrl,
    childEnv,
    browseEnv,
  };
}

/**
 * Everything from the dashboard daemon through readiness, sharing ONE
 * try/catch: a synchronous/rejected failure at ANY of these stages (dashboard
 * start already catches its own; a rejected pidStore.write is the one that used
 * to slip past uncaught) must reach the same cleanup + guarded-publication
 * logic as a waitForHttp timeout, not bypass it and leak the two children.
 *
 * Resolves to whether the dashboard daemon started; on failure rejects with the
 * cause, having recorded which stage it happened in on `progress`.
 */
async function bringUpGeneration(
  state: CoreState,
  args: { plan: StartPlan; generation: Generation; progress: StartProgress },
): Promise<void> {
  const { effects, config, log } = state;
  const { plan, generation, progress } = args;
  const { wt, browseEnv, dashboardPort, frontendPort, backendPort, baseUrl, socketDir, profileDir } = plan;
  const name = wt.name;

  // Kill any orphaned dashboard daemon for this socket dir before starting a new one.
  await stopDashboardCmd(state, browseEnv);

  try {
    await effects.spawn("node", {
      args: [config.agentBrowserBin, "dashboard", "start", "--port", String(dashboardPort)],
      options: { env: browseEnv, stdio: "ignore", timeout: 15000 },
    });
    progress.dashboardStarted = true;
    log(`[${name}] dashboard ready on :${dashboardPort}`);
  } catch (err) {
    log(`[${name}] dashboard failed to start: ${errMessage(err)}`);
  }

  progress.failurePhase = "pidStore.write";
  await effects.pidStore.write(name, {
    name,
    vitePid: generation.vite.pid,
    fastifyPid: generation.fastify.pid,
    frontendPort,
    backendPort,
    dashboardPort: progress.dashboardStarted ? dashboardPort : null,
    socketDir,
    profileDir,
    routerPid: config.routerPid,
    startedAt: effects.now(),
  });

  // Wait for both to serve HTTP — not just accept TCP — or for either child to
  // die first. A bad config or a syntax error kills Vite in about two seconds
  // and now reports in about two seconds; only a child that is alive but never
  // serves reaches the budget.
  progress.failurePhase = "waitForHttp";
  await Promise.race([
    Promise.all([
      effects.waitForHttp(frontendPort, { reqPath: baseUrl, timeoutMs: READY_BUDGET_MS, label: `vite/${name}` }),
      effects.waitForHttp(backendPort, { reqPath: "/healthz", timeoutMs: READY_BUDGET_MS, label: `fastify/${name}` }),
    ]),
    generation.childDeath,
  ]);
}

/** The startup-failure terminal: tear the generation down and park (or discard)
 *  the failure record. Always throws. */
async function failStart(
  state: CoreState,
  args: { handle: WorktreeHandle; plan: StartPlan; generation: Generation; progress: StartProgress; err: unknown },
): Promise<never> {
  const { effects, worktrees, retryAttempts, log } = state;
  const { handle, plan, generation, progress, err } = args;
  const { browseEnv, dashboardPort } = plan;
  const name = handle.name;
  const { vite, fastify } = generation;
  const expect: PidExpectation = { vitePid: vite.pid, fastifyPid: fastify.pid };

  const killTimer = killChildren(state, { vitePid: vite.pid, fastifyPid: fastify.pid });
  // The dashboard daemon started before waitForHttp; stop it too so a failed
  // startup doesn't leak an agent-browser process.
  if (progress.dashboardStarted) await stopDashboardCmd(state, browseEnv);
  // Safe even if pidStore.write above never ran (or never got this far) —
  // remove() falls through to a no-op unlink when the record is missing.
  await effects.pidStore.remove(name, expect);
  const captured: CapturedError = {
    message: errMessage(err),
    phase: progress.failurePhase,
    viteOutput: generation.viteOutput.read(),
    fastifyOutput: generation.fastifyOutput.read(),
    at: effects.now(),
  };
  log(`[${name}] startup failed in ${captured.phase}: ${captured.message} (load1 ${effects.load1().toFixed(1)})`);
  // Invariant #5: guarded publication at the failure terminal too. If a stop
  // (or a newer generation) superseded us while we were failing, DON'T park a
  // `failed` record — this handle is off the map, so terminate it as
  // `stopping` (self-clean semantics) and let the generation that owns the
  // slot stand. Only the current generation publishes its `failed` record.
  if (worktrees.get(name) !== handle) {
    log(`[${name}] startup failed but this generation was superseded — not publishing failure`);
    transitionLifecycle(handle, {
      phase: "stopping",
      reason: "requested",
      vitePid: vite.pid,
      fastifyPid: fastify.pid,
      dashboardPort: progress.dashboardStarted ? dashboardPort : null,
      browseEnv,
      killTimer,
    });
    throw statusError(captured.message, 502);
  }
  // The count is keyed by NAME and lives on CoreState, so it survives the
  // clear-and-restart that an automatic retry performs — a counter on the
  // handle would reset on exactly the event it is meant to bound.
  const attempts = retryAttempts.get(name) ?? 0;
  const { retryAfter } = retryDecision({ phase: captured.phase, attempts, now: effects.now() });
  if (retryAfter === null && attempts > 0) {
    log(`[${name}] parked after ${String(attempts)} automatic retr${attempts === 1 ? "y" : "ies"}`);
  }
  transitionLifecycle(handle, { phase: "failed", lastError: captured, attempts, retryAfter });
  // The failed generation is parked for the error page + retry; its
  // escalation timer stays fire-and-forget (the `failed` variant carries no
  // children to cancel), but it still fires through the timer effect.
  throw statusError(captured.message, 502);
}

/** The success terminal: publish `ready` (or self-clean if superseded). */
async function publishGeneration(
  state: CoreState,
  args: { handle: WorktreeHandle; plan: StartPlan; generation: Generation; progress: StartProgress; sourceToken: string | null },
): Promise<WorktreeHandle> {
  const { effects, worktrees, log } = state;
  const { handle, plan, generation, progress, sourceToken } = args;
  const { browseEnv, dashboardPort, frontendPort, backendPort, socketDir, profileDir, logFile } = plan;
  const { vite, fastify } = generation;
  const name = handle.name;
  const expect: PidExpectation = { vitePid: vite.pid, fastifyPid: fastify.pid };

  // Invariant #5: guarded publication. A `/__router/stop/<name>` (or a newer
  // generation) during this cold start unlinks the handle from the map; if that
  // happened, DON'T publish — kill our own children, remove our own pidfile,
  // and resolve without reappearing in the map (the completed start must not
  // silently resurrect a worktree the user stopped, nor clobber a replacement).
  if (worktrees.get(name) !== handle) {
    log(`[${name}] startup finished but this generation was superseded — self-cleaning, not publishing`);
    const killTimer = killChildren(state, { vitePid: vite.pid, fastifyPid: fastify.pid });
    if (progress.dashboardStarted) await stopDashboardCmd(state, browseEnv);
    await effects.pidStore.remove(name, expect);
    transitionLifecycle(handle, {
      phase: "stopping",
      reason: "requested",
      vitePid: vite.pid,
      fastifyPid: fastify.pid,
      dashboardPort: progress.dashboardStarted ? dashboardPort : null,
      browseEnv,
      killTimer,
    });
    return handle;
  }

  // Still the current generation — publish `ready` by transitioning the same
  // handle in place (it has been in the map since ensureRunning registered it;
  // no map replacement, so the identity guards stay valid).
  transitionLifecycle(handle, {
    phase: "ready",
    vitePid: vite.pid,
    fastifyPid: fastify.pid,
    frontendPort,
    backendPort,
    dashboardPort: progress.dashboardStarted ? dashboardPort : null,
    dashboardUrl: progress.dashboardStarted ? `http://localhost:${dashboardPort}/` : null,
    socketDir,
    profileDir,
    browseEnv,
    logFile,
    sourceToken,
    lastActivity: effects.now(),
    idleTimer: null,
    staleSince: null,
    lastStaleCheck: effects.now(),
  });
  touch(state, handle);
  // Came up: there is no retry history worth keeping for this name.
  state.retryAttempts.delete(name);
  log(`[${name}] ready`);

  // Exit listeners are NOT attached here: `spawnGeneration` attached them, and
  // they have been watching since before this generation could have failed.
  // Attaching them at this point was the old shape, and it meant a child dying
  // between the readiness probe and this line went unnoticed.
  // execa-promise rejection handlers are likewise attached at spawn time, so
  // they're in place even on the waitForHttp-failure path.

  return handle;
}

export async function startWorktree(state: CoreState, handle: WorktreeHandle): Promise<WorktreeHandle> {
  const { effects } = state;
  const plan = await prepareStart(state, handle);
  // Taken BEFORE the spawn, so a source change that lands during startup
  // reads as stale rather than being baked in as this generation's baseline.
  const sourceToken = await effects.sourceToken(plan.wt.root);
  // Built BEFORE the spawn: the exit listeners attached inside spawnGeneration
  // record which phase they failed in, so `progress` has to exist first.
  const progress: StartProgress = { failurePhase: "spawn", dashboardStarted: false };
  const generation = await spawnGeneration(state, { plan, handle, progress });

  progress.failurePhase = "dashboard-start";
  try {
    await bringUpGeneration(state, { plan, generation, progress });
  } catch (err) {
    return await failStart(state, { handle, plan, generation, progress, err });
  }

  return publishGeneration(state, { handle, plan, generation, progress, sourceToken });
}
