/**
 * The browser-touching half of control addressing (`controls.ts` is the pure
 * half): the annotated snapshot and the checked action.
 *
 * Both are own-origin only. On any other page there is no `window.__bbxUiScan`
 * and no `bbx-` ids, so `snapshot` and `click` pass straight through to upstream
 * exactly as before — the checks are a property of driving *this* app.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentBrowserError, getUrl, run, runPassthrough } from "agent-browser-typed";
import {
  annotateSnapshot, applyLiveIds, boxCenter, CHECKED_COMMANDS, checkScript, GET_TARGET_SUBCOMMANDS, isControlId,
  isInteractiveRole, judgeBox, parseCheckResult, parseTarget, refRenumbered, upstreamSelector,
} from "./controls.js";
import type { Box, CheckResult, Locator, RefRecord, RefTable, ScanEntry, Target } from "./controls.js";
import { isOwnOrigin } from "./worktree.js";
import type { WorktreeContext } from "./worktree.js";

/** Where the last snapshot's ref table lives: beside the session's socket, one file per session. */
function refTablePath(): string {
  const dir = process.env["AGENT_BROWSER_SOCKET_DIR"] ?? process.cwd();
  const session = process.env["AGENT_BROWSER_SESSION"] ?? "default";
  return join(dir, `${session}.refs.json`);
}

interface RefHistory {
  current: RefTable;
  previous: RefTable;
}

async function loadRefHistory(): Promise<RefHistory> {
  try {
    const raw = await readFile(refTablePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "current" in parsed && "previous" in parsed) {
      return parsed as RefHistory;
    }
  } catch {
    // No history yet.
  }
  return { current: {}, previous: {} };
}

/** Remembers the last two snapshots' ref tables — what {@link refRenumbered} compares. */
async function saveRefTable(refs: RefTable): Promise<void> {
  try {
    const history = await loadRefHistory();
    await writeFile(refTablePath(), JSON.stringify({ current: refs, previous: history.current }));
  } catch (e) {
    process.stderr.write(`browse: could not record snapshot refs (${String(e)}); the renumbering warning is off for the next action\n`);
  }
}

async function onOwnPage(ctx: WorktreeContext): Promise<boolean> {
  try {
    return isOwnOrigin(await getUrl(), ctx);
  } catch {
    return false;
  }
}

/** The evaluated value `eval` printed, JSON-decoded once. */
function decodeEval(stdout: string): unknown {
  const outer: unknown = JSON.parse(stdout.trim());
  return typeof outer === "string" ? JSON.parse(outer) : outer;
}

interface LiveScan {
  entries: ScanEntry[];
  /** `bbx-` ids more than one element carries right now — `getElementById` would pick one silently. */
  duplicateIds: string[];
}

const SCAN_EXPR = "JSON.stringify(typeof window.__bbxUiScan === 'function' ? (s => ({ entries: s.entries.map(e => ({ id: e.id, role: e.role, name: e.name })), duplicateIds: s.duplicateIds }))(window.__bbxUiScan()) : null)";

async function liveScan(): Promise<LiveScan | null> {
  try {
    const { stdout } = await run(["eval", SCAN_EXPR]);
    const v = decodeEval(stdout);
    if (typeof v !== "object" || v === null || !("entries" in v)) return null;
    const scan = v as { entries: unknown; duplicateIds: unknown };
    return {
      entries: Array.isArray(scan.entries) ? (scan.entries as ScanEntry[]) : [],
      duplicateIds: Array.isArray(scan.duplicateIds) ? (scan.duplicateIds as string[]) : [],
    };
  } catch {
    return null;
  }
}

function warnDuplicates(duplicateIds: readonly string[]): void {
  if (duplicateIds.length === 0) return;
  process.stderr.write(`browse: duplicate bbx- ids on this page (an id-addressed action on them is refused): ${duplicateIds.join(", ")}\n`);
}

/** The id attribute of the element a ref names right now, or null. */
async function liveRefId(ref: string): Promise<string | null> {
  const { stdout } = await run(["get", "attr", `@${ref}`, "id", "--json"]);
  const parsed: unknown = JSON.parse(stdout);
  const value = typeof parsed === "object" && parsed !== null && "data" in parsed
    ? (parsed as { data: { value?: unknown } | null }).data?.value
    : undefined;
  return typeof value === "string" && isControlId(value) ? value : null;
}

/**
 * `snapshot`, with ids. Upstream's text is captured and rewritten so each ref
 * whose control has a `bbx-` id shows it; the ref table is saved for the
 * identity check on the next action. `--json` output is passed through
 * untouched (its consumers parse upstream's shape).
 */
export async function annotatedSnapshot(args: readonly string[], ctx: WorktreeContext): Promise<number> {
  if (!(await onOwnPage(ctx))) {
    return runPassthrough(["snapshot", ...args]);
  }
  let text: string;
  try {
    ({ stdout: text } = await run(["snapshot", ...args]));
  } catch (e) {
    if (e instanceof AgentBrowserError) {
      process.stderr.write(e.stderr === "" ? e.stdout : e.stderr);
      return e.code === -1 ? 1 : e.code;
    }
    throw e;
  }
  if (args.includes("--json")) {
    // Upstream's shape is passed through untouched (its consumers parse it);
    // the ref table is still recorded so the renumbering warning works for a
    // JSON-driven caller too.
    process.stdout.write(text);
    await saveRefTable(refsFromJson(text));
    return 0;
  }
  const scan = await liveScan();
  if (scan === null) {
    process.stdout.write(text);
    process.stderr.write("browse: page has no window.__bbxUiScan — ids not shown (is the frontend up to date?)\n");
    await saveRefTable(annotateSnapshot(text, []).refs);
    return 0;
  }
  const { entries } = scan;
  warnDuplicates(scan.duplicateIds);
  const annotated = annotateSnapshot(text, entries);
  const remainingIds = new Set(entries.flatMap((e) => (e.id === null ? [] : [e.id])));
  for (const rec of Object.values(annotated.refs)) {
    if (rec.id !== null) remainingIds.delete(rec.id);
  }
  // Refs the name match could not place: ask the browser directly, but only
  // for interactive roles and only while the scan still has ids unaccounted
  // for — every lookup is a ~0.3s round-trip.
  const liveIds: Record<string, string> = {};
  if (remainingIds.size > 0) {
    const candidates = annotated.unmatched.filter((ref) => {
      const rec = annotated.refs[ref];
      return rec !== undefined && isInteractiveRole(rec.role);
    });
    for (const ref of candidates) {
      if (remainingIds.size === 0) break;
      try {
        const id = await liveRefId(ref);
        if (id !== null && remainingIds.has(id)) {
          liveIds[ref] = id;
          remainingIds.delete(id);
        }
      } catch {
        // A ref upstream no longer knows: the page moved under us; leave it unannotated.
      }
    }
  }
  const finalText = Object.keys(liveIds).length === 0 ? annotated.text : applyLiveIds(annotated, liveIds);
  process.stdout.write(finalText);
  await saveRefTable(annotated.refs);
  return 0;
}

/** The ref table a `snapshot --json` payload implies: role and name per ref, no id. */
function refsFromJson(text: string): RefTable {
  const refs: RefTable = {};
  try {
    const parsed = JSON.parse(text) as { data?: { refs?: Record<string, { role?: unknown; name?: unknown }> } };
    for (const [ref, rec] of Object.entries(parsed.data?.refs ?? {})) {
      refs[ref] = {
        role: typeof rec.role === "string" ? rec.role : "",
        name: typeof rec.name === "string" ? rec.name : null,
        id: null,
      };
    }
  } catch {
    // Not the shape expected: nothing to record.
  }
  return refs;
}

function refuse(invocation: string, result: Extract<CheckResult, { ok: false }>): number {
  process.stdout.write(`✗ ${invocation} refused: ${result.reason}${result.detail === "" ? "" : ` — ${result.detail}`}\n`);
  return 1;
}

async function checkLocator(locator: Locator): Promise<CheckResult> {
  try {
    const { stdout } = await run(["eval", checkScript(locator)]);
    return parseCheckResult(stdout);
  } catch (e) {
    const msg = e instanceof AgentBrowserError ? e.message : String(e);
    return { ok: false, reason: "check-failed", detail: msg.split("\n")[0] ?? msg };
  }
}

/**
 * The check for a target only upstream can resolve (a `@eN` ref with no id,
 * XPath, `text=`): upstream reports the box, and the element under its centre
 * is judged — including, for a ref, whether it still answers to the name the
 * snapshot gave it.
 */
async function checkAtBox(selector: string, expectName: string | null): Promise<CheckResult> {
  let box: Box;
  let viewport: { width: number; height: number };
  try {
    const { stdout } = await run(["get", "box", selector, "--json"]);
    const parsed = JSON.parse(stdout) as { data: Box | null };
    if (parsed.data === null) return { ok: false, reason: "no-box", detail: "upstream reported no bounding box" };
    box = parsed.data;
    const vp = await run(["eval", "JSON.stringify({ width: innerWidth, height: innerHeight })"]);
    viewport = decodeEval(vp.stdout) as { width: number; height: number };
  } catch (e) {
    const msg = e instanceof AgentBrowserError ? e.message : String(e);
    return { ok: false, reason: "check-failed", detail: msg.split("\n")[0] ?? msg };
  }
  const geometry = judgeBox(box, viewport);
  if (!geometry.ok) return geometry;
  const { x, y } = boxCenter(box, viewport);
  return checkLocator({ kind: "point", x, y, expectName });
}

/**
 * A target-taking subcommand (`click`, `fill`, …), checked. Resolution order:
 *
 * - `bbx-…` / `#bbx-…`: the in-page precondition check, then upstream with `#id`.
 * - `@eN`: a warning when the number changed hands between the last two
 *   snapshots (what it was, what it is now); if the element carries a `bbx-`
 *   id the action proceeds by id, otherwise only geometry can be checked and
 *   the output says so.
 * - anything else: upstream, untouched.
 */
export async function checkedAction({ sub, args, ctx }: { sub: string; args: readonly string[]; ctx: WorktreeContext }): Promise<number> {
  const raw = args[0];
  if (raw === undefined || raw.startsWith("-")) return runPassthrough([sub, ...args]);
  let target: Target = parseTarget(raw);
  if (!(await onOwnPage(ctx))) {
    return runPassthrough([sub, upstreamSelector(target), ...args.slice(1)]);
  }
  const rest = args.slice(1);
  let recorded: RefRecord | undefined;
  if (target.kind === "ref") {
    const history = await loadRefHistory();
    recorded = history.current[target.ref];
    let liveId: string | null;
    try {
      liveId = await liveRefId(target.ref);
    } catch (e) {
      // Upstream's own error for an unknown ref is already loud; surface it as-is.
      const msg = e instanceof AgentBrowserError ? (e.stdout.trim() || e.stderr.trim()) : String(e);
      process.stdout.write(`${msg}\n`);
      return 1;
    }
    const renumbered = refRenumbered(history.previous[target.ref], recorded);
    if (renumbered !== null) process.stderr.write(`browse: ${raw} may be stale — ${renumbered}\n`);
    if (liveId !== null) target = { kind: "id", id: liveId };
  }
  if (CHECKED_COMMANDS.has(sub)) {
    let result: CheckResult;
    switch (target.kind) {
      case "id": {
        const scan = await liveScan();
        if (scan !== null && scan.duplicateIds.includes(target.id)) {
          return refuse(`${sub} ${raw}`, { ok: false, reason: "duplicate-id", detail: `${target.id} is on more than one element right now; the app should not do that — report it` });
        }
        result = await checkLocator({ kind: "id", id: target.id });
        break;
      }
      case "css":
        result = await checkLocator({ kind: "css", selector: target.selector });
        break;
      case "ref":
        result = await checkAtBox(`@${target.ref}`, recorded?.name ?? null);
        break;
      case "opaque":
        // XPath / `text=`: upstream's CDP engine reports "Element not found"
        // for these itself (measured 0.27.0), and `get box` cannot resolve
        // them, so there is nothing to check — hand them over and say so.
        process.stderr.write(`browse: ${raw} is not a form the precondition check can resolve; passing it to upstream unchecked\n`);
        return runPassthrough([sub, target.selector, ...rest]);
    }
    if (!result.ok) return refuse(`${sub} ${raw}`, result);
    if (result.scrolled) process.stderr.write(`browse: scrolled ${raw} into view first\n`);
    if (result.clickAt !== undefined && sub === "click") {
      const { x, y } = result.clickAt;
      const px = String(Math.round(x));
      const py = String(Math.round(y));
      await run(["mouse", "move", px, py]);
      await run(["mouse", "down"]);
      await run(["mouse", "up"]);
      process.stdout.write(`✓ Done (clicked the label for ${raw})\n`);
      return 0;
    }
  }
  return runPassthrough([sub, upstreamSelector(target), ...rest]);
}

/** `get <sub> <target> …`: the target slot accepts a `bbx-` id like every other. */
export async function getWithTarget(args: readonly string[]): Promise<number> {
  const sub = args[0];
  const raw = args[1];
  if (sub === undefined || raw === undefined || !GET_TARGET_SUBCOMMANDS.has(sub)) return runPassthrough(["get", ...args]);
  return runPassthrough(["get", sub, upstreamSelector(parseTarget(raw)), ...args.slice(2)]);
}
