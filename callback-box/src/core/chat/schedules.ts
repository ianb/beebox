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
import { parseAttrs } from "../parse-attrs.js";
import * as path from "node:path";
import { z } from "zod";
import { parseDuration } from "../../schemas/scheduled-script.js";

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
});

export type ChatSchedule = z.infer<typeof chatScheduleSchema>;

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
    if (!fs.existsSync(filePath)) return;

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf-8");
    } catch (e) {
      log(`Failed to read schedules file, starting with no schedules: ${e}`);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      log(`Malformed chat-schedules.json (not JSON), starting with no schedules: ${e}`);
      return;
    }
    if (!Array.isArray(parsed)) {
      log("Malformed chat-schedules.json (expected an array), starting with no schedules");
      return;
    }

    let skipped = 0;
    for (const [index, entry] of parsed.entries()) {
      const result = chatScheduleSchema.safeParse(entry);
      if (!result.success) {
        const issues = result.error.issues.map((issue) => issue.message).join("; ");
        log(`Skipping invalid schedule (${describeEntry(entry, index)}): ${issues}`);
        skipped++;
        continue;
      }
      this.schedules.set(result.data.id, result.data);
    }

    const skippedNote = skipped > 0 ? ` (${skipped} invalid entr${skipped === 1 ? "y" : "ies"} skipped)` : "";
    log(`Loaded ${this.schedules.size} schedule(s) from disk${skippedNote}`);
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

