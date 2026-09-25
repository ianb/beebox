/**
 * Chat-feature flag state for a ChatSession.
 *
 * Owns the lazy-loaded, in-memory feature map and the persistence + change
 * notification around it, so `chat-session.ts` can delegate rather than
 * carry the bookkeeping inline. The session id can change over the life of
 * a session (assigned on first SDK message), so it's read through a getter
 * rather than captured.
 */

import { makeLog } from "./log.js";
import {
  getFeaturesForSession,
  updateFeaturesForSession,
} from "./history.js";
import { resolveRecordedChatEngine } from "./engine.js";
import {
  isKnownFeature,
  isValidValue,
  parseChatAppDeltas,
  resolveFeatures,
  type FeatureMap,
} from "../features.js";

class UnknownFeatureError extends Error {
  constructor(feature: string) {
    super(`Unknown feature: ${feature}`);
    this.name = "UnknownFeatureError";
  }
}

class InvalidFeatureValueError extends Error {
  constructor(feature: string, value: string) {
    super(`Invalid value for ${feature}: ${value}`);
    this.name = "InvalidFeatureValueError";
  }
}

const log = makeLog("ChatSession");

interface FeatureStoreDeps {
  boxRoot: string;
  /** Reads the live session id, which may be assigned after construction. */
  getSessionId: () => string | null;
  /** Landmark seed defaults for a fresh session, if any. */
  seedFeatures?: Record<string, string> | undefined;
  persistPending?: ((updates: Record<string, string>) => boolean) | undefined;
  /** Notifies the owner that the feature map changed (carries the new map). */
  onChange: (features: FeatureMap) => void;
}

export class FeatureStore {
  /** Resolved feature map; null until the lazy load completes. */
  private current: FeatureMap | null = null;
  private loadPromise: Promise<void> | null = null;
  private readonly deps: FeatureStoreDeps;

  constructor(deps: FeatureStoreDeps) {
    this.deps = deps;
  }

  /**
   * Lazy-load the persisted feature map from chat-session-history. Idempotent:
   * once loaded, the in-memory map is the source of truth and subsequent calls
   * are no-ops. Concurrent callers share the load promise.
   */
  async ensureLoaded(): Promise<void> {
    if (this.current !== null) return;
    if (this.loadPromise !== null) {
      await this.loadPromise;
      return;
    }
    this.loadPromise = (async () => {
      let stored: Record<string, string> | null = null;
      const sessionId = this.deps.getSessionId();
      if (sessionId !== null) {
        try {
          stored = await getFeaturesForSession(this.deps.boxRoot, sessionId);
        } catch (e) {
          log("features", `Failed to load features: ${e instanceof Error ? e.message : e}`);
        }
      }
      // Stored (persisted) state wins. If none, fall back to a seed (landmark
      // default for new sessions). If neither, registry defaults via
      // resolveFeatures.
      this.current = resolveFeatures(stored ?? this.deps.seedFeatures);
    })();
    await this.loadPromise;
  }

  /** Feature map for the per-turn snapshot — defaults until the load completes. */
  snapshot(): FeatureMap {
    return this.current ?? resolveFeatures();
  }

  /** Current feature map with defaults applied. Safe to call before features
   *  are loaded — returns pure defaults until the lazy load completes. */
  get(): FeatureMap {
    return resolveFeatures(this.current ?? undefined);
  }

  private async persist(updates: Record<string, string>): Promise<void> {
    const sessionId = this.deps.getSessionId();
    if (sessionId === null) return;
    if (this.deps.persistPending?.(updates) === true) return;

    // Persisting features can CREATE the session's history entry, and creating
    // it WRITES the session's engine — so this needs an engine it actually
    // knows, never the box default. The box default here is how a chat reserved
    // as `claude` on a codex-default box got recorded as `codex` on its first
    // toggle, permanently, since a history row outranks a reservation.
    //
    // A healthy session always has one: `recordSessionStart` writes its history
    // row when the run starts, so the create branch below is only ever reached
    // for a session whose records are gone.
    const engine = await resolveRecordedChatEngine(this.deps.boxRoot, { sessionId });

    // Nothing recorded this session's engine: an id the box has no record of.
    // Creating a row for it would invent the engine —
    // the defect above, one layer up — and the row would then outrank the real
    // answer if the session's records ever came back. The flags stay in memory
    // for this session rather than being written under a guess.
    if (engine === null) {
      log("features", `No recorded engine for ${sessionId}; keeping features in memory rather than recording a guess`);
      return;
    }
    await updateFeaturesForSession(this.deps.boxRoot, { sessionId, updates, engine });
  }

  /**
   * Set a single feature. Validates against the registry; throws for unknown
   * features or illegal values. Persists to session history if a session id
   * has been assigned. Emits `features-changed` via `onChange`.
   */
  async set(name: string, value: string): Promise<void> {
    if (!isKnownFeature(name)) throw new UnknownFeatureError(name);
    if (!isValidValue(name, value)) throw new InvalidFeatureValueError(name, value);
    await this.ensureLoaded();
    if (this.current === null) this.current = resolveFeatures();
    if (this.current[name] === value) return; // no-op
    this.current[name] = value;
    await this.persist({ [name]: value });
    log("features", `setFeature ${name}=${value}`);
    this.deps.onChange(this.get());
  }

  /**
   * Apply a batch of agent-emitted `<chat-app>` deltas. Same persistence and
   * event path as `set`. Caller has already validated entries against the
   * registry (parseChatAppDeltas drops unknowns).
   */
  async applyDeltas(
    deltas: Array<{ feature: string; value: string }>,
  ): Promise<void> {
    if (deltas.length === 0) return;
    await this.ensureLoaded();
    if (this.current === null) this.current = resolveFeatures();
    const updates: Record<string, string> = {};
    for (const d of deltas) {
      if (this.current[d.feature] === d.value) continue;
      this.current[d.feature] = d.value;
      updates[d.feature] = d.value;
    }
    if (Object.keys(updates).length === 0) return;
    await this.persist(updates);
    log("features", `applied agent deltas: ${JSON.stringify(updates)}`);
    this.deps.onChange(this.get());
  }
}

/**
 * Parse `<chat-app>` mutation tags out of a completed turn's text and apply
 * them to the feature store. Fire-and-forget: failures are logged, never
 * thrown, since this runs off the turn-completion path. No-op when the text
 * carries no deltas.
 */
export function applyAgentTurnDeltas(features: FeatureStore, completedText: string): void {
  const { deltas } = parseChatAppDeltas(completedText);
  if (deltas.length === 0) return;
  void features.applyDeltas(deltas).catch((e: unknown) => {
    log("features", `Failed to apply agent deltas: ${e instanceof Error ? e.message : e}`);
  });
}
