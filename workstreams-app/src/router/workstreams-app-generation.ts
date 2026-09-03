// One generation of the workstreams app — a backend child and a frontend child
// spawned together, made ready together, and stopped together. Split out of
// workstreams-app-supervisor.ts as a pure move: the supervisor owns the state
// machine and this module owns the pair of processes underneath it.

import {
  settled,
  type Generation,
  type WorkstreamsAppChild,
  type WorkstreamsAppEffects,
  type WorkstreamsAppHealth,
  type WorkstreamsAppSpawnOptions,
  type WorkstreamsAppSupervisorConfig,
} from "./workstreams-app-contract.js";

/** A child that died during startup, before the readiness race could answer. */
export class ChildExitedBeforeReadinessError extends Error {
  constructor(readonly kind: "backend" | "frontend", readonly detail: string) {
    super(`${kind} exited before readiness (${detail})`);
    this.name = "ChildExitedBeforeReadinessError";
  }
}

function exitDetail(exit: { code: number | null; signal: NodeJS.Signals | null }): string {
  return exit.signal ? `signal ${exit.signal}` : `code ${String(exit.code)}`;
}

export interface GenerationManager {
  /** The generation this supervisor considers current, if any. */
  current(): Generation | null;
  /** Hand back the current generation and stop considering it current. */
  take(): Generation | null;
  spawn(): Promise<{ generation: Generation; health: WorkstreamsAppHealth }>;
  stop(generation: Generation): Promise<void>;
}

export function createGenerationManager(options: {
  effects: WorkstreamsAppEffects;
  config: WorkstreamsAppSupervisorConfig;
  exhibitsPort: number;
  killGraceMs: number;
  startupTimeoutMs: number;
  isShuttingDown: () => boolean;
  /** The child binds the exhibits port, so the fallback must let go first. */
  releaseExhibitsPort: () => Promise<void>;
  /** A child died on its own: the supervisor turns this into a failed state. */
  onUnexpectedExit: (failure: { message: string; portFreed: Promise<void> }) => void;
}): GenerationManager {
  const { effects, config } = options;
  let current: Generation | null = null;
  let generationId = 0;
  let exhibitsToken: string | null = null;

  async function stop(generation: Generation): Promise<void> {
    generation.intentionalStop = true;
    await effects.stopChildren([generation.backend, generation.frontend], options.killGraceMs);
    await effects.removeGeneration(generation);
  }

  function childExited(input: {
    generation: Generation;
    kind: "backend" | "frontend";
    exit: { code: number | null; signal: NodeJS.Signals | null };
  }): void {
    const { generation, kind } = input;
    if (generation.intentionalStop || current !== generation || options.isShuttingDown()) return;
    current = null;
    const detail = exitDetail(input.exit);
    void effects.removeGeneration(generation);
    generation.intentionalStop = true;
    // One child died; its sibling may still be listening on the exhibits port.
    // Stop it FIRST and let the fallback bind after — the other order races
    // the surviving child for the port and loses it to EADDRINUSE.
    const stopped = effects.stopChildren([generation.backend, generation.frontend], options.killGraceMs);
    options.onUnexpectedExit({
      message: `${kind} exited unexpectedly (${detail})`,
      portFreed: settled(stopped),
    });
  }

  function wireChildExits(generation: Generation): void {
    generation.backend.onExit((exit) => childExited({ generation, kind: "backend", exit }));
    generation.frontend.onExit((exit) => childExited({ generation, kind: "frontend", exit }));
  }

  async function spawn(): Promise<{ generation: Generation; health: WorkstreamsAppHealth }> {
    await effects.prepare(config.logPath);
    const [backendPort, frontendPort] = await Promise.all([effects.getPort(), effects.getPort()]);
    const capability = effects.randomCapability();
    const buildId = effects.randomBuildId();
    exhibitsToken ??= await effects.exhibitsToken();
    const spawnOptions: WorkstreamsAppSpawnOptions = {
      appRoot: config.appRoot,
      backendPort,
      frontendPort,
      exhibitsPort: options.exhibitsPort,
      exhibitsToken,
      capability,
      buildId,
      logPath: config.logPath,
    };
    await options.releaseExhibitsPort();
    const backend = effects.spawnBackend(spawnOptions);
    const frontend = effects.spawnFrontend(spawnOptions);
    const generation: Generation = {
      id: ++generationId,
      backend,
      frontend,
      backendPid: backend.pid,
      frontendPid: frontend.pid,
      backendPort,
      frontendPort,
      capability,
      intentionalStop: false,
      startedAt: effects.now(),
    };
    current = generation;
    wireChildExits(generation);
    await effects.recordGeneration(generation);
    const exitedEarly = (kind: "backend" | "frontend", child: WorkstreamsAppChild) =>
      child.exited.then((exit) => {
        throw new ChildExitedBeforeReadinessError(kind, exitDetail(exit));
      });
    const health = await Promise.race([
      effects.waitUntilReady({ backendPort, frontendPort, capability, timeoutMs: options.startupTimeoutMs }),
      exitedEarly("backend", backend),
      exitedEarly("frontend", frontend),
    ]);
    return { generation, health };
  }

  return {
    current: () => current,
    take: () => {
      const generation = current;
      current = null;
      return generation;
    },
    spawn,
    stop,
  };
}
