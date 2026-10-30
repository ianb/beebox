/**
 * Make a pi `AgentSession` for a box, an added OpenRouter model and a session
 * id (docs/implemented-plans/pi-box-engine.md, Track 3). The batch agent and the chat
 * backend both start here; neither prompts the model before this returns.
 *
 * State lives in the box under `.beebox/pi/`: pi's `agentDir` in `agent/` and
 * its session files in `sessions/`. The OpenRouter key is handed to pi in
 * memory and is never written there, and no credential file is read.
 */

import "./offline.js";
import { randomUUID } from "node:crypto";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  type CreateModelRuntimeOptions,
  type AgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { piAgentDir, piSessionsDir } from "../../../pi-sessions.js";
import { addedModelKey, piModelUnpriced } from "../../../provider-env/openrouter-chat.js";
import { buildScriptEnv } from "../../../script-env/core.js";
import type { FetchLike } from "../../../secrets/probe-registry.js";
import { piResources } from "./context.js";
import { resolvePiModel } from "./model.js";
import { piGuidedFileTools } from "./nested-guidance.js";
import { piBashTool, piToolAllowlist } from "./tools.js";

// Admin warns about an added model through the run's own lookup.
export { lookupPiModel, piBundledCatalog } from "./model.js";
// The knowledge audit reads delivered guidance back from session files.
export { deliveredGuidancePaths } from "./nested-guidance.js";

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
  /** Reopen this pi session; omitted starts a new one. */
  resumeSessionId?: string | undefined;
  /** The id for a new session, when the caller needs it before the session opens; defaults to a fresh UUID. */
  newSessionId?: string | undefined;
  /** Tools the caller adds, such as a structured result tool. Always allowed. */
  customTools?: ToolDefinition[] | undefined;
  /** Refuse a model whose input or output price is unknown, for a run with a budget. */
  requireKnownPrices?: boolean | undefined;
  dryRun?: boolean | undefined;
}

export interface PiSessionDeps {
  /** For OpenRouter's public model listing, read only when pi's catalog lacks the model. */
  fetch?: FetchLike | undefined;
  now?: (() => number) | undefined;
  /** Tests substitute pi's `faux` provider here; pass `options` through to `ModelRuntime.create`. */
  createRuntime?: ((options: CreateModelRuntimeOptions) => Promise<ModelRuntime>) | undefined;
}

export type OpenedPiSession =
  | { kind: "dry-run"; model: string; tools: string[] }
  | { kind: "session"; session: AgentSession; sessionId: string; tools: string[] };

/**
 * pi's runtime reads no box file. A box agent can write under `.beebox/`:
 * `models.json` can point the OpenRouter provider, and the key with it, at
 * another host, and pi runs an `auth.json` key that starts with `!` as a shell
 * command in the server's environment. Credentials stay in memory instead.
 */
export function piRuntimeOptions(): CreateModelRuntimeOptions {
  return { credentials: new InMemoryCredentialStore(), modelsPath: null };
}

async function createRuntime(options: CreateModelRuntimeOptions): Promise<ModelRuntime> {
  return ModelRuntime.create(options);
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

function sessionManagerFor(
  options: { boxRoot: string; cwd: string; resumeSessionId: string | undefined; newSessionId: string | undefined },
): SessionManager {
  const dir = piSessionsDir(options.boxRoot);
  if (options.resumeSessionId === undefined) return SessionManager.create(options.cwd, dir, { id: options.newSessionId ?? randomUUID() });
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
  const runtime = await (deps?.createRuntime ?? createRuntime)(piRuntimeOptions());
  await runtime.setRuntimeApiKey("openrouter", key);
  const { model, pricesKnown } = await resolvePiModel(
    { catalog: runtime, id: options.model },
    { fetch: deps?.fetch ?? fetch, now: (deps?.now ?? Date.now)() },
  );
  if (options.requireKnownPrices === true && !pricesKnown) throw piModelUnpriced(options.model);
  const { settingsManager, resourceLoader, guidance } = await piResources({
    boxRoot,
    cwd,
    agentDir,
    systemPrompt: options.systemPrompt,
    loadBoxContext: options.loadBoxContext !== false,
  });
  const bash = piBashTool(cwd, await buildScriptEnv(boxRoot, options.env));
  const fileTools = guidance === null ? [] : piGuidedFileTools(guidance, { autoResizeImages: settingsManager.getImageAutoResize() });
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime: runtime,
    model,
    sessionManager: sessionManagerFor({ boxRoot, cwd, resumeSessionId: options.resumeSessionId, newSessionId: options.newSessionId }),
    settingsManager,
    resourceLoader,
    // A custom tool named `bash`, `read`, `edit` or `write` replaces the built-in one; the allowlist decides whether it is active.
    customTools: [bash, ...fileTools, ...customTools],
    tools,
  });
  return { kind: "session", session, sessionId: session.sessionId, tools };
}
