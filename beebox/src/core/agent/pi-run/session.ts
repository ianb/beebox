/**
 * Make a pi `AgentSession` for a box, an added OpenRouter model and a session
 * id (docs/plans/pi-box-engine.md, Track 3). The batch agent and the chat
 * backend both start here; neither prompts the model before this returns.
 *
 * State lives in the box under `.beebox/pi/`: pi's `agentDir` in `agent/` and
 * its session files in `sessions/`. The OpenRouter key is handed to pi in
 * memory and is never written there.
 */

import "./offline.js";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  type AgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { addedModelKey } from "../../provider-env/openrouter-chat.js";
import { buildScriptEnv } from "../../script-env/core.js";
import type { FetchLike } from "../../secrets/probe-registry.js";
import { piResources } from "./context.js";
import { resolvePiModel } from "./model.js";
import { piBashTool, piToolAllowlist } from "./tools.js";

export function piAgentDir(boxRoot: string): string {
  return join(boxRoot, ".beebox", "pi", "agent");
}

export function piSessionsDir(boxRoot: string): string {
  return join(boxRoot, ".beebox", "pi", "sessions");
}

export interface PiSessionOptions {
  boxRoot: string;
  /** An added OpenRouter model id, as the box's model policy resolved it. */
  model: string;
  /** Why the OpenRouter key is read, for the secret-access audit. */
  purpose: string;
  systemPrompt?: string | undefined;
  /** Per-invocation additions to the shell environment, as `AgentInvokeOptions.env`. */
  env?: Record<string, string> | undefined;
  /** As `AgentInvokeOptions.tools`. */
  tools?: string[] | undefined;
  /** As `AgentInvokeOptions.loadBoxContext`; defaults to true. */
  loadBoxContext?: boolean | undefined;
  /** As `AgentInvokeOptions.cwd`; defaults to the box root. */
  cwd?: string | undefined;
  /** Reopen this pi session; omitted starts a new one with a fresh UUID. */
  resumeSessionId?: string | undefined;
  /** Tools the caller adds, such as a structured result tool. Always allowed. */
  customTools?: ToolDefinition[] | undefined;
  dryRun?: boolean | undefined;
}

export interface PiSessionDeps {
  /** For OpenRouter's public model listing, read only when pi's catalog lacks the model. */
  fetch?: FetchLike | undefined;
  now?: (() => number) | undefined;
  /** Tests substitute pi's `faux` provider here. */
  createRuntime?: ((options: { authPath: string }) => Promise<ModelRuntime>) | undefined;
}

export type OpenedPiSession =
  | { kind: "dry-run"; model: string; tools: string[] }
  | { kind: "session"; session: AgentSession; sessionId: string; tools: string[] };

/**
 * `models.json` is not read: a box agent can write under `.beebox/`, and that
 * file can point the OpenRouter provider, and the key with it, at another host.
 */
async function createRuntime(options: { authPath: string }): Promise<ModelRuntime> {
  return ModelRuntime.create({ authPath: options.authPath, modelsPath: null });
}

/** A resume names a pi session with no file under the box's pi sessions directory. */
export class PiSessionNotFoundError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super("The pi session to resume has no session file in this box");
    this.name = "PiSessionNotFoundError";
    this.sessionId = sessionId;
  }
}

function sessionManagerFor(options: { boxRoot: string; cwd: string; resumeSessionId: string | undefined }): SessionManager {
  const dir = piSessionsDir(options.boxRoot);
  if (options.resumeSessionId === undefined) return SessionManager.create(options.cwd, dir, { id: randomUUID() });
  const path = SessionManager.findById(options.cwd, options.resumeSessionId, dir);
  if (path === undefined) throw new PiSessionNotFoundError(options.resumeSessionId);
  return SessionManager.open(path, dir);
}

/**
 * Open a pi session ready to prompt, or, for a dry run, say what would run
 * without reading the key, writing state, or calling a model.
 */
export async function openPiSession(options: PiSessionOptions, deps?: PiSessionDeps): Promise<OpenedPiSession> {
  const customTools = options.customTools ?? [];
  const tools = piToolAllowlist(options.tools, customTools.map((tool) => tool.name));
  if (options.dryRun === true) return { kind: "dry-run", model: options.model, tools };

  const { boxRoot } = options;
  const cwd = options.cwd ?? boxRoot;
  const key = await addedModelKey({ boxRoot, model: options.model, purpose: options.purpose });
  const agentDir = piAgentDir(boxRoot);
  const runtime = await (deps?.createRuntime ?? createRuntime)({ authPath: join(agentDir, "auth.json") });
  await runtime.setRuntimeApiKey("openrouter", key);
  const model = await resolvePiModel(
    { runtime, id: options.model },
    { fetch: deps?.fetch ?? fetch, now: (deps?.now ?? Date.now)() },
  );
  const { settingsManager, resourceLoader } = await piResources({
    boxRoot,
    cwd,
    agentDir,
    systemPrompt: options.systemPrompt,
    loadBoxContext: options.loadBoxContext !== false,
  });
  const bash = piBashTool(cwd, await buildScriptEnv(boxRoot, options.env));
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime: runtime,
    model,
    sessionManager: sessionManagerFor({ boxRoot, cwd, resumeSessionId: options.resumeSessionId }),
    settingsManager,
    resourceLoader,
    // A custom tool named `bash` replaces the built-in one; the allowlist decides whether it is active.
    customTools: [bash, ...customTools],
    tools,
  });
  return { kind: "session", session, sessionId: session.sessionId, tools };
}
