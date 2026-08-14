/**
 * Hook mode for `cb validate --hook`: the PostToolUse entry point. Reads the
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
import { isAgentInstructionsFile, lintClaudeMdFile } from "../../core/claude-md-lint.js";
import { buildLoadContext } from "../../core/load-context.js";
import { staleContainsWarning } from "../../core/search/contains-state.js";
import { refreshDerivedRules } from "../../core/refresh-derived-rules.js";
import { loadValidationIgnore } from "../../core/validation-ignore.js";

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

export async function validateHookPath(fp: string): Promise<string | null> {
  if (!existsSync(fp)) return null;
  if (/tricks\/scripts\/[^/]+\.ts$/.test(fp)) {
    return "Trick scripts must be in a subdirectory: tricks/scripts/<name>/index.ts, not directly in tricks/scripts/";
  }
  if (isAgentInstructionsFile(fp)) {
    const boxRoot = await requireBoxRoot();
    return lintClaudeMdFile(boxRoot, fp);
  }
  if (isViewFile(fp)) {
    const err = await lintViewFile(fp);
    if (err !== null) return `View compile error for ${fp}:\n${err}`;
    const refBoxRoot = await findBoxRoot(process.cwd());
    const warnings = refBoxRoot === null ? [] : await lintViewRefs(fp, refBoxRoot);
    return warnings.length === 0 ? null : warnings.join("\n");
  }
  if (isLintableMarkdown(fp)) {
    const boxRoot = await requireBoxRoot();
    if ((await loadValidationIgnore(boxRoot)).isIgnored(fp)) return null;
    const summary = await lintMarkdownFiles([fp], { boxRoot });
    return summary.totalErrors === 0
      ? null
      : formatMarkdownResults(summary, { colors: false });
  }
  if (!isCardFile(fp)) return null;
  const boxRoot = await requireBoxRoot();
  if ((await loadValidationIgnore(boxRoot)).isIgnored(fp)) return null;
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
  return parts.length === 0 ? null : parts.join("\n");
}

/** Validate paths reported by a harness and return the combined agent feedback. */
export async function validateHookPaths(paths: string[]): Promise<string | null> {
  const feedback: string[] = [];
  for (const fp of [...new Set(paths)]) {
    const result = await validateHookPath(fp);
    if (result !== null) feedback.push(result);
  }
  return feedback.length === 0 ? null : feedback.join("\n");
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
