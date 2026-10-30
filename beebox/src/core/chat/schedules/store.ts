import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

export const SCHEDULES_FILE = ".beebox/chat-schedules.json";

export function log(...args: unknown[]): void {
  console.log("[ChatSchedules]", ...args);
}

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

/** Best-effort label for a schedule entry that failed validation, for the skip warning. */
function describeEntry(entry: unknown, index: number): string {
  if (typeof entry === "object" && entry !== null && "label" in entry && typeof entry.label === "string") {
    return entry.label;
  }
  return `entry #${index}`;
}

/**
 * Load and validate the persisted chat schedules for a box, WITHOUT
 * constructing a manager or arming any timers. This is the single source of
 * truth for "what schedules does this box have on disk" — the
 * `ChatScheduleManager` re-arms exactly these entries on serve boot, and the
 * hub supervisor (`src/hub/supervisor/pending-schedules.ts`) checks exactly these entries
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

