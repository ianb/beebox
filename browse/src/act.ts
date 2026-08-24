/**
 * The browser-touching half of control addressing (`controls.ts` is the pure
 * half): the annotated snapshot and the checked action.
 *
 * Both are own-origin only. On any other page there is no `window.__cbUiScan`
 * and no `cb-` ids, so `snapshot` and `click` pass straight through to upstream
 * exactly as before — the checks are a property of driving *this* app.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentBrowserError, getUrl, run, runPassthrough } from "agent-browser-typed";
import {
  annotateSnapshot, applyLiveIds, CHECKED_COMMANDS, checkScript, isControlId, isInteractiveRole,
  judgeBox, parseCheckResult, parseTarget, refRenumbered, upstreamSelector,
} from "./controls.js";
import type { Box, CheckResult, RefTable, ScanEntry, Target } from "./controls.js";
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

async function liveScan(): Promise<ScanEntry[] | null> {
  try {
    const { stdout } = await run(["eval", "JSON.stringify(typeof window.__cbUiScan === 'function' ? window.__cbUiScan().entries.map(e => ({ id: e.id, role: e.role, name: e.name })) : null)"]);
    const v = decodeEval(stdout);
    return Array.isArray(v) ? (v as ScanEntry[]) : null;
  } catch {
    return null;
  }
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
 * whose control has a `cb-` id shows it; the ref table is saved for the
 * identity check on the next action. `--json` output is passed through
 * untouched (its consumers parse upstream's shape).
 */
export async function annotatedSnapshot(args: readonly string[], ctx: WorktreeContext): Promise<number> {
  if (args.includes("--json") || !(await onOwnPage(ctx))) {
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
  const entries = await liveScan();
  if (entries === null) {
    process.stdout.write(text);
    process.stderr.write("browse: page has no window.__cbUiScan — ids not shown (is the frontend up to date?)\n");
    return 0;
  }
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

function refuse(invocation: string, result: Extract<CheckResult, { ok: false }>): number {
  process.stdout.write(`✗ ${invocation} refused: ${result.reason}${result.detail === "" ? "" : ` — ${result.detail}`}\n`);
  return 1;
}

async function checkId(id: string): Promise<CheckResult> {
  try {
    const { stdout } = await run(["eval", checkScript(id)]);
    return parseCheckResult(stdout);
  } catch (e) {
    const msg = e instanceof AgentBrowserError ? e.message : String(e);
    return { ok: false, reason: "check-failed", detail: msg.split("\n")[0] ?? msg };
  }
}

async function checkRefGeometry(ref: string): Promise<CheckResult> {
  let box: Box;
  let viewport: { width: number; height: number };
  try {
    const { stdout } = await run(["get", "box", `@${ref}`, "--json"]);
    const parsed = JSON.parse(stdout) as { data: Box | null };
    if (parsed.data === null) return { ok: false, reason: "no-box", detail: "upstream reported no bounding box" };
    box = parsed.data;
    const vp = await run(["eval", "JSON.stringify({ width: innerWidth, height: innerHeight })"]);
    viewport = decodeEval(vp.stdout) as { width: number; height: number };
  } catch (e) {
    const msg = e instanceof AgentBrowserError ? e.message : String(e);
    return { ok: false, reason: "check-failed", detail: msg.split("\n")[0] ?? msg };
  }
  return judgeBox(box, viewport);
}

/**
 * A target-taking subcommand (`click`, `fill`, …), checked. Resolution order:
 *
 * - `cb-…` / `#cb-…`: the in-page precondition check, then upstream with `#id`.
 * - `@eN`: a warning when the number changed hands between the last two
 *   snapshots (what it was, what it is now); if the element carries a `cb-`
 *   id the action proceeds by id, otherwise only geometry can be checked and
 *   the output says so.
 * - anything else: upstream, untouched.
 */
export async function checkedAction({ sub, args, ctx }: { sub: string; args: readonly string[]; ctx: WorktreeContext }): Promise<number> {
  const raw = args[0];
  if (raw === undefined || raw.startsWith("-")) return runPassthrough([sub, ...args]);
  let target: Target = parseTarget(raw);
  if (target.kind === "selector" || !(await onOwnPage(ctx))) {
    return runPassthrough([sub, ...args]);
  }
  const rest = args.slice(1);
  let unverified = false;
  if (target.kind === "ref") {
    const history = await loadRefHistory();
    let liveId: string | null;
    try {
      liveId = await liveRefId(target.ref);
    } catch (e) {
      // Upstream's own error for an unknown ref is already loud; surface it as-is.
      const msg = e instanceof AgentBrowserError ? (e.stdout.trim() || e.stderr.trim()) : String(e);
      process.stdout.write(`${msg}\n`);
      return 1;
    }
    const renumbered = refRenumbered(history.previous[target.ref], history.current[target.ref]);
    if (renumbered !== null) process.stderr.write(`browse: ${raw} may be stale — ${renumbered}\n`);
    if (liveId !== null) {
      target = { kind: "id", id: liveId };
    } else {
      unverified = true;
    }
  }
  if (CHECKED_COMMANDS.has(sub)) {
    const result = target.kind === "id" ? await checkId(target.id) : await checkRefGeometry(target.ref);
    if (!result.ok) return refuse(`${sub} ${raw}`, result);
    if (result.scrolled) process.stderr.write(`browse: scrolled ${raw} into view first\n`);
  }
  const code = await runPassthrough([sub, upstreamSelector(target), ...rest]);
  if (code === 0 && unverified && CHECKED_COMMANDS.has(sub)) {
    process.stderr.write(`browse: ${raw} has no cb- id, so only its geometry was checked; verify the effect on screen\n`);
  }
  return code;
}
