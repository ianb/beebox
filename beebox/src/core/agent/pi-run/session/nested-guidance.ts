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
 * naming it. bash is left alone. Only a file whose real path stays inside the
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
import { errnoCode } from "../../../../shared/error-guards.js";
import { isWithin } from "../../../../lib/box-containment.js";
import {
  expandInstructionIncludes,
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

async function includesOf(state: NestedGuidance, instructionPath: string): Promise<string> {
  try {
    return await expandInstructionIncludes({ instructionPath, boxRoot: state.boxRoot, seen: state.includesSeen });
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

/** The text one directory's instruction file adds, or null when it adds none. */
async function deliverFrom(state: NestedGuidance, at: { dir: string; realRoot: string; realTarget: string | null }): Promise<string | null> {
  for (const name of GUIDANCE_FILES) {
    const path = join(at.dir, name);
    const real = await realpathOrNull(path);
    if (real === null) continue;
    const rel = relative(state.boxRoot, path);
    if (!isWithin(at.realRoot, real)) {
      console.warn(`[pi] Not delivering ${rel}: it resolves outside the box`);
      return null;
    }
    if (state.delivered.has(real)) return null;
    // Read the checked real path, so a link swapped after the check cannot redirect the read.
    const content = await readCapped(real, NESTED_GUIDANCE_MAX_CHARS * 4);
    if (content === null) continue;
    state.delivered.add(real);
    // The agent read the instruction file itself.
    if (real === at.realTarget) return null;
    const body = [withoutIncludeLines(content.text), await includesOf(state, path)].filter((part) => part !== "").join("\n\n");
    if (body === "") return null;
    return block({ rel, dirRel: relative(state.boxRoot, at.dir), body: content.truncated ? `${body}\n[File cut.]` : body });
  }
  return null;
}

/**
 * The instruction files a tool touching `touched` brings into the context,
 * as text for its result, or null when it brings none. Each is delivered once
 * per session.
 */
export async function nestedGuidanceFor(state: NestedGuidance, touched: string): Promise<string | null> {
  const target = resolve(state.cwd, touched.replace(/^@/u, ""));
  if (!isWithin(state.boxRoot, target)) return null;
  const at = { realRoot: await realpath(state.boxRoot), realTarget: await realpathOrNull(target) };
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

function withNestedGuidance<P extends ToolDefinition["parameters"], D, S>(
  definition: ToolDefinition<P, D, S>,
  state: NestedGuidance,
): ToolDefinition<P, D, S> {
  return {
    ...definition,
    // pi's five-argument signature, passed through whole.
    execute: async (...args: Parameters<ToolDefinition<P, D, S>["execute"]>) => {
      const result = await definition.execute(...args);
      const path = toolPath(args[1]);
      const text = path === null ? null : await nestedGuidanceFor(state, path);
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
