// Spawning one generation's two children, and watching them for the rest of
// their lives.
//
// Split out of router-worktree-start.ts, which kept getting longer: that file is
// now the shape of a cold start (resolve, bring up, publish or park) and this one
// is the children themselves. Read bin/docs/router-protocol.md before changing
// either — invariant #3 (swallow the execa rejection at the spawn site, before
// any await) lives here and has a pointing comment at the code implementing it.

import path from "node:path";
import type { WriteStream } from "node:fs";
import { boxEntryToArg } from "./box-entry.js";
import type { WorktreeHandle } from "./router-lifecycle.js";
import type { SpawnedChild } from "./router-effects.js";
import { onChildExit, type CoreState } from "./router-worktree-teardown.js";
import type { StartPlan, StartProgress } from "./router-worktree-start.js";

/**
 * How long a generation may take to answer HTTP.
 *
 * Was a fixed 30s, which is what turned a CPU shortage into a three-hour outage
 * on 2026-09-15: a cold Vite on a machine running two parallel test suites could
 * not compile and answer `GET /main/` in time, and the worktree parked as
 * permanently failed. `beebox/.taprc` records the scale of the distortion —
 * hub-e2e at 8.4s solo against 110.8s loaded — and the ledger puts p90 per-file
 * inflation at 3.05x under two concurrent full runs.
 *
 * A bigger number alone would be the wrong fix, and this one is only affordable
 * because of `childDeath` below: the budget is no longer what catches a broken
 * worktree (a dying child is, in about two seconds — FASTER than the old 30s),
 * only the backstop for a child that is alive but will never serve.
 */
export const READY_BUDGET_MS = 180_000;

/** A lifecycle child that exited before its generation reached `ready`. */
export interface ChildExit {
  label: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}

export class ChildExitError extends Error {
  constructor(readonly exit: ChildExit) {
    super(`${exit.label} exited during startup (code=${String(exit.code)} signal=${String(exit.signal)})`);
    this.name = "ChildExitError";
  }
}

/** The two spawned children plus the tails of their output. */
export interface Generation {
  vite: SpawnedChild;
  fastify: SpawnedChild;
  viteOutput: { read: () => string };
  fastifyOutput: { read: () => string };
  /** Rejects as soon as either child exits while the generation is still
   *  `starting`; never resolves on its own. Raced against readiness so a child
   *  that dies fails the start immediately instead of waiting out the budget. */
  childDeath: Promise<never>;
}

/**
 * Tee a child's stdout+stderr into the worktree log AND a fixed-size ring
 * buffer holding the tail of the interleaved output, which the failed-startup
 * page surfaces. The ring is byte-counted.
 */
function captureOutput(child: SpawnedChild, logStream: WriteStream): { read: () => string } {
  const maxBytes = 8 * 1024;
  let buf = "";
  const write = (s: string): void => {
    buf += s;
    if (buf.length > maxBytes) buf = buf.slice(buf.length - maxBytes);
  };
  child.stdout?.pipe(logStream, { end: false });
  child.stderr?.pipe(logStream, { end: false });
  child.stdout?.on("data", (d: Buffer) => write(d.toString("utf8")));
  child.stderr?.on("data", (d: Buffer) => write(d.toString("utf8")));
  return { read: () => buf };
}

export async function spawnGeneration(
  state: CoreState,
  { plan, handle, progress }: { plan: StartPlan; handle: WorktreeHandle; progress: StartProgress },
): Promise<Generation> {
  const { effects, config, log } = state;
  const { wt, backendPort, frontendPort, childEnv, logStream } = plan;
  const name = wt.name;

  // Each of wt.boxes may be a legacy box dir, a v2 package root, or a v2
  // content dir (see box-entry.ts) — resolve to {contentDir, slug} before
  // handing off to the backend, which no longer guesses the slug itself.
  const resolvedBoxes = await effects.resolveBoxEntries(wt.boxes);
  const backendArgs = config.devNoHub
    ? ["./src/webapp/server-main.ts", ...resolvedBoxes.map(boxEntryToArg)]
    : ["./src/cli/index.ts", "engine", "hub", "--config", await effects.writeHubConfig({ name, backendPort, resolvedBoxes })];
  const fastify = effects.spawn("node", {
    args: ["--import=./tsx-preload.mjs", "--import", "tsx", ...backendArgs],
    options: {
      cwd: wt.backendCwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      cleanup: true,
    },
  });
  // Invariant #3 of bin/docs/router-protocol.md: swallow the execa rejection at
  // spawn time — the VERY NEXT line, before any await. Without it the rejection
  // becomes an unhandledRejection minutes later (when the killed child finally
  // exits) and crashes the whole router. Actual exit handling happens via
  // .on("exit") below; this only prevents the crash. Was a real bug until
  // 2026-06-04. The waitForHttp-failure path throws between here and the exit
  // wiring, so this MUST be here, not on the success path.
  fastify.catch(() => {
    /* handled via .on("exit") + failed-state UX */
  });
  const fastifyOutput = captureOutput(fastify, logStream);

  // pnpm workspace with `nodeLinker: hoisted` (see /pnpm-workspace.yaml) puts all binaries
  // at the workspace root's node_modules/.bin — per-package node_modules/.bin
  // dirs aren't populated. Resolve vite from the worktree's monorepo root.
  const viteBin = path.join(wt.root, "node_modules", ".bin", "vite");
  // `--strictPort` because Vite's default is to walk to the NEXT port when the
  // requested one is taken — and the next port is, structurally, the hub's.
  // The three getPort() probes above run in parallel, so the OS hands back
  // sequential ephemeral ports; a frontend port stolen between probe and bind
  // sends Vite onto `backendPort`, which it wins because the hub binds later.
  // The hub then dies with EADDRINUSE and the worktree is `failed` with the
  // cause 30 lines up its log (observed on `main`, 2026-08-18).
  // Failing loudly here is strictly better: same failure, correct attribution,
  // retryable through the router's existing failed-state path.
  const vite = effects.spawn(viteBin, {
    args: ["dev", "--port", String(frontendPort), "--strictPort"],
    options: {
      cwd: wt.frontendCwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      cleanup: true,
    },
  });
  vite.catch(() => {
    /* see fastify.catch above — same reason (invariant #3) */
  });
  const viteOutput = captureOutput(vite, logStream);

  // ONE exit listener per child, attached here and never removed, dispatching
  // on the handle's current phase.
  //
  // It used to be attached in `publishGeneration` instead — i.e. only after
  // readiness — which left the whole of startup watched by nothing but a
  // stopwatch, unable to tell a slow Vite from a dead one. Attaching a startup
  // listener and detaching it at the terminal would be worse, not better: it
  // opens a window between the readiness probe resolving and publication in
  // which a dying child has no listener at all, and `SpawnedChild`
  // (router-effects.ts) exposes no detach to close it with. So the listener
  // outlives every phase and asks the handle what to do.
  let failReadiness: (err: unknown) => void = () => {
    /* replaced synchronously below, before any child can exit */
  };
  const childDeath = new Promise<never>((_resolve, reject) => {
    failReadiness = reject;
  });
  // This promise is only ever rejected, and the race that consumes it may settle
  // first — without this, a child dying after a successful start is an
  // unhandledRejection that takes the router down. Same discipline as invariant
  // #3's spawn-site catches above.
  childDeath.catch(() => {
    /* consumed by the readiness race, or deliberately dropped after it */
  });

  const watch = (child: SpawnedChild, label: string): void => {
    child.on("exit", (code, signal) => {
      log(`[${name}] ${label} exited code=${code} signal=${signal}`);
      if (handle.lifecycle.phase === "starting") {
        progress.failurePhase = "childExit";
        failReadiness(new ChildExitError({ label, code, signal }));
        return;
      }
      // `ready` tears the generation down; `failed` and `stopping` are already
      // terminal and onChildExit no-ops on both (its `if (!ready) return`),
      // which is what makes one listener safe across the whole lifecycle.
      onChildExit(state, handle);
    });
  };
  watch(vite, "vite");
  watch(fastify, "fastify");

  return { vite, fastify, viteOutput, fastifyOutput, childDeath };
}
