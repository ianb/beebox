import { acquireBoxWork } from "../../../lib/box-maintenance/admission.js";
import { BoxMaintenanceError } from "../../../lib/box-maintenance-error.js";
/**
 * ChatScheduleManager — manages timed schedules created by the chat agent.
 *
 * The agent sets check-ins with `bbx remind --here` (the `chat.addCheckIn`
 * procedure) or, from older habits, a `<schedule>` tag in its response.
 * When a schedule fires, the manager invokes a callback so the caller
 * can inject a message back into the chat session.
 *
 * Schedules persist in .beebox/chat-schedules.json (not in git)
 * and are re-armed on server restart.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getBoxTime } from "../../../lib/time.js";
import { type ChatSchedule, loadChatSchedules, log, SCHEDULES_FILE } from "./store.js";
import { ClockWatch } from "./clock-watch.js";
import { CHECK_IN_MAX_MS, CheckInNotSavedError, CheckInTooLongError, MAX_TIMEOUT_MS, ScheduleForDeletingSessionError } from "./check-in.js";
import { formatDuration } from "../../../shared/relative-time.js";

export { parseCancelScheduleTags, parseScheduleTags } from "./tags.js";
export { loadChatSchedules, type ChatSchedule } from "./store.js";
export { CHECK_IN_MAX_MS, CheckInNotSavedError, CheckInTooLongError, ScheduleForDeletingSessionError } from "./check-in.js";

const liveManagers = new Set<ChatScheduleManager>();
export function pauseBoxChatSchedules(boxRoot: string): void { for (const manager of liveManagers) if (manager.boxRoot === boxRoot) manager.pauseForMaintenance(); }
export function resumeBoxChatSchedules(boxRoot: string): void { for (const manager of liveManagers) if (manager.boxRoot === boxRoot) manager.resumeAfterMaintenance(); }
export function boxChatScheduleDeliveriesAreIdle(boxRoot: string): boolean { return [...liveManagers].filter((manager) => manager.boxRoot === boxRoot).every((manager) => !manager.hasInFlightDeliveries()); }

export interface DetachedSchedulesReceipt {
  sessionId: string;
  schedules: ChatSchedule[];
}

interface ScheduleCallbackParams {
  schedule: ChatSchedule;
}

type ScheduleCallback = (params: ScheduleCallbackParams) => void | Promise<void>;

/** How often a walk fixture's clock offset file is polled while timers are armed. */
const CLOCK_WATCH_INTERVAL_MS = 5000;

export class ChatScheduleManager {
  readonly boxRoot: string;
  private schedulesFile: string;
  private schedules: Map<string, ChatSchedule> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private onFire: ScheduleCallback;
  private idCounter = 0;
  private maintenancePaused = false;
  private readonly blockedSessionIds = new Set<string>();
  private readonly generations = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly clockWatch: ClockWatch;

  constructor(boxRoot: string, { onFire, schedulesFile, clockWatchIntervalMs }: { onFire: ScheduleCallback; schedulesFile?: string | undefined; clockWatchIntervalMs?: number | undefined }) {
    this.boxRoot = boxRoot;
    this.clockWatch = new ClockWatch(boxRoot, { intervalMs: clockWatchIntervalMs ?? CLOCK_WATCH_INTERVAL_MS, hasTimers: () => this.timers.size > 0, onChange: () => { this.rearmForClockChange(); } });
    this.schedulesFile = schedulesFile || SCHEDULES_FILE;
    this.onFire = onFire;
    this.loadFromDisk();
    liveManagers.add(this);
    if (!this.maintenancePaused) this.rearmAll();
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
    if (opts.durationMs > CHECK_IN_MAX_MS) throw new CheckInTooLongError(opts.durationMs);
    liveManagers.add(this);
    const id = `sch_${Date.now()}_${this.idCounter++}`;
    const now = getBoxTime(this.boxRoot);
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

    // Saved before it is armed: a check-in reported as set must survive a restart.
    this.schedules.set(id, schedule);
    try { this.writeToDisk(); } catch (error) {
      this.schedules.delete(id);
      throw new CheckInNotSavedError(error);
    }
    this.armTimer(schedule);

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

  /** Cancel the first schedule with `label`; with `sessionId`, only that conversation's. */
  cancelByLabel(label: string, options?: { sessionId: string }): boolean {
    for (const [id, schedule] of this.schedules) {
      if (schedule.label === label && (options === undefined || schedule.sessionId === options.sessionId)) {
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
    const now = getBoxTime(this.boxRoot).getTime();
    return [...this.schedules.values()].filter((s) => new Date(s.firesAt).getTime() > now);
  }

  hasInFlightDeliveries(): boolean {
    return this.inFlight.size > 0;
  }

  pauseForMaintenance(): void {
    this.maintenancePaused = true;
    for (const id of this.timers.keys()) this.clearTimer(id);
  }

  resumeAfterMaintenance(): void {
    if (!this.maintenancePaused) return;
    this.maintenancePaused = false;
    for (const schedule of this.schedules.values()) this.armTimer(schedule);
  }

  /**
   * Format active schedules for injection into user messages.
   * Returns null if no active schedules.
   */
  formatPendingForPrompt(): string | null {
    const active = this.getActive();
    if (active.length === 0) return null;

    const now = getBoxTime(this.boxRoot).getTime();
    const lines = active.map((s) => {
      const remainMs = new Date(s.firesAt).getTime() - now;
      // Whole minutes, at least one: a check-in that is due but still active reads "fires in 1m".
      const timeStr = formatDuration(Math.max(1, Math.round(remainMs / 60_000)) * 60_000);
      return `- "${s.label}" fires in ${timeStr}${s.alarm ? " (alarm)" : ""}`;
    });

    return `Active check-ins:\n${lines.join("\n")}`;
  }

  stopAll(): void {
    liveManagers.delete(this);
    for (const id of this.timers.keys()) {
      this.clearTimer(id);
    }
    this.clockWatch.sync();
  }

  private armTimer(schedule: ChatSchedule): void {
    if (this.maintenancePaused || this.timers.has(schedule.id) || this.inFlight.has(schedule.id)) return;
    const delay = new Date(schedule.firesAt).getTime() - getBoxTime(this.boxRoot).getTime();
    if (delay <= 0) {
      // Already past — fire immediately
      this.startFire(schedule);
      return;
    }

    // An entry saved before CHECK_IN_MAX_MS can exceed Node's timer limit:
    // wait out the limit, then arm again.
    const timer = delay > MAX_TIMEOUT_MS
      ? setTimeout(() => { this.timers.delete(schedule.id); this.armTimer(schedule); this.clockWatch.sync(); }, MAX_TIMEOUT_MS)
      : setTimeout(() => { this.startFire(schedule); }, delay);

    // Don't keep process alive just for schedules
    timer.unref();

    this.timers.set(schedule.id, timer);
    this.clockWatch.sync();
  }

  /** The offset file changed: re-arm every timer against the new box time. */
  private rearmForClockChange(): void {
    if (this.maintenancePaused) return;
    log("Box clock offset changed; re-arming timers");
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const schedule of this.schedules.values()) this.armTimer(schedule);
    this.clockWatch.sync();
  }

  private startFire(schedule: ChatSchedule): void {
    if (this.maintenancePaused || this.inFlight.has(schedule.id)) return;
    const delivery = this.fireSchedule(schedule);
    this.inFlight.set(schedule.id, delivery);
    void delivery.finally(() => {
      if (this.inFlight.get(schedule.id) === delivery) this.inFlight.delete(schedule.id);
    }).catch((error: unknown) => console.error("[ChatSchedules] Delivery failed:", error));
  }

  private async fireSchedule(schedule: ChatSchedule): Promise<void> {
    // Timers are new root work even when armed under startup/agent context.
    let work;
    try { work = await acquireBoxWork(this.boxRoot, { reason: `chat schedule ${schedule.id}`, inherited: null }); }
    catch (error) {
      if (error instanceof BoxMaintenanceError) { this.pauseForMaintenance(); return; }
      throw error;
    }
    try { await work.run(async () => {
    log(`Firing schedule "${schedule.label}"`);
    this.timers.delete(schedule.id);
    this.clockWatch.sync();
    const generation = (this.generations.get(schedule.id) ?? 0) + 1;
    this.generations.set(schedule.id, generation);
    try {
      if (schedule.sessionId === undefined || !this.blockedSessionIds.has(schedule.sessionId)) {
        await this.onFire({ schedule });
      }
    } catch (error) {
      if (error instanceof BoxMaintenanceError) {
        this.generations.set(schedule.id, generation + 1);
        this.pauseForMaintenance();
        return;
      }
      console.error(`[ChatSchedules] onFire failed for "${schedule.label}":`, error);
    } finally {
      // A detach/restore advances the generation. Its late callback must not
      // consume the restored timer.
      if (this.generations.get(schedule.id) === generation) {
        this.schedules.delete(schedule.id);
        this.saveToDisk();
      }
    }
      });
    } finally { await work.release(); }
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
      this.clockWatch.sync();
    }
  }

  /** Whether the clock offset file is being polled (only while timers are armed on a walk fixture). */
  isWatchingClock(): boolean {
    return this.clockWatch.isWatching();
  }

  private rearmAll(): void {
    if (this.maintenancePaused) return;
    const now = getBoxTime(this.boxRoot).getTime();
    for (const [id, schedule] of this.schedules) {
      if (new Date(schedule.firesAt).getTime() > now) { this.armTimer(schedule); continue; }
      // Preserve startup settling time, but make these timers cancellable too.
      const timer = setTimeout(() => {
        this.timers.delete(id);
        this.clockWatch.sync();
        if (this.schedules.has(id)) this.startFire(schedule);
      }, 2000);
      timer.unref();
      this.timers.set(id, timer);
    }
    this.clockWatch.sync();
  }

  private loadFromDisk(): void {
    const loaded = loadChatSchedules({
      boxRoot: this.boxRoot,
      schedulesFile: this.schedulesFile,
    });
    for (const schedule of loaded) this.schedules.set(schedule.id, schedule);
    if (loaded.length > 0) log(`Loaded ${loaded.length} schedule(s) from disk`);
  }

  private writeToDisk(): void {
    const filePath = path.join(this.boxRoot, this.schedulesFile);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify([...this.schedules.values()], null, 2));
  }

  private saveToDisk(): void {
    try {
      this.writeToDisk();
    } catch (e) {
      log(`Failed to save schedules: ${e}`);
    }
  }
}
