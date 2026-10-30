import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { encodeProjectDir } from "../../transcript-paths.js";
import { parseSdkSessionId } from "../../id.js";
import { isWithin } from "../../../../../lib/box-containment.js";
import { pathExistsStrict } from "../../../../../lib/file-exists.js";

export type SessionStorageState = "present" | "partial" | "absent";

class LexicallyUnsafeSessionContextError extends Error {
  constructor() {
    super("Chat context directory escapes the box");
    this.name = "LexicallyUnsafeSessionContextError";
  }
}

class ResolvedUnsafeSessionContextError extends Error {
  constructor() {
    super("Chat context directory resolves outside the box");
    this.name = "ResolvedUnsafeSessionContextError";
  }
}

class SessionStorageUnchangedError extends Error {
  constructor() {
    super("SDK session delete returned without removing local storage");
    this.name = "SessionStorageUnchangedError";
  }
}

export interface SessionStorageTargets {
  cwd: string;
  jsonlPath: string;
  sidecarPath: string;
}

export interface SessionStoragePresence {
  jsonl: boolean;
  sidecar: boolean;
  state: SessionStorageState;
}

function projectsRoot(): string {
  // TODO(env-migration): test/storage-path override is intentionally lazy.
  const callbackOverride = process.env["BBX_CLAUDE_PROJECTS_DIR"];
  if (callbackOverride !== undefined) return callbackOverride;
  // TODO(env-migration): Claude's own config-root override is intentionally lazy.
  const claudeConfig = process.env["CLAUDE_CONFIG_DIR"];
  return path.join(claudeConfig ?? path.join(os.homedir(), ".claude"), "projects");
}

/** Resolve the exact SDK cwd and storage paths after box-containment checks. */
export async function resolveSessionStorageTargets(args: { boxRoot: string; contextDir?: string | undefined; sessionId: string }): Promise<SessionStorageTargets> {
  const sessionId = parseSdkSessionId(args.sessionId);
  const lexicalRoot = path.resolve(args.boxRoot);
  const lexicalCwd = path.resolve(lexicalRoot, args.contextDir ?? "");
  if (!isWithin(lexicalRoot, lexicalCwd)) {
    throw new LexicallyUnsafeSessionContextError();
  }
  const [realRoot, realCwd] = await Promise.all([fs.realpath(lexicalRoot), fs.realpath(lexicalCwd)]);
  if (!isWithin(realRoot, realCwd)) {
    throw new ResolvedUnsafeSessionContextError();
  }
  const projectDir = path.join(projectsRoot(), encodeProjectDir(realCwd));
  return {
    cwd: realCwd,
    jsonlPath: path.join(projectDir, `${sessionId}.jsonl`),
    sidecarPath: path.join(projectDir, sessionId),
  };
}

async function inspectSessionStorage(targets: SessionStorageTargets): Promise<SessionStorageState> {
  return (await inspectSessionStoragePresence(targets)).state;
}

export async function inspectSessionStoragePresence(targets: SessionStorageTargets): Promise<SessionStoragePresence> {
  const [jsonl, sidecar] = await Promise.all([pathExistsStrict(targets.jsonlPath, { followLinks: true }), pathExistsStrict(targets.sidecarPath, { followLinks: true })]);
  const state = jsonl && sidecar ? "present" : jsonl || sidecar ? "partial" : "absent";
  return { jsonl, sidecar, state };
}

export interface DeleteStorageOptions {
  targets: SessionStorageTargets;
  sessionId: string;
  sdkDelete?: ((sessionId: string, options: { dir: string }) => Promise<void>) | undefined;
}

/** Delete the SDK-owned transcript and exact sibling sidecar, then verify both. */
export async function deleteSdkSessionStorage(options: DeleteStorageOptions): Promise<SessionStorageState> {
  const sessionId = parseSdkSessionId(options.sessionId);
  const before = await inspectSessionStoragePresence(options.targets);
  if (before.state === "absent") return "absent";

  let sdkError: unknown;
  const jsonlExists = await pathExistsStrict(options.targets.jsonlPath, { followLinks: true });
  const jsonlSize = jsonlExists ? (await fs.stat(options.targets.jsonlPath)).size : 0;
  if (jsonlSize > 0) {
    try {
      // Dynamic — see `core/agent/stream.ts`: the Agent SDK is heavy, and a
      // session delete is a rare path that shouldn't put it in every `bbx`
      // invocation's startup graph.
      const sdkDelete = options.sdkDelete ?? (await import("@anthropic-ai/claude-agent-sdk")).deleteSession;
      await sdkDelete(sessionId, {
        dir: options.targets.cwd,
      });
    } catch (error) {
      sdkError = error;
    }
  }

  let after = await inspectSessionStorage(options.targets);
  if (sdkError !== undefined) {
    const afterPresence = await inspectSessionStoragePresence(options.targets);
    if (afterPresence.jsonl === before.jsonl && afterPresence.sidecar === before.sidecar) {
      throw sdkError instanceof Error ? sdkError : new SessionStorageUnchangedError();
    }
  }
  if (after === "present" && sdkError !== undefined) {
    throw sdkError instanceof Error ? sdkError : new SessionStorageUnchangedError();
  }
  if (after === "present" && jsonlSize > 0) {
    throw new SessionStorageUnchangedError();
  }
  if (after !== "absent") {
    // The SDK intentionally cannot address an orphan sidecar (or an empty
    // JSONL). Remove only these two already-validated exact targets.
    await fs.rm(options.targets.jsonlPath, { force: true });
    await fs.rm(options.targets.sidecarPath, { recursive: true, force: true });
    after = await inspectSessionStorage(options.targets);
  }
  return after;
}
