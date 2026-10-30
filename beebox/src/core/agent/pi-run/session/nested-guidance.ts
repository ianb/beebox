/**
 * Nested `AGENTS.md` delivery for pi, as Claude Code does it: when a tool
 * touches a file, the instruction files of the directories on the way to it
 * join the context.
 *
 * pi loads the walk-up files (the working directory and its ancestors) at
 * session start. Here the `read`, `edit` and `write` tools are pi's own
 * definitions with one change: after the tool runs, each instruction file
 * between the working directory and the touched file's directory that this
 * session has not had yet is appended to the tool result, under a header
 * naming it. A file whose guidance fails to load gets a note instead, and the
 * tool's own result stands. bash is left alone. Only a file whose real path stays inside the
 * box is read, so a box-written symlink cannot pull a server file such as
 * `/proc/self/environ` into the prompt.
 */

import { open, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { errnoCode, errorMessage } from "../../../../shared/error-guards.js";
import { isWithin } from "../../../../lib/box-containment.js";
import {
  expandInstructionIncludes,
  hasIncludeLines,
  UnsafeAgentContextIncludeError,
  withoutIncludeLines,
} from "../../../agent-context-includes.js";
import { AGENTS_MD, CLAUDE_MD } from "../../../agent-instruction-files.js";

/** The names a directory's instruction file goes by, in pi's order of preference. */
const GUIDANCE_FILES = [AGENTS_MD, CLAUDE_MD];

/** The most text one instruction file, with its includes, adds to a tool result. */
export const NESTED_GUIDANCE_MAX_CHARS = 12_000;

const HEADER = /<nested-agents-md path=("(?:[^"\\]|\\.)*")>/gu;

/** One session's delivery state. A resumed session starts fresh and may deliver a file again. */
export interface NestedGuidance {
  boxRoot: string;
  cwd: string;
  /** Real paths of instruction files in the context: pi's walk-up files and each one delivered. */
  delivered: Set<string>;
  /** Include targets already expanded, shared with the root file's expansion. */
  includesSeen: Set<string>;
}

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (e) {
    if (errnoCode(e) === "ENOENT" || errnoCode(e) === "ENOTDIR") return null;
    throw e;
  }
}

/** The delivery state for a session whose loader already holds `preloaded` (pi's walk-up files). */
export async function nestedGuidance(
  options: { boxRoot: string; cwd: string; preloaded: readonly string[]; includesSeen: Set<string> },
): Promise<NestedGuidance> {
  const delivered = new Set<string>();
  for (const path of options.preloaded) {
    const real = await realpathOrNull(path);
    if (real !== null) delivered.add(real);
  }
  return { boxRoot: options.boxRoot, cwd: options.cwd, delivered, includesSeen: options.includesSeen };
}

/** The directories from below the walk-up set down to `dir`, top first. */
function directoriesToward(state: NestedGuidance, dir: string): string[] {
  const dirs: string[] = [];
  for (let current = dir; isWithin(state.boxRoot, current) && !isWithin(current, state.cwd); current = dirname(current)) {
    dirs.unshift(current);
  }
  return dirs;
}

/** At most `limit` bytes of a regular file as UTF-8, with whether it held more. */
async function readCapped(path: string, limit: number): Promise<{ text: string; truncated: boolean } | null> {
  const handle = await open(path, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return null;
    const buffer = Buffer.alloc(Math.min(stats.size, limit));
    const { bytesRead } = await handle.read({ buffer, position: 0 });
    return { text: buffer.subarray(0, bytesRead).toString("utf8"), truncated: stats.size > limit };
  } finally {
    await handle.close();
  }
}

/** The expanded includes of one instruction file. The shared seen set takes its targets only once it expands whole, so a retry after a failure repeats them. */
async function includesOf(state: NestedGuidance, instructionPath: string): Promise<string> {
  const seen = new Set(state.includesSeen);
  try {
    const text = await expandInstructionIncludes({ instructionPath, boxRoot: state.boxRoot, seen });
    for (const target of seen) state.includesSeen.add(target);
    return text;
  } catch (e) {
    if (!(e instanceof UnsafeAgentContextIncludeError)) throw e;
    console.warn(`[pi] Skipped the includes of ${instructionPath}: ${e.message} (${e.specifier})`);
    return "";
  }
}

function block(options: { rel: string; dirRel: string; body: string }): string {
  const text = options.body.length > NESTED_GUIDANCE_MAX_CHARS
    ? `${options.body.slice(0, NESTED_GUIDANCE_MAX_CHARS)}\n[Cut at ${String(NESTED_GUIDANCE_MAX_CHARS)} characters; read ${options.rel} for the rest.]`
    : options.body;
  return `<nested-agents-md path=${JSON.stringify(options.rel)}>\n`
    + "Bee Box added this block; it is not part of the file or the tool's output. "
    + `It holds the instructions for files in ${options.dirRel}/. Follow them.\n\n${text}\n</nested-agents-md>`;
}

/** What a `read` call showed of its file; null for `edit` and `write`. */
export interface ReadSpan {
  offset: number | undefined;
  limit: number | undefined;
  /** pi cut the output at its own line or byte limit. */
  cut: boolean;
}

interface Touch {
  realRoot: string;
  realTarget: string | null;
  span: ReadSpan | null;
}

/** Whether a read of the instruction file itself gave the model all of its guidance. */
function readWhole(span: ReadSpan | null, content: { text: string; truncated: boolean }): boolean {
  if (span === null || span.cut || content.truncated || hasIncludeLines(content.text)) return false;
  if ((span.offset ?? 1) > 1) return false;
  return span.limit === undefined || span.limit >= content.text.split("\n").length;
}

/** The block for one instruction file at its checked real path. Its delivery is reserved; the caller releases it on a throw. */
async function blockFor(state: NestedGuidance, at: Touch & { dir: string; path: string; real: string }): Promise<string | null | "absent"> {
  // Read the checked real path, so a link swapped after the check cannot redirect the read.
  const content = await readCapped(at.real, NESTED_GUIDANCE_MAX_CHARS * 4);
  if (content === null) return "absent";
  // The agent read the whole instruction file itself.
  if (at.real === at.realTarget && readWhole(at.span, content)) return null;
  const body = [withoutIncludeLines(content.text), await includesOf(state, at.path)].filter((part) => part !== "").join("\n\n");
  if (body === "") return null;
  const rel = relative(state.boxRoot, at.path);
  return block({ rel, dirRel: relative(state.boxRoot, at.dir), body: content.truncated ? `${body}\n[File cut.]` : body });
}

/** One instruction file's block, null when it adds none, or "absent" when there is no such file. */
async function deliverFile(state: NestedGuidance, at: Touch & { dir: string; path: string }): Promise<string | null | "absent"> {
  const real = await realpathOrNull(at.path);
  if (real === null) return "absent";
  if (!isWithin(at.realRoot, real)) {
    console.warn(`[pi] Not delivering ${relative(state.boxRoot, at.path)}: it resolves outside the box`);
    return null;
  }
  if (state.delivered.has(real)) return null;
  // Reserve before the first await, so a parallel tool call in the same batch skips it.
  state.delivered.add(real);
  try {
    const text = await blockFor(state, { ...at, real });
    if (text === "absent") state.delivered.delete(real);
    return text;
  } catch (e) {
    // Released, so a later touch tries again.
    state.delivered.delete(real);
    throw e;
  }
}

/** The note that stands in for guidance that failed to load. */
function loadFailure(path: string, e: unknown): string {
  console.warn(`[pi] Could not load the guidance for ${path}: ${errorMessage(e)}`);
  return `[Bee Box could not load the guidance for ${path}. The tool's own result above stands.]`;
}

/** The text one directory's instruction file adds, or null when it adds none. */
async function deliverFrom(state: NestedGuidance, at: Touch & { dir: string }): Promise<string | null> {
  for (const name of GUIDANCE_FILES) {
    const path = join(at.dir, name);
    try {
      const text = await deliverFile(state, { ...at, path });
      if (text !== "absent") return text;
    } catch (e) {
      return loadFailure(relative(state.boxRoot, path), e);
    }
  }
  return null;
}

/**
 * The instruction files a tool touching `touched.path` brings into the context,
 * as text for its result, or null when it brings none. Each is delivered once
 * per session. A file that fails to load adds a note instead, and a later
 * touch tries it again.
 */
export async function nestedGuidanceFor(state: NestedGuidance, touched: { path: string; span: ReadSpan | null }): Promise<string | null> {
  const target = resolve(state.cwd, touched.path.replace(/^@/u, ""));
  if (!isWithin(state.boxRoot, target)) return null;
  const at = { realRoot: await realpath(state.boxRoot), realTarget: await realpathOrNull(target), span: touched.span };
  const blocks: string[] = [];
  for (const dir of directoriesToward(state, dirname(target))) {
    const text = await deliverFrom(state, { ...at, dir });
    if (text !== null) blocks.push(text);
  }
  return blocks.length === 0 ? null : blocks.join("\n\n");
}

/** The box-relative instruction files named in a tool result's text, in order. */
export function deliveredGuidancePaths(text: string): string[] {
  return [...text.matchAll(HEADER)].flatMap(([, quoted]) => {
    const parsed: unknown = quoted === undefined ? undefined : JSON.parse(quoted);
    return typeof parsed === "string" ? [parsed] : [];
  });
}

function toolPath(params: unknown): string | null {
  if (typeof params !== "object" || params === null || !("path" in params)) return null;
  return typeof params.path === "string" ? params.path : null;
}

const numberOrUndefined = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);

/** What a `read` result showed; pi sets `details.truncation` when it cut the output. */
function readSpan(params: unknown, details: unknown): ReadSpan {
  const cut = typeof details === "object" && details !== null && "truncation" in details;
  if (typeof params !== "object" || params === null) return { offset: undefined, limit: undefined, cut };
  return {
    offset: numberOrUndefined("offset" in params ? params.offset : undefined),
    limit: numberOrUndefined("limit" in params ? params.limit : undefined),
    cut,
  };
}

function withNestedGuidance<P extends ToolDefinition["parameters"], D, S>(
  definition: ToolDefinition<P, D, S>,
  state: NestedGuidance,
): ToolDefinition<P, D, S> {
  const isRead = definition.name === "read";
  return {
    ...definition,
    // pi's five-argument signature, passed through whole.
    execute: async (...args: Parameters<ToolDefinition<P, D, S>["execute"]>) => {
      const result = await definition.execute(...args);
      const path = toolPath(args[1]);
      if (path === null) return result;
      let text: string | null;
      try {
        text = await nestedGuidanceFor(state, { path, span: isRead ? readSpan(args[1], result.details) : null });
      } catch (e) {
        // The tool already ran; its result stands.
        text = loadFailure(path, e);
      }
      return text === null ? result : { ...result, content: [...result.content, { type: "text", text }] };
    },
  };
}

/**
 * pi's `read`, `edit` and `write` with nested guidance appended. Registered
 * as custom tools of the same names, they take the built-ins' places.
 */
export function piGuidedFileTools(state: NestedGuidance, options: { autoResizeImages: boolean }): ToolDefinition[] {
  return [
    defineTool(withNestedGuidance(createReadToolDefinition(state.cwd, { autoResizeImages: options.autoResizeImages }), state)),
    defineTool(withNestedGuidance(createEditToolDefinition(state.cwd), state)),
    defineTool(withNestedGuidance(createWriteToolDefinition(state.cwd), state)),
  ];
}
