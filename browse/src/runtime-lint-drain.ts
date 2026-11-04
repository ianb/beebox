/**
 * Print the app page's runtime-lint records after a page command.
 *
 * The page keeps a bounded buffer at `window.__bbxRuntimeLint`; `take()`
 * returns `{ records, dropped }` and clears it. One bounded `eval` per drain.
 * `take()` is destructive, so two `bin/browse` processes never print the same
 * record twice and no state is shared between them. A reload or a new tab has
 * its own buffer, which is why commands that leave the page drain first too.
 *
 * Lines go to stderr as `runtime-lint: <check> k=v …`. See
 * beebox/docs/client-debug-log.md.
 */
import { run } from "agent-browser-typed";
import { TARGET_COMMANDS } from "./controls.js";
import type { WorktreeContext } from "./worktree.js";

export const DRAIN_TIMEOUT_MS = 2_000;

/** Commands that leave the page: drain before they run, so the old page's records are not lost. */
const LEAVES_PAGE = new Set(["open", "reload", "back", "forward", "close"]);

/** Other subcommands that act on the current page. An unlisted command never starts a browser to drain. */
const PAGE_COMMANDS = new Set([
  "snapshot", "screenshot", "scroll", "get", "eval", "wait", "hover", "focus", "find", "mouse",
  "tab", "goto", "navigate", "keyboard", "type", "press", "select", "check", "uncheck", "upload", "drag",
  "click", "dblclick", "fill",
]);

export interface DrainPlan {
  before: boolean;
  after: boolean;
}

/** Pure: when a subcommand drains. `close` has no page afterwards. */
export function drainPlan(sub: string): DrainPlan {
  if (sub === "close") return { before: true, after: false };
  if (LEAVES_PAGE.has(sub)) return { before: true, after: true };
  if (PAGE_COMMANDS.has(sub) || TARGET_COMMANDS.has(sub)) return { before: false, after: true };
  return { before: false, after: false };
}

let wedged = false;

/** A command got no answer from the page: skip the drain, which would only wait out its own ceiling. */
export function noteWedged(): void {
  wedged = true;
}

export function isWedged(): boolean {
  return wedged;
}

/** The expression evaluated in the page. Off the router's origin it yields null, like an absent buffer. */
export function drainExpression(ctx: WorktreeContext): string {
  const base = JSON.stringify(ctx.routerBase);
  return `JSON.stringify((location.href === ${base} || location.href.startsWith(${base} + "/") || location.href.startsWith(${base} + "?")) && window.__bbxRuntimeLint ? window.__bbxRuntimeLint.take() : null)`;
}

export interface DrainResult {
  records: Record<string, unknown>[];
  dropped: number;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Pure: upstream `eval` stdout to a result. Anything unrecognized is null. */
export function parseDrain(stdout: string): DrainResult | null {
  let value: unknown;
  try {
    value = JSON.parse(stdout.trim());
    // The eval result is a JSON string; upstream prints it JSON-quoted.
    if (typeof value === "string") value = JSON.parse(value);
  } catch (_e) {
    return null;
  }
  if (!isObject(value)) return null;
  const rawRecords = value["records"];
  const records = Array.isArray(rawRecords) ? rawRecords.filter(isObject) : [];
  const rawDropped = value["dropped"];
  const dropped = typeof rawDropped === "number" && Number.isFinite(rawDropped) && rawDropped > 0 ? Math.floor(rawDropped) : 0;
  return { records, dropped };
}

function formatValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** Pure: stderr lines (no newline) for a drain result. */
export function formatDrain(result: DrainResult | null): string[] {
  if (result === null) return [];
  const lines: string[] = [];
  for (const record of result.records) {
    const check = record["check"];
    const fields = Object.entries(record)
      .filter(([k]) => k !== "check" && k !== "seq")
      .map(([k, v]) => `${k}=${formatValue(v)}`);
    lines.push(["runtime-lint:", typeof check === "string" ? check : "unknown", ...fields].join(" "));
  }
  if (result.dropped > 0) lines.push(`runtime-lint: ${String(result.dropped)} dropped`);
  return lines;
}

/** Take and print the page's records. Never throws: the command's outcome is already decided. */
export async function drainRuntimeLint(ctx: WorktreeContext): Promise<void> {
  if (wedged) return;
  try {
    const { stdout } = await run(["eval", drainExpression(ctx)], { timeoutMs: DRAIN_TIMEOUT_MS });
    for (const line of formatDrain(parseDrain(stdout))) process.stderr.write(`${line}\n`);
  } catch (_e) {
    // No page, a closed browser, or a page that did not answer in time.
  }
}
