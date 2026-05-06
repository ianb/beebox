/**
 * Runtime helpers the framework uses to compose activities with chat:
 * mode resolution, availability checks, MCP config composition, and
 * session bookkeeping.
 *
 * These are pure(-ish) helpers. Actual chat subprocess spawning lives
 * in the chat layer and calls into here.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Activity } from "./Activity.js";
import type { ActivityInstance } from "./ActivityInstance.js";
import type { ActivityMode } from "./ActivityMode.js";
import type { MCPServerConfig } from "./types.js";

/** Env vars passed to the mode's MCP server subprocess. */
export const CB_ACTIVITY_NAME = "CB_ACTIVITY_NAME";
export const CB_ACTIVITY_ROOT = "CB_ACTIVITY_ROOT";
export const CB_ACTIVITY_MODE = "CB_ACTIVITY_MODE";

export class UnknownModeError extends Error {
  constructor(public readonly activityType: string, public readonly modeName: string) {
    super(`Unknown mode: ${activityType}/${modeName}`);
    this.name = "UnknownModeError";
  }
}

export interface AvailableMode {
  name: string;
  isDefault: boolean;
}

export interface SessionRecord {
  sessionId: string;
  mode: string;
  createdAt: string;
}

/** Construct a mode bound to the given instance. Throws if the name is unknown. */
export function resolveMode({
  activity,
  modeName,
  instance,
}: {
  activity: Activity;
  modeName: string;
  instance: ActivityInstance;
}): ActivityMode {
  const ModeClass = activity.modes[modeName];
  if (ModeClass === undefined) throw new UnknownModeError(activity.type, modeName);
  return new ModeClass(instance);
}

/**
 * Return the list of modes whose `available()` returns true, in declaration
 * order. `isDefault` is copied from each mode's class field.
 */
export async function getAvailableModes(
  activity: Activity,
  instance: ActivityInstance,
): Promise<AvailableMode[]> {
  const results: AvailableMode[] = [];
  for (const [name, ModeClass] of Object.entries(activity.modes)) {
    const mode = new ModeClass(instance);
    if (await mode.available()) {
      results.push({ name, isDefault: mode.isDefault });
    }
  }
  return results;
}

/**
 * Pick the default mode for an instance: the first available mode marked
 * `isDefault`, or the first available mode otherwise. Returns null if no
 * modes are available (pathological — activities should always have at
 * least one always-available mode like `setup`).
 */
export async function pickDefaultMode(
  activity: Activity,
  instance: ActivityInstance,
): Promise<string | null> {
  const available = await getAvailableModes(activity, instance);
  const first = available[0];
  if (first === undefined) return null;
  const explicit = available.find((m) => m.isDefault);
  return (explicit ?? first).name;
}

/**
 * Build the MCP server config for a mode, augmented with the three
 * `CB_ACTIVITY_*` env vars. Returns null if the mode declares no MCP
 * server.
 */
export function buildModeMcpConfig({
  mode,
}: {
  activity: Activity;
  mode: ActivityMode;
  modeName: string;
  instance: ActivityInstance;
}): MCPServerConfig | null {
  // The MCP server is in-process now: tools close over the instance
  // (set on the mode by `resolveMode`) directly. No env-var injection
  // needed — that was a subprocess concern. The `activity`, `modeName`,
  // and `instance` parameters are kept on the signature for backwards
  // compatibility with callers / tests that still pass them; the chat
  // layer separately injects CB_ACTIVITY_* into the Claude subprocess
  // env via `extraEnv` for any agent-side scripts that read them.
  return mode.mcpServer();
}

/**
 * Compose the full system prompt for a chat session in the given mode.
 * The base prompt is typically `CHAT_SYSTEM_PROMPT + tzContext`; the mode
 * prompt is appended after a blank line.
 */
export async function resolveSystemPrompt({
  basePrompt,
  mode,
}: {
  basePrompt: string;
  mode: ActivityMode;
}): Promise<string> {
  const modePrompt = await mode.systemPrompt();
  return `${basePrompt}\n\n${modePrompt}`;
}

const SESSIONS_DIR = ".callback-box/sessions";

function sessionFilePath(instanceRoot: string, sessionId: string): string {
  return join(instanceRoot, SESSIONS_DIR, `${sessionId}.json`);
}

/** Write a session record under `.callback-box/sessions/<sessionId>.json`. */
export async function recordSession({
  instanceRoot,
  sessionId,
  mode,
}: {
  instanceRoot: string;
  sessionId: string;
  mode: string;
}): Promise<SessionRecord> {
  const record: SessionRecord = {
    sessionId,
    mode,
    createdAt: new Date().toISOString(),
  };
  const file = sessionFilePath(instanceRoot, sessionId);
  await mkdir(join(instanceRoot, SESSIONS_DIR), { recursive: true });
  await writeFile(file, JSON.stringify(record, null, 2) + "\n");
  return record;
}

/**
 * List session records for an instance. Pass `modeName` to filter to a
 * single mode; omit to get all sessions.
 */
export async function listSessions({
  instanceRoot,
  modeName,
}: {
  instanceRoot: string;
  modeName?: string;
}): Promise<SessionRecord[]> {
  const dir = join(instanceRoot, SESSIONS_DIR);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const records: SessionRecord[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const raw = await readFile(join(dir, name), "utf-8");
    const rec = JSON.parse(raw) as SessionRecord;
    if (modeName === undefined || rec.mode === modeName) records.push(rec);
  }
  records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return records;
}

/**
 * Options bag the chat layer consumes when starting a chat session bound to
 * `(activity, mode, instance)`. `ChatSession` will accept this shape in a
 * follow-up and use each field to override its defaults. Kept as a plain
 * object so the chat layer owns subprocess spawning concerns; this module
 * just composes the ingredients.
 */
export interface ActivityChatSessionOptions {
  /** Final system prompt — base + mode prompt, resolved once. */
  systemPrompt: string;
  /** MCP server config with CB_ACTIVITY_* env vars injected. Null if the mode has no tools. */
  mcpConfig: MCPServerConfig | null;
  /**
   * Path (relative to `boxRoot`) where the current-session-id pointer for
   * this `(instance, mode)` is stored. The chat layer reads it on construct
   * to resume, writes it when Claude assigns a new session ID.
   */
  sessionFile: string;
  /** Env vars for the Claude subprocess itself (not the MCP subprocess). */
  extraEnv: Record<string, string>;
  /** Called once per new session ID — records a per-session bookkeeping file. */
  onSessionIdAssigned: (sessionId: string) => Promise<void>;
}

/**
 * Compose the options bag a chat session needs to run as `(activity, mode, instance)`.
 *
 * This is pure composition over the other helpers in this module; the
 * returned object is handed to the chat layer which owns subprocess
 * spawning. Keeping the factory here means the chat layer stays unaware
 * of activity internals — it just takes an options bag.
 */
export async function buildActivityChatSessionOptions({
  activity,
  modeName,
  instance,
  boxRoot,
  basePrompt,
}: {
  activity: Activity;
  modeName: string;
  instance: ActivityInstance;
  boxRoot: string;
  basePrompt: string;
}): Promise<ActivityChatSessionOptions> {
  const mode = resolveMode({ activity, modeName, instance });
  const systemPrompt = await resolveSystemPrompt({ basePrompt, mode });
  const mcpConfig = buildModeMcpConfig({ activity, mode, modeName, instance });
  const sessionFile = relative(
    boxRoot,
    join(instance.root, ".callback-box", `current-session-${modeName}.json`),
  );
  const extraEnv: Record<string, string> = {
    [CB_ACTIVITY_NAME]: activity.type,
    [CB_ACTIVITY_ROOT]: instance.root,
    [CB_ACTIVITY_MODE]: modeName,
  };
  const instanceRoot = instance.root;
  const onSessionIdAssigned = async (sessionId: string): Promise<void> => {
    await recordSession({ instanceRoot, sessionId, mode: modeName });
  };
  return { systemPrompt, mcpConfig, sessionFile, extraEnv, onSessionIdAssigned };
}
