import { deleteSession as deleteSdkSession } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { errnoCode } from "../../../lib/error-guards.js";
import { encodeProjectDir } from "./transcript-paths.js";
import { parseSdkSessionId } from "./session-id.js";

export type SessionStorageState = "present" | "partial" | "absent";

export class LexicallyUnsafeSessionContextError extends Error {
  constructor() {
    super("Chat context directory escapes the box");
    this.name = "LexicallyUnsafeSessionContextError";
  }
}

export class ResolvedUnsafeSessionContextError extends Error {
  constructor() {
    super("Chat context directory resolves outside the box");
    this.name = "ResolvedUnsafeSessionContextError";
  }
}

export class SessionStorageUnchangedError extends Error {
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

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return false;
    throw error;
  }
}

function projectsRoot(): string {
  const callbackOverride = process.env["CB_CLAUDE_PROJECTS_DIR"];
  if (callbackOverride !== undefined) return callbackOverride;
  const claudeConfig = process.env["CLAUDE_CONFIG_DIR"];
  return path.join(claudeConfig ?? path.join(os.homedir(), ".claude"), "projects");
}

/** Resolve the exact SDK cwd and storage paths after box-containment checks. */
export async function resolveSessionStorageTargets(args: { boxRoot: string; contextDir?: string | undefined; sessionId: string }): Promise<SessionStorageTargets> {
  const sessionId = parseSdkSessionId(args.sessionId);
  const lexicalRoot = path.resolve(args.boxRoot);
  const lexicalCwd = path.resolve(lexicalRoot, args.contextDir ?? "");
  if (lexicalCwd !== lexicalRoot && !lexicalCwd.startsWith(`${lexicalRoot}${path.sep}`)) {
    throw new LexicallyUnsafeSessionContextError();
  }
  const [realRoot, realCwd] = await Promise.all([fs.realpath(lexicalRoot), fs.realpath(lexicalCwd)]);
  if (realCwd !== realRoot && !realCwd.startsWith(`${realRoot}${path.sep}`)) {
    throw new ResolvedUnsafeSessionContextError();
  }
  const projectDir = path.join(projectsRoot(), encodeProjectDir(realCwd));
  return {
    cwd: realCwd,
    jsonlPath: path.join(projectDir, `${sessionId}.jsonl`),
    sidecarPath: path.join(projectDir, sessionId),
  };
}

export async function inspectSessionStorage(targets: SessionStorageTargets): Promise<SessionStorageState> {
  return (await inspectSessionStoragePresence(targets)).state;
}

export async function inspectSessionStoragePresence(targets: SessionStorageTargets): Promise<SessionStoragePresence> {
  const [jsonl, sidecar] = await Promise.all([exists(targets.jsonlPath), exists(targets.sidecarPath)]);
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
  const jsonlExists = await exists(options.targets.jsonlPath);
  const jsonlSize = jsonlExists ? (await fs.stat(options.targets.jsonlPath)).size : 0;
  if (jsonlSize > 0) {
    try {
      await (options.sdkDelete ?? deleteSdkSession)(sessionId, {
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
