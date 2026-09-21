/**
 * Per-box configuration loader.
 *
 * Reads _config/box.json from each box root. Caches results.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { errnoCode } from "../../lib/error-guards.js";
import { isRecord } from "../../lib/is-record.js";
import { getBoxDir } from "../../lib/paths.js";
import { AGENT_ENGINES, modelTier, type AgentEngine } from "../../shared/agent-models.js";
import { normalizeModelId } from "../../shared/model-ids.js";
import { ADDED_MODEL_LABEL_MAX, isOpenRouterModelId, type AddedModel } from "../../shared/chat-models.js";
import type { PresentationConfig } from "../../shared/card-theme.js";

export type { AgentEngine } from "../../shared/agent-models.js";

export interface BoxConfig {
  /** Card and chrome presentation choices. Validated separately by the theme host. */
  presentation?: PresentationConfig;
  /** Box-wide default for HQ dictation in newly created chats. Missing means off. */
  hqDictation?: "on" | "off";
  /** Native agent harness used for new box jobs and chats. Missing means Claude. */
  agentEngine?: AgentEngine;
  /**
   * The box's pinned model — a concrete id from one engine's registry. Chats
   * that made no choice of their own follow it, and the reactor runs on it.
   * Missing means no policy: every run takes its harness's own default.
   */
  agentModel?: string;
  /**
   * The model the box's cheap structured passes use — chat review, retro
   * observation, triage. Missing means the `efficient` tier for whichever
   * engine the invocation runs on.
   */
  smallModel?: string;
  /**
   * OpenRouter models the owner added in admin. The only way one becomes
   * selectable: they bill per use, and holding an `openrouter` key enables
   * nothing for chat on its own (`docs/plans/openrouter-chat-models.md`).
   * Missing means none.
   */
  openrouterModels?: AddedModel[];
  /**
   * Which native harnesses this box may offer at all — a box with no Codex
   * subscription should not be offered Codex chats. Missing means only
   * {@link BoxConfig.agentEngine} is enabled, which is how every box behaved
   * before the field existed.
   */
  engines?: Partial<Record<AgentEngine, boolean>>;
  publicUrl?: string;
  allowedEmails?: string[];
  /** IANA timezone for this box (e.g. "America/Chicago"). Used in all agent prompts. */
  timezone?: string;
  /**
   * Which Google services this box is allowed to use.
   * If missing, no Google services are enabled (safe default).
   * Example: { calendar: true, gmail: false, drive: false }
   */
  googleServices?: Partial<Record<"calendar" | "gmail" | "drive", boolean>>;
  /**
   * Extra filesystem roots this box's commentary cards may resolve `file:`
   * hrefs under (the dev-only `/api/external` route — see
   * `core/external-ref.ts`). The box's own root is always allowed implicitly;
   * these are additional roots, e.g. a package source tree the box reviews.
   * Absolute paths, with leading `~` expanded to the home directory.
   */
  externalRoots?: string[];
  /**
   * Proactive scheduled-task health alerts (schedule-health-alert.ts).
   * Absent → no proactive alerts for this box (bbx health and the
   * session-start snapshot still surface problems). Explicit opt-in
   * because a misdirected alert is worse than no alert.
   */
  healthAlerts?: {
    /** Telegram chat id to send alerts to (the boxholder's DM chat). */
    telegramChat?: string;
  };
  /**
   * Agent browsing acts as the box owner. Set on boxes BUILT for agent-driven
   * testing (test1 and its clones); absent, the browse key clears the wall and
   * is nobody. A box a person actually uses must not set this.
   */
  agentBrowsing?: "owner";
}

/** Validated HQ-dictation default for newly created chats. */
export async function loadHqDictationDefault(boxRoot: string): Promise<"on" | "off"> {
  const value: unknown = (await loadBoxConfig(boxRoot)).hqDictation;
  if (value === undefined) return "off";
  if (value === "on" || value === "off") return value;
  console.warn(`[box-config] Ignoring invalid hqDictation value: ${JSON.stringify(value)}`);
  return "off";
}

class InvalidAgentEngineError extends Error {
  readonly value: unknown;

  constructor(value: unknown) {
    super("Box config agentEngine must be either claude or codex");
    this.name = "InvalidAgentEngineError";
    this.value = value;
  }
}

export type GoogleServiceName = "calendar" | "gmail" | "drive";

export type BoxConfigLoadResult =
  | { status: "absent" }
  | { status: "valid"; config: BoxConfig }
  | { status: "invalid"; error: string };

const cache = new Map<string, { result: BoxConfigLoadResult; mtime: number }>();

/** Config paths already complained about, so a bad file warns once, not per read. */
const warnedConfigPaths = new Set<string>();

function warnOnce(configPath: string, message: string): void {
  if (warnedConfigPaths.has(configPath)) return;
  warnedConfigPaths.add(configPath);
  console.warn(message);
}

/** Explicit invalidation after a same-process config mutation. */
export function clearBoxConfigCache(boxRoot: string): void {
  cache.delete(boxRoot);
}

/**
 * Check if a Google service is allowed for this box.
 * Returns false if googleServices is not configured or the service is not enabled.
 */
export async function isGoogleServiceAllowed(boxRoot: string, service: GoogleServiceName): Promise<boolean> {
  const config = await loadBoxConfig(boxRoot);
  return config.googleServices?.[service] === true;
}

/** True when `Intl.DateTimeFormat` accepts `timeZone` as a valid IANA zone — the only reliable way to validate one (no static zone list ships with Node). */
function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Load the box timezone (or null if not configured or malformed).
 *
 * A typo'd zone (e.g. `"America/Chciago"`) makes `Intl.DateTimeFormat`
 * throw `RangeError` the moment anything tries to use it — and every
 * plate-state/timezone-aware call site in the todo system (the collector,
 * `bbx query todos`, `collections.query`, the review sweep, session-context's ambient
 * timezone line) does exactly that. Validating HERE, at the one place the
 * raw config value enters the system, means a bad value degrades to the
 * host's own timezone (still wrong, but visibly so — via the warning below
 * — and non-fatal) instead of taking down every one of those call sites
 * with an uncaught `RangeError`. Per the resilient-not-silent boundary rule:
 * loud + degraded, never silent + crashed.
 */
export async function loadBoxTimezone(boxRoot: string): Promise<string | null> {
  const config = await loadBoxConfig(boxRoot);
  const timezone = config.timezone;
  if (timezone === undefined) return null;
  if (!isValidTimeZone(timezone)) {
    console.warn(
      `Box config timezone "${timezone}" is not a valid IANA timezone — falling back to the host timezone.`,
    );
    return null;
  }
  return timezone;
}

/** Load the selected native harness. Existing boxes default to Claude. */
export async function loadAgentEngine(boxRoot: string): Promise<AgentEngine> {
  const config = await loadBoxConfig(boxRoot);
  const engine: unknown = config.agentEngine;
  if (engine === undefined) return "claude";
  if (engine === "claude" || engine === "codex") return engine;
  throw new InvalidAgentEngineError(engine);
}

/**
 * Load the box's pinned model, or null when no policy is set.
 *
 * A hand-edited value that no engine offers is rejected here rather than
 * carried to a spawn boundary that would silently drop it: the warning fires
 * once per config load (the loader caches by mtime), and the box falls back to
 * the harness default instead of failing.
 */
export async function loadBoxModel(boxRoot: string): Promise<string | null> {
  return readConfiguredModel(boxRoot, "agentModel");
}

/**
 * Load the box's small-pass model, or null when unset. Null is not "no model"
 * here — the caller falls back to the `efficient` tier — but it is still the
 * honest answer to "did the boxholder choose one".
 */
export async function loadSmallModel(boxRoot: string): Promise<string | null> {
  return readConfiguredModel(boxRoot, "smallModel");
}

/**
 * Read one of the config's model fields, rejecting a value no engine offers.
 *
 * The rejection happens here rather than at a spawn boundary because that is
 * where it would go silent: `isChatModelAllowed` would drop the value and the
 * box would run a harness default while its config claimed otherwise. The
 * loader caches by mtime, so the warning fires once per config load.
 */
async function readConfiguredModel(
  boxRoot: string,
  field: "agentModel" | "smallModel",
): Promise<string | null> {
  const config = await loadBoxConfig(boxRoot);
  const model = config[field];
  if (model === undefined) return null;
  // An added OpenRouter model may be the box default, never the small-pass
  // model: cheap structured passes stay on a tier (boxholder, 2026-09-19).
  if (field === "agentModel" && typeof model === "string" && (await isConfigurableModel(boxRoot, model))) {
    return normalizeModelId(model);
  }
  if (typeof model !== "string" || modelTier(normalizeModelId(model)) === null) {
    console.warn(
      `Box config ${field} ${JSON.stringify(model)} is not a model any engine offers — ignoring it.`,
    );
    return null;
  }
  return normalizeModelId(model);
}

/**
 * Can this id be the box's default model? Any id with a tier, or an
 * OpenRouter model the owner added. The one rule behind both the config
 * loader and the admin write, so the two cannot disagree about what "Saved"
 * means.
 */
export async function isConfigurableModel(boxRoot: string, model: string): Promise<boolean> {
  if (modelTier(normalizeModelId(model)) !== null) return true;
  return (await loadAddedModels(boxRoot)).some((m) => m.id === model);
}

/**
 * The box's added OpenRouter models, in the owner's order. A malformed entry
 * is dropped with a warning rather than failing the whole list: a hand edit
 * that breaks one row should not take the others away. Duplicate ids keep the
 * first. A chat whose pick was dropped refuses at spawn, naming admin.
 */
export async function loadAddedModels(boxRoot: string): Promise<AddedModel[]> {
  const raw: unknown = (await loadBoxConfig(boxRoot)).openrouterModels;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    console.warn(`Box config openrouterModels must be a list — ignoring ${JSON.stringify(raw)}.`);
    return [];
  }
  const models: AddedModel[] = [];
  const entries: readonly unknown[] = raw;
  for (const entry of entries) {
    const parsed = parseAddedModel(entry);
    if (parsed === null) {
      console.warn(`Box config openrouterModels entry ${JSON.stringify(entry)} is not {id, label} with an OpenRouter id — ignoring it.`);
    } else if (!models.some((m) => m.id === parsed.id)) {
      models.push(parsed);
    }
  }
  return models;
}

/** One `{id, label}` entry, or null when it is not a valid added model. */
export function parseAddedModel(entry: unknown): AddedModel | null {
  if (!isRecord(entry)) return null;
  const { id, label } = entry;
  if (typeof id !== "string" || !isOpenRouterModelId(id)) return null;
  if (typeof label !== "string") return null;
  const trimmed = label.trim();
  if (trimmed === "" || trimmed.length > ADDED_MODEL_LABEL_MAX) return null;
  return { id, label: trimmed };
}

/**
 * The engines this box may offer, always including its default.
 *
 * Absent config means "just the default engine" rather than "both": a box that
 * has never said anything about Codex should not be offered it. The default
 * engine is always in the result even when the config disables it — a box whose
 * default engine is off cannot run, so that combination is a configuration
 * mistake to report, not a state to honor.
 */
export async function loadEnabledEngines(boxRoot: string): Promise<AgentEngine[]> {
  const config = await loadBoxConfig(boxRoot);
  const fallback = await loadAgentEngine(boxRoot);
  if (config.engines === undefined) return [fallback];
  if (config.engines[fallback] === false) {
    console.warn(
      `Box config disables its own default engine (${fallback}); treating it as enabled, since nothing could run otherwise.`,
    );
  }
  return AGENT_ENGINES.filter((engine) => engine === fallback || config.engines?.[engine] === true);
}

/**
 * Build a one-line timezone context string for agent prompts.
 * Returns empty string if no timezone is configured.
 */
export async function buildTimezoneContext(boxRoot: string): Promise<string> {
  const tz = await loadBoxTimezone(boxRoot);
  if (!tz) return "";
  return `\nTimezone: ${tz}`;
}

/**
 * Load box config from _config/box.json, with simple mtime-based caching.
 */
export async function loadBoxConfig(boxRoot: string): Promise<BoxConfig> {
  const result = await loadBoxConfigResult(boxRoot);
  return result.status === "valid" ? result.config : {};
}

/**
 * Read the shared box config once while preserving absence and read/parse
 * failure for consumers that must make configuration errors visible.
 */
export async function loadBoxConfigResult(boxRoot: string): Promise<BoxConfigLoadResult> {
  const configPath = path.join(getBoxDir(boxRoot, "config"), "box.json");

  let mtime: number;
  try {
    const stat = await fs.promises.stat(configPath);
    mtime = stat.mtimeMs;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return { status: "absent" };
    const code = errnoCode(e);
    const error = code === undefined
      ? "Could not inspect box config"
      : `Could not inspect box config (${code})`;
    console.warn(`No box config at ${configPath}, using defaults:`, e);
    return { status: "invalid", error };
  }

  const cached = cache.get(boxRoot);
  if (cached && cached.mtime === mtime) {
    return cached.result;
  }

  try {
    const raw = await fs.promises.readFile(configPath, "utf-8");
    // `JSON.parse` is a boundary: valid JSON that is not an object (`null`,
    // `[]`, `"x"`) would otherwise flow out typed as BoxConfig and throw on the
    // first field read. Treat it as no config, and say so once per path.
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      warnOnce(configPath, `Box config at ${configPath} is not a JSON object, using defaults.`);
      const result: BoxConfigLoadResult = {
        status: "invalid",
        error: "Box config must be a JSON object",
      };
      cache.set(boxRoot, { result, mtime });
      return result;
    }
    // eslint-disable-next-line no-restricted-syntax -- parse boundary: the guard above confirmed an object; each field is validated where it is read.
    const config = parsed as BoxConfig;
    const result: BoxConfigLoadResult = { status: "valid", config };
    cache.set(boxRoot, { result, mtime });
    return result;
  } catch (e) {
    const error = e instanceof SyntaxError
      ? `Could not parse box config: ${e.message}`
      : "Could not read box config";
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Could not read or parse box config at ${configPath}, using defaults:`, e);
    }
    const result: BoxConfigLoadResult = errnoCode(e) === "ENOENT"
      ? { status: "absent" }
      : { status: "invalid", error };
    cache.set(boxRoot, { result, mtime });
    return result;
  }
}
