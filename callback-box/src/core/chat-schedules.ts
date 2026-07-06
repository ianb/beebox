/**
 * ChatScheduleManager — manages timed schedules created by the chat agent.
 *
 * The agent creates schedules via <schedule> tags in its responses.
 * When a schedule fires, the manager invokes a callback so the caller
 * can inject a message back into the chat session.
 *
 * Schedules persist in .callback-box/chat-schedules.json (not in git)
 * and are re-armed on server restart.
 */

import * as fs from "node:fs";
import { parseAttrs } from "./parse-attrs.js";
import * as path from "node:path";
import { parseDuration } from "../schemas/scheduled-script.js";

export interface ChatSchedule {
  id: string;
  label: string;
  alarm: boolean;
  announce: string | null;
  content: string;
  createdAt: string;
  firesAt: string;
}

interface ScheduleCallbackParams {
  schedule: ChatSchedule;
}

type ScheduleCallback = (params: ScheduleCallbackParams) => void | Promise<void>;

const SCHEDULES_FILE = ".callback-box/chat-schedules.json";

function log(...args: unknown[]): void {
  console.log("[ChatSchedules]", ...args);
}

export class ChatScheduleManager {
  private boxRoot: string;
  private schedulesFile: string;
  private schedules: Map<string, ChatSchedule> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private onFire: ScheduleCallback;
  private idCounter = 0;

  constructor(boxRoot: string, { onFire, schedulesFile }: { onFire: ScheduleCallback; schedulesFile?: string | undefined }) {
    this.boxRoot = boxRoot;
    this.schedulesFile = schedulesFile || SCHEDULES_FILE;
    this.onFire = onFire;
    this.loadFromDisk();
    this.rearmAll();
  }

  addSchedule(opts: {
    label: string;
    alarm: boolean;
    announce: string | null;
    content: string;
    durationMs: number;
  }): ChatSchedule {
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
    };

    this.schedules.set(id, schedule);
    this.armTimer(schedule);
    this.saveToDisk();

    log(`Scheduled "${schedule.label}" to fire at ${schedule.firesAt} (in ${Math.round(opts.durationMs / 1000)}s)`);
    return schedule;
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
    return [...this.schedules.values()].filter(
      (s) => new Date(s.firesAt).getTime() > now
    );
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
      const timeStr = remainMin >= 60
        ? `${Math.floor(remainMin / 60)}h${remainMin % 60 > 0 ? `${remainMin % 60}m` : ""}`
        : `${remainMin}m`;
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
      this.fireSchedule(schedule);
      return;
    }

    const timer = setTimeout(() => {
      this.fireSchedule(schedule);
    }, delay);

    // Don't keep process alive just for schedules
    if (timer.unref) {
      timer.unref();
    }

    this.timers.set(schedule.id, timer);
  }

  private fireSchedule(schedule: ChatSchedule): void {
    log(`Firing schedule "${schedule.label}"`);
    this.timers.delete(schedule.id);
    this.schedules.delete(schedule.id);
    this.saveToDisk();
    // The timer callback can't await delivery; onFire may be async (it
    // injects the message into a live chat session), so log a rejection
    // instead of letting it become an unhandled rejection. The .then()
    // wrapper (rather than Promise.resolve(this.onFire(...))) also routes a
    // SYNCHRONOUS throw from a sync ScheduleCallback into the same catch.
    void Promise.resolve()
      .then(() => this.onFire({ schedule }))
      .catch((err: unknown) => {
        console.error(`[ChatSchedules] onFire failed for "${schedule.label}":`, err);
      });
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
            this.fireSchedule(schedule);
          }
        }
      }, 2000);
    }
  }

  private loadFromDisk(): void {
    const filePath = path.join(this.boxRoot, this.schedulesFile);
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as ChatSchedule[];
        for (const s of data) {
          this.schedules.set(s.id, s);
        }
        log(`Loaded ${data.length} schedule(s) from disk`);
      }
    } catch (e) {
      log(`Failed to load schedules: ${e}`);
    }
  }

  private saveToDisk(): void {
    const filePath = path.join(this.boxRoot, this.schedulesFile);
    const dir = path.dirname(filePath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        filePath,
        JSON.stringify([...this.schedules.values()], null, 2)
      );
    } catch (e) {
      log(`Failed to save schedules: ${e}`);
    }
  }
}

/**
 * Parse <schedule> tags from assistant response text.
 * Returns parsed schedule data for each tag found.
 */
export function parseScheduleTags(text: string): Array<{
  label: string;
  alarm: boolean;
  announce: string | null;
  content: string;
  durationMs: number;
}> {
  const results: Array<{
    label: string;
    alarm: boolean;
    announce: string | null;
    content: string;
    durationMs: number;
  }> = [];

  const regex = /<schedule\s+([^>]*)>([\S\s]*?)<\/schedule>/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const attrsStr = match[1] || "";
    const content = (match[2] || "").trim();

    const attrs = parseAttrs(attrsStr);
    const inAttr = attrs.in;
    if (!inAttr) {
      log("Skipping <schedule> tag without 'in' attribute");
      continue;
    }

    let durationMs: number;
    try {
      durationMs = parseDuration(inAttr);
    } catch (e) {
      log(`Invalid duration in <schedule>: ${e}`);
      continue;
    }

    results.push({
      label: attrs.label || "timer",
      alarm: attrs.alarm === "1",
      announce: attrs.announce || null,
      content,
      durationMs,
    });
  }

  return results;
}

/**
 * Parse <cancel-schedule> tags from assistant response text.
 */
export function parseCancelScheduleTags(text: string): string[] {
  const labels: string[] = [];
  const regex = /<cancel-schedule\s+([^/>]*)\/?\s*>/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const attrs = parseAttrs(match[1] || "");
    if (attrs.label) {
      labels.push(attrs.label);
    }
  }
  return labels;
}

