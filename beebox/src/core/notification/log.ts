/**
 * The notification log: `.beebox/notifications.jsonl`, gitignored and
 * append-only, one JSON line per intent and per delivery. It is the record of
 * what the box tried to tell the person; the event bus is only the live signal.
 *
 * Write protocol. Three processes append (the server, the scheduler daemon,
 * `bbx`), so every line is one `O_APPEND` write of under 4 KB, which the
 * filesystems in use deliver atomically, and the file is never rewritten in
 * place. Rotation renames the file to `notifications.1.jsonl` (replacing the
 * previous one); a writer still holding the old descriptor lands its line in
 * the rotated file, which readers also read. See docs/plans/notifications.md
 * (Track A).
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../../lib/error-guards.js";
import { getBoxTime } from "../../lib/time.js";
import { formatTarget } from "./target.js";
import {
  logLineSchema,
  type Delivery,
  type DeliveryLine,
  type IntentLine,
  type LogLine,
  type NotificationIntent,
} from "./intent.js";

const LOG_FILE = "notifications.jsonl";
const ROTATED_FILE = "notifications.1.jsonl";
/** A line stays under the size the filesystem appends atomically. */
const MAX_LINE_BYTES = 4000;
const MAX_TITLE_CHARS = 200;
const MAX_DETAIL_CHARS = 500;
const ROTATE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ROTATE_BYTES = 8 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Thrown when a line cannot be appended to the log. */
export class NotificationLogWriteError extends Error {
  readonly logPath: string;
  constructor(logPath: string, options: { cause: unknown }) {
    super(`Could not append to the notification log ${logPath}`, options);
    this.name = "NotificationLogWriteError";
    this.logPath = logPath;
  }
}

export function notificationLogPath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", LOG_FILE);
}

function rotatedLogPath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", ROTATED_FILE);
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Serialize, shortening the body until the line fits one atomic append. */
function serialize(line: LogLine): string {
  let current = line;
  let text = JSON.stringify(current);
  while (Buffer.byteLength(text) >= MAX_LINE_BYTES && current.kind === "intent" && current.body.length > 0) {
    current = { ...current, body: clip(current.body, Math.floor(current.body.length * 0.75)) };
    text = JSON.stringify(current);
  }
  return `${text}\n`;
}

/** One `O_APPEND` open and one write per line; never a rewrite. */
function appendLine(boxRoot: string, line: LogLine): void {
  const logPath = notificationLogPath(boxRoot);
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const fd = fs.openSync(logPath, "a");
    try {
      fs.writeSync(fd, serialize(line));
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    throw new NotificationLogWriteError(logPath, { cause: e });
  }
}

export function appendIntent(boxRoot: string, opts: { intent: NotificationIntent; now: Date }): void {
  const { intent, now } = opts;
  appendLine(boxRoot, {
    kind: "intent",
    at: now.toISOString(),
    id: intent.id,
    title: clip(intent.title, MAX_TITLE_CHARS),
    body: intent.body,
    target: formatTarget(intent.target),
    loudness: intent.loudness,
    ...(intent.tag === undefined ? {} : { tag: intent.tag }),
    source: intent.source,
  });
}

export function appendDelivery(
  boxRoot: string,
  opts: { notificationId: string; delivery: Delivery; now: Date },
): void {
  const { notificationId, delivery, now } = opts;
  appendLine(boxRoot, {
    kind: "delivery",
    at: now.toISOString(),
    notificationId,
    channel: delivery.channel,
    status: delivery.status,
    ...(delivery.detail === undefined ? {} : { detail: clip(delivery.detail, MAX_DETAIL_CHARS) }),
  });
}

/** An intent with the deliveries logged for it, in log order. */
export interface LoggedNotification {
  intent: IntentLine;
  deliveries: DeliveryLine[];
}

async function readLines(filePath: string): Promise<LogLine[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(filePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
  const lines: LogLine[] = [];
  for (const text of raw.split("\n")) {
    if (text.trim() === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.warn(`[notification-log] skipping an unparseable line in ${filePath}:`, e);
      continue;
    }
    const parsed = logLineSchema.safeParse(json);
    if (parsed.success) lines.push(parsed.data);
    else console.warn(`[notification-log] skipping an invalid line in ${filePath}: ${parsed.error.message}`);
  }
  return lines;
}

/** Both files, oldest first, grouped by intent. */
async function readAll(boxRoot: string): Promise<LoggedNotification[]> {
  const lines = [
    ...(await readLines(rotatedLogPath(boxRoot))),
    ...(await readLines(notificationLogPath(boxRoot))),
  ];
  const byId = new Map<string, LoggedNotification>();
  for (const line of lines) {
    if (line.kind === "intent") byId.set(line.id, { intent: line, deliveries: [] });
    else byId.get(line.notificationId)?.deliveries.push(line);
  }
  return [...byId.values()];
}

/** Notifications whose intent was logged within the last `days` days. */
export async function readRecent(
  boxRoot: string,
  opts: { days: number; now?: Date | undefined },
): Promise<LoggedNotification[]> {
  const now = opts.now ?? getBoxTime(boxRoot);
  const since = now.getTime() - opts.days * DAY_MS;
  return (await readAll(boxRoot)).filter((n) => Date.parse(n.intent.at) >= since);
}

export async function getIntent(boxRoot: string, id: string): Promise<LoggedNotification | null> {
  return (await readAll(boxRoot)).find((n) => n.intent.id === id) ?? null;
}

/** The first line's timestamp, or null when the file is empty or its first line is unreadable. */
async function firstLineAt(filePath: string): Promise<number | null> {
  const handle = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(MAX_LINE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_LINE_BYTES, 0);
    const first = buffer.subarray(0, bytesRead).toString("utf-8").split("\n")[0] ?? "";
    const parsed = logLineSchema.safeParse(JSON.parse(first));
    return parsed.success ? Date.parse(parsed.data.at) : null;
  } catch (e) {
    console.warn(`[notification-log] could not read the first line of ${filePath}:`, e);
    return null;
  } finally {
    await handle.close();
  }
}

/**
 * Rename the log to `notifications.1.jsonl` when its first line is older than
 * 30 days or it exceeds 8 MB. The rename is atomic, so an appender racing it
 * lands in one file or the other, and readers read both.
 */
export async function rotateIfNeeded(boxRoot: string, opts: { now: Date }): Promise<boolean> {
  const logPath = notificationLogPath(boxRoot);
  let size: number;
  try {
    size = (await fsp.stat(logPath)).size;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return false;
    throw e;
  }
  if (size === 0) return false;
  const firstAt = size > ROTATE_BYTES ? null : await firstLineAt(logPath);
  const tooOld = firstAt !== null && opts.now.getTime() - firstAt > ROTATE_AGE_MS;
  if (size <= ROTATE_BYTES && !tooOld) return false;
  await fsp.rename(logPath, rotatedLogPath(boxRoot));
  return true;
}
