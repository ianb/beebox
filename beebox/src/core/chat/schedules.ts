/**
 * ChatScheduleManager — manages timed schedules created by the chat agent.
 *
 * The agent creates schedules via <schedule> tags in its responses.
 * When a schedule fires, the manager invokes a callback so the caller
 * can inject a message back into the chat session.
 *
 * Schedules persist in .beebox/chat-schedules.json (not in git)
 * and are re-armed on server restart.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

export { parseCancelScheduleTags, parseScheduleTags } from "./schedule-tags.js";

// Zod schema per entry, mirroring location-store.ts's pattern (Track D.6):
// the persisted shape is validated on load, an unparseable `firesAt` never
// reaches a `new Date(...).getTime()` call (which would silently produce
// `NaN` and fire the timer immediately — the bug this schema closes), and a
// corrupt entry is skipped with a named warning rather than crashing the
// whole load or silently vanishing.
const chatScheduleSchema = z.object({
  id: z.string(),
  label: z.string(),
  alarm: z.boolean(),
  announce: z.string().nullable(),
  content: z.string(),
  createdAt: z.string().datetime(),
  firesAt: z.string().datetime(),
  // Id of the chat session whose turn created this schedule, so the fire can
  // land back in the originating conversation. Optional: entries persisted
  // before this field existed lack it and stay valid (they fall back to the
  // most-active session when they fire). Also loaded hub-side via
  // `loadChatSchedules` — purely additive, so no hub change is needed.
  sessionId: z.string().optional(),
});

export type ChatSchedule = z.infer<typeof chatScheduleSchema>;

const liveManagers = new Set<ChatScheduleManager>();
let developmentDrainPaused = false;

export function pauseChatSchedulesForDevReload(): void {
  developmentDrainPaused = true;
  for (const manager of liveManagers) manager.pauseForDevReload();
}

export function resumeChatSchedulesAfterAbortedDevReload(): void {
  developmentDrainPaused = false;
  for (const manager of liveManagers) manager.resumeAfterAbortedDevReload();
}

export function allChatScheduleDeliveriesAreIdle(): boolean {
  return [...liveManagers].every((manager) => !manager.hasInFlightDeliveries());
}

export interface DetachedSchedulesReceipt {
  sessionId: string;
  schedules: ChatSchedule[];
}

class ScheduleForDeletingSessionError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super("Cannot schedule work for a conversation being deleted");
    this.name = "ScheduleForDeletingSessionError";
    this.sessionId = sessionId;
  }
}

/** Best-effort label for a schedule entry that failed validation, for the skip warning. */
function describeEntry(entry: unknown, index: number): string {
  if (typeof entry === "object" && entry !== null && "label" in entry && typeof entry.label === "string") {
    return entry.label;
  }
  return `entry #${index}`;
}

interface ScheduleCallbackParams {
  schedule: ChatSchedule;
}

type ScheduleCallback = (params: ScheduleCallbackParams) => void | Promise<void>;

const SCHEDULES_FILE = ".beebox/chat-schedules.json";

function log(...args: unknown[]): void {
  console.log("[ChatSchedules]", ...args);
}

/**
 * Load and validate the persisted chat schedules for a box, WITHOUT
 * constructing a manager or arming any timers. This is the single source of
 * truth for "what schedules does this box have on disk" — the
 * `ChatScheduleManager` re-arms exactly these entries on serve boot, and the
 * hub supervisor (`src/hub/pending-schedules.ts`) checks exactly these entries
 * to decide whether a lazy box must stay running. Sharing the loader means the
 * hub's notion of "pending" can never drift from what serve would re-arm.
 *
 * Semantics mirror serve's tolerance for a bad file: a missing/unreadable/
 * malformed file yields no schedules (serve would boot with none), and an
 * individual invalid entry is skipped with a named warning rather than
 * crashing the load. Returns ALL surviving entries, including overdue-unfired
 * ones — an overdue schedule still needs the box up to fire.
 */
export function loadChatSchedules({ boxRoot, schedulesFile }: { boxRoot: string; schedulesFile?: string | undefined }): ChatSchedule[] {
  const filePath = path.join(boxRoot, schedulesFile || SCHEDULES_FILE);
  if (!fs.existsSync(filePath)) return [];

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    log(`Failed to read schedules file, starting with no schedules: ${e}`);
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    log(`Malformed chat-schedules.json (not JSON), starting with no schedules: ${e}`);
    return [];
  }
  if (!Array.isArray(parsed)) {
    log("Malformed chat-schedules.json (expected an array), starting with no schedules");
    return [];
  }

  const schedules: ChatSchedule[] = [];
  for (const [index, entry] of parsed.entries()) {
    const result = chatScheduleSchema.safeParse(entry);
    if (!result.success) {
      const issues = result.error.issues.map((issue) => issue.message).join("; ");
      log(`Skipping invalid schedule (${describeEntry(entry, index)}): ${issues}`);
      continue;
    }
    schedules.push(result.data);
  }
  return schedules;
}

export class ChatScheduleManager {
  private boxRoot: string;
  private schedulesFile: string;
  private schedules: Map<string, ChatSchedule> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private onFire: ScheduleCallback;
  private idCounter = 0;
  private readonly blockedSessionIds = new Set<string>();
  private readonly generations = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(boxRoot: string, { onFire, schedulesFile }: { onFire: ScheduleCallback; schedulesFile?: string | undefined }) {
    this.boxRoot = boxRoot;
    this.schedulesFile = schedulesFile || SCHEDULES_FILE;
    this.onFire = onFire;
    this.loadFromDisk();
    liveManagers.add(this);
    if (!developmentDrainPaused) this.rearmAll();
  }

  addSchedule(opts: {
    label: string;
    alarm: boolean;
    announce: string | null;
    content: string;
    durationMs: number;
    /** Originating chat session id; omitted for callers that don't track one. */
    sessionId?: string;
  }): ChatSchedule {
    if (opts.sessionId !== undefined && this.blockedSessionIds.has(opts.sessionId)) {
      throw new ScheduleForDeletingSessionError(opts.sessionId);
    }
    const id = `sch_${Date.now()}_${this.idCounter++}`;
    const now = new Date();
    const firesAt = new Date(now.getTime() + opts.durationMs);

    const schedule: ChatSchedule = {
      id,
      label: opts.label,
      alarm: opts.alarm,
      announce: opts.announce,
      content: opts.content,
      createdAt: now.toISOString(),
      firesAt: firesAt.toISOString(),
      ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
    };

    this.schedules.set(id, schedule);
    if (!developmentDrainPaused) this.armTimer(schedule);
    this.saveToDisk();

    log(`Scheduled "${schedule.label}" to fire at ${schedule.firesAt} (in ${Math.round(opts.durationMs / 1000)}s)`);
    return schedule;
  }

  /** Prevent linked timers and newly emitted tags from delivering during deletion. */
  blockForDeletion(sessionId: string): void {
    this.blockedSessionIds.add(sessionId);
  }

  /** Remove every armed or firing schedule linked to one session in one persisted write. */
  async detachForSession(sessionId: string): Promise<DetachedSchedulesReceipt> {
    const schedules = [...this.schedules.values()].filter((schedule) => schedule.sessionId === sessionId);
    for (const schedule of schedules) {
      this.clearTimer(schedule.id);
      this.generations.set(schedule.id, (this.generations.get(schedule.id) ?? 0) + 1);
      this.schedules.delete(schedule.id);
    }
    this.saveToDisk();
    const deliveries = schedules.map((schedule) => this.inFlight.get(schedule.id)).filter((delivery): delivery is Promise<void> => delivery !== undefined);
    await Promise.allSettled(deliveries);
    return { sessionId, schedules };
  }

  /** Restore exactly a prior detach receipt after a compensated deletion failure. */
  restoreDetachedSchedules(receipt: DetachedSchedulesReceipt): void {
    for (const schedule of receipt.schedules) {
      if (this.schedules.has(schedule.id)) continue;
      this.schedules.set(schedule.id, schedule);
      this.armTimer(schedule);
    }
    this.blockedSessionIds.delete(receipt.sessionId);
    this.saveToDisk();
  }

  /** Leave schedules detached but release the temporary delivery block. */
  finishDeletion(sessionId: string): void {
    this.blockedSessionIds.delete(sessionId);
  }

  isBlockedForDeletion(sessionId: string): boolean {
    return this.blockedSessionIds.has(sessionId);
  }

  cancelByLabel(label: string): boolean {
    for (const [id, schedule] of this.schedules) {
      if (schedule.label === label) {
        this.clearTimer(id);
        this.schedules.delete(id);
        this.saveToDisk();
        log(`Cancelled schedule "${label}"`);
        return true;
      }
    }
    return false;
  }

  getActive(): ChatSchedule[] {
    const now = Date.now();
    return [...this.schedules.values()].filter((s) => new Date(s.firesAt).getTime() > now);
  }

  hasInFlightDeliveries(): boolean {
    return this.inFlight.size > 0;
  }

  pauseForDevReload(): void {
    this.stopAll();
  }

  resumeAfterAbortedDevReload(): void {
    this.rearmAll();
  }

  /**
   * Format active schedules for injection into user messages.
   * Returns null if no active schedules.
   */
  formatPendingForPrompt(): string | null {
    const active = this.getActive();
    if (active.length === 0) return null;

    const now = Date.now();
    const lines = active.map((s) => {
      const remainMs = new Date(s.firesAt).getTime() - now;
      const remainMin = Math.max(1, Math.round(remainMs / 60000));
      const timeStr = remainMin >= 60 ? `${Math.floor(remainMin / 60)}h${remainMin % 60 > 0 ? `${remainMin % 60}m` : ""}` : `${remainMin}m`;
      return `- "${s.label}" fires in ${timeStr}${s.alarm ? " (alarm)" : ""}`;
    });

    return `Active schedules:\n${lines.join("\n")}`;
  }

  stopAll(): void {
    for (const id of this.timers.keys()) {
      this.clearTimer(id);
    }
  }

  private armTimer(schedule: ChatSchedule): void {
    const delay = new Date(schedule.firesAt).getTime() - Date.now();
    if (delay <= 0) {
      // Already past — fire immediately
      this.startFire(schedule);
      return;
    }

    const timer = setTimeout(() => {
      this.startFire(schedule);
    }, delay);

    // Don't keep process alive just for schedules
    timer.unref();

    this.timers.set(schedule.id, timer);
  }

  private startFire(schedule: ChatSchedule): void {
    const delivery = this.fireSchedule(schedule);
    this.inFlight.set(schedule.id, delivery);
    void delivery.finally(() => {
      if (this.inFlight.get(schedule.id) === delivery) this.inFlight.delete(schedule.id);
    });
  }

  private async fireSchedule(schedule: ChatSchedule): Promise<void> {
    log(`Firing schedule "${schedule.label}"`);
    this.timers.delete(schedule.id);
    const generation = (this.generations.get(schedule.id) ?? 0) + 1;
    this.generations.set(schedule.id, generation);
    try {
      if (schedule.sessionId === undefined || !this.blockedSessionIds.has(schedule.sessionId)) {
        await this.onFire({ schedule });
      }
    } catch (error) {
      console.error(`[ChatSchedules] onFire failed for "${schedule.label}":`, error);
    } finally {
      // A detach/restore advances the generation. Its late callback must not
      // consume the restored timer.
      if (this.generations.get(schedule.id) === generation) {
        this.schedules.delete(schedule.id);
        this.saveToDisk();
      }
    }
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  private rearmAll(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [id, schedule] of this.schedules) {
      const fireTime = new Date(schedule.firesAt).getTime();
      if (fireTime <= now) {
        // Fire immediately — missed during downtime
        expired.push(id);
      } else {
        this.armTimer(schedule);
      }
    }

    // Fire expired schedules after a short delay to let the system settle
    if (expired.length > 0) {
      setTimeout(() => {
        for (const id of expired) {
          const schedule = this.schedules.get(id);
          if (schedule) {
            this.startFire(schedule);
          }
        }
      }, 2000);
    }
  }

  private loadFromDisk(): void {
    const loaded = loadChatSchedules({
      boxRoot: this.boxRoot,
      schedulesFile: this.schedulesFile,
    });
    for (const schedule of loaded) this.schedules.set(schedule.id, schedule);
    if (loaded.length > 0) log(`Loaded ${loaded.length} schedule(s) from disk`);
  }

  private saveToDisk(): void {
    const filePath = path.join(this.boxRoot, this.schedulesFile);
    const dir = path.dirname(filePath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify([...this.schedules.values()], null, 2));
    } catch (e) {
      log(`Failed to save schedules: ${e}`);
    }
  }
}
