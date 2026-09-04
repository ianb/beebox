/**
 * Hook mode for `bbx validate --hook`: the PostToolUse entry point. Reads the
 * touched file path from a Claude Code hook payload on stdin, validates just
 * that file, and exits — errors AND warnings exit 2 so the agent sees feedback
 * (the hook is a nudge, not a gate; pre-commit blocks only on errors). Split out
 * of validate.ts so the interactive command and the hook stay separate files.
 */

import * as path from "node:path";
import { existsSync } from "node:fs";
import { isRecord } from "../../lib/is-record.js";
import { formatLintResults } from "../../cards/index.js";
import {
  lintMarkdownFiles,
  formatMarkdownResults,
  isLintableMarkdown,
} from "./validate-markdown.js";
import { requireBoxRoot, findBoxRoot, isCardFile, isViewFile } from "../../lib/paths.js";
import { lintViewFile } from "../../webapp/views/compiler.js";
import { lintViewRefs } from "../../core/views/refs.js";
import { lintCardsDispatch } from "../../core/card-lint.js";
import { lintClaudeMdFile } from "../../core/claude-md-lint.js";
import { isAgentInstructionsFile } from "../../core/agent-instruction-files.js";
import { buildLoadContext } from "../../core/load-context.js";
import { staleContainsWarning } from "../../core/search/contains-state.js";
import { refreshDerivedRules } from "../../core/refresh-derived-rules.js";
import { loadValidationIgnore } from "../../core/validation-ignore.js";
import { checkBoxRoot } from "../../lib/box-root-check.js";

/**
 * The npm-namespace entries `bbx validate --hook` treats as "editing the
 * package surface" (Track C, `docs/plans/one-root-box-layout.md`) — their
 * first path segment, whether the edit lands on the entry itself or
 * somewhere underneath it (a file inside `node_modules/`, say).
 */
const NPM_NAMESPACE_ENTRIES = new Set(["package.json", "pnpm-lock.yaml", "package-lock.json", "tsconfig.json", "node_modules"]);

/**
 * Root-vocabulary tripwire for the hook: an edit at the box root itself, or
 * anywhere under an npm-namespace entry, runs the closed-vocabulary root
 * check (one `readdir` — cheap). Returns `null` — never a "clean" result —
 * when there's nothing to surface, so a clean root falls through to the
 * edited file's own per-type handling (a root-level CLAUDE.md edit still
 * gets its usual size lint, say) rather than short-circuiting it.
 */
async function checkPackageSurfaceEdit(fp: string, boxRoot: string): Promise<HookValidationResult | null> {
  const rel = path.relative(boxRoot, fp);
  if (rel === "" || rel.startsWith("..")) return null;
  const firstSegment = rel.split(path.sep)[0];
  const atRoot = path.dirname(fp) === boxRoot;
  const inNpmNamespace = firstSegment !== undefined && NPM_NAMESPACE_ENTRIES.has(firstSegment);
  if (!atRoot && !inNpmNamespace) return null;

  const strays = await checkBoxRoot(boxRoot);
  if (strays.length === 0) return null;
  return { feedback: strays.map((s) => `Box root: ${s.message}`).join("\n"), hasErrors: true };
}

/**
 * Extract edited paths from either harness's PostToolUse input. Claude's
 * Write/Edit tools provide `file_path`; Codex apply_patch provides the patch
 * text in `command`.
 */
export function parseHookFilePaths(parsed: unknown): string[] {
  if (!isRecord(parsed)) return [];
  const toolInput = parsed["tool_input"];
  if (!isRecord(toolInput)) return [];
  const filePath = toolInput["file_path"];
  const cwd = typeof parsed["cwd"] === "string" ? parsed["cwd"] : undefined;
  const resolvePath = (candidate: string): string =>
    cwd !== undefined && !path.isAbsolute(candidate) ? path.resolve(cwd, candidate) : candidate;
  if (typeof filePath === "string") return [resolvePath(filePath)];
  const command = toolInput["command"];
  if (typeof command !== "string") return [];
  const paths: string[] = [];
  const pattern = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
  for (const match of command.matchAll(pattern)) {
    const matchedPath = match[1];
    if (matchedPath !== undefined) paths.push(resolvePath(matchedPath));
  }
  return [...new Set(paths)];
}

async function readHookFilePaths(): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    if (Buffer.isBuffer(chunk)) chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return parseHookFilePaths(parsed);
  } catch (_e) {
    // stdin wasn't valid JSON: per this helper's contract the hook just exits 0
    // silently when there's no parseable payload, so the parse error is expected
    // and carries nothing actionable.
    return [];
  }
}

export interface HookValidationResult {
  feedback: string | null;
  hasErrors: boolean;
}

const CLEAN_HOOK_VALIDATION: HookValidationResult = { feedback: null, hasErrors: false };

async function validateHookPathResult(fp: string): Promise<HookValidationResult> {
  if (!existsSync(fp)) return CLEAN_HOOK_VALIDATION;
  if (/tricks\/scripts\/[^/]+\.ts$/.test(fp)) {
    return {
      feedback: "Trick scripts must be in a subdirectory: tricks/scripts/<name>/index.ts, not directly in tricks/scripts/",
      hasErrors: true,
    };
  }
  const surfaceBoxRoot = await findBoxRoot(path.dirname(fp));
  if (surfaceBoxRoot !== null) {
    const surfaceResult = await checkPackageSurfaceEdit(fp, surfaceBoxRoot);
    if (surfaceResult !== null) return surfaceResult;
  }
  if (isAgentInstructionsFile(fp)) {
    const boxRoot = await requireBoxRoot(path.dirname(fp));
    return { feedback: await lintClaudeMdFile(boxRoot, fp), hasErrors: false };
  }
  if (isViewFile(fp)) {
    const err = await lintViewFile(fp);
    if (err !== null) return { feedback: `View compile error for ${fp}:\n${err}`, hasErrors: true };
    const refBoxRoot = await findBoxRoot(path.dirname(fp));
    const warnings = refBoxRoot === null ? [] : await lintViewRefs(fp, refBoxRoot);
    return { feedback: warnings.length === 0 ? null : warnings.join("\n"), hasErrors: false };
  }
  if (isLintableMarkdown(fp)) {
    const boxRoot = await requireBoxRoot(path.dirname(fp));
    if ((await loadValidationIgnore(boxRoot)).isIgnored(fp)) return CLEAN_HOOK_VALIDATION;
    const summary = await lintMarkdownFiles([fp], { boxRoot });
    return {
      feedback: summary.totalErrors === 0 ? null : formatMarkdownResults(summary, { colors: false }),
      hasErrors: summary.totalErrors > 0,
    };
  }
  if (!isCardFile(fp)) return CLEAN_HOOK_VALIDATION;
  const boxRoot = await requireBoxRoot(path.dirname(fp));
  if ((await loadValidationIgnore(boxRoot)).isIgnored(fp)) return CLEAN_HOOK_VALIDATION;
  const ctx = await buildLoadContext(boxRoot);
  const summary = await lintCardsDispatch([fp], { boxRoot, ctx });
  await refreshDerivedRules(boxRoot, fp);
  const stale = await staleContainsWarning(boxRoot, {
    relPath: path.relative(boxRoot, fp),
    ctx,
  });
  const parts: string[] = [];
  if (summary.totalErrors > 0 || summary.totalWarnings > 0) {
    parts.push(formatLintResults(summary, { colors: false }));
  }
  if (stale !== null) parts.push(stale);
  return { feedback: parts.length === 0 ? null : parts.join("\n"), hasErrors: summary.totalErrors > 0 };
}

/** Validate paths reported by a harness, preserving warnings versus errors. */
export async function validateHookPathsResult(paths: string[]): Promise<HookValidationResult> {
  const feedback: string[] = [];
  let hasErrors = false;
  for (const fp of [...new Set(paths)]) {
    const result = await validateHookPathResult(fp);
    if (result.feedback !== null) {
      feedback.push(result.feedback);
      hasErrors ||= result.hasErrors;
    }
  }
  return { feedback: feedback.length === 0 ? null : feedback.join("\n"), hasErrors };
}

/** Validate paths reported by a hook and return combined agent feedback. */
async function validateHookPaths(paths: string[]): Promise<string | null> {
  return (await validateHookPathsResult(paths)).feedback;
}

/**
 * Hook mode: read the touched file path from stdin, validate it, and exit.
 * Non-card paths exit 0 silently; errors AND warnings exit 2 so the agent
 * sees feedback. This always exits the process and never returns.
 */
export async function runHookMode(): Promise<never> {
  const paths = await readHookFilePaths();
  const feedback = await validateHookPaths(paths);
  if (feedback !== null) {
    process.stderr.write(`${feedback}\n`);
    process.exit(2);
  }
  process.exit(0);
}
