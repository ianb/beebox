/**
 * Hook mode for `cb validate --hook`: the PostToolUse entry point. Reads the
 * touched file path from a Claude Code hook payload on stdin, validates just
 * that file, and exits — errors AND warnings exit 2 so the agent sees feedback
 * (the hook is a nudge, not a gate; pre-commit blocks only on errors). Split out
 * of validate.ts so the interactive command and the hook stay separate files.
 */

import * as path from "node:path";
import { formatLintResults } from "../../cards/index.js";
import {
  lintMarkdownFiles,
  formatMarkdownResults,
  isLintableMarkdown,
} from "./validate-markdown.js";
import { requireBoxRoot, findBoxRoot, isCardFile, isViewFile } from "../../lib/paths.js";
import { lintViewFile } from "../../webapp/views/compiler.js";
import { lintViewRefs } from "../../core/view-refs.js";
import { lintCardsDispatch } from "../../core/card-lint.js";
import { isClaudeMdFile, lintClaudeMdFile } from "../../core/claude-md-lint.js";
import { buildLoadContext } from "../../core/load-context.js";
import { staleContainsWarning } from "../../core/search/contains-state.js";
import { refreshDerivedRules } from "../../core/refresh-derived-rules.js";
import { loadValidationIgnore } from "../../core/validation-ignore.js";

/**
 * Read the file path from a Claude Code PostToolUse hook payload on stdin.
 * Returns undefined if stdin isn't JSON or doesn't carry a card path —
 * the hook just exits 0 silently in that case.
 */
async function readHookFilePath(): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (raw === "") return undefined;
  try {
    const parsed = JSON.parse(raw) as { tool_input?: { file_path?: unknown } };
    const fp = parsed.tool_input?.file_path;
    return typeof fp === "string" ? fp : undefined;
  } catch (_e) {
    // stdin wasn't valid JSON: per this helper's contract the hook just exits 0
    // silently when there's no parseable payload, so the parse error is expected
    // and carries nothing actionable.
    return undefined;
  }
}

/**
 * Hook mode: read the touched file path from stdin, validate it, and exit.
 * Non-card paths exit 0 silently; errors AND warnings exit 2 so the agent
 * sees feedback. This always exits the process and never returns.
 */
export async function runHookMode(): Promise<never> {
  const fp = await readHookFilePath();
  if (fp === undefined) {
    process.exit(0);
  }
  // CLAUDE.md gets only the soft size lint (it isn't a card and isn't markdown-
  // validity-checked); a too-large one is surfaced as a warning, never blocked.
  if (isClaudeMdFile(fp)) {
    const boxRoot = await requireBoxRoot();
    const warning = await lintClaudeMdFile(boxRoot, fp);
    if (warning !== null) {
      process.stderr.write(`${warning}\n`);
      process.exit(2);
    }
    process.exit(0);
  }
  // Agent-authored view: compile-check it (syntax/JSX/imports). Like cards,
  // a compile failure exits 2 so the agent sees the nudge; no box root needed
  // (compileView takes the absolute path).
  if (isViewFile(fp)) {
    const err = await lintViewFile(fp);
    if (err !== null) {
      process.stderr.write(`View compile error for ${fp}:\n${err}\n`);
      process.exit(2);
    }
    // Same broken-`cardRef` nudge cards get (exit 2). Skip when outside a box —
    // refs need a box root to resolve, and the compile check already stands.
    const refBoxRoot = await findBoxRoot(process.cwd());
    const viewRefWarnings = refBoxRoot === null ? [] : await lintViewRefs(fp, refBoxRoot);
    if (viewRefWarnings.length > 0) {
      process.stderr.write(`${viewRefWarnings.join("\n")}\n`);
      process.exit(2);
    }
    process.exit(0);
  }
  // Agent/human-authored markdown: lint its links (CB001/CB002) so a hand-edit
  // that breaks a link gets the same write-time nudge cards do. CLAUDE.md is
  // handled above; .claude/ rule docs are excluded by isLintableMarkdown.
  if (isLintableMarkdown(fp)) {
    const boxRoot = await requireBoxRoot();
    if ((await loadValidationIgnore(boxRoot)).isIgnored(fp)) process.exit(0);
    const summary = await lintMarkdownFiles([fp], { boxRoot });
    if (summary.totalErrors > 0) {
      process.stderr.write(`${formatMarkdownResults(summary, { colors: false })}\n`);
      process.exit(2);
    }
    process.exit(0);
  }
  if (!isCardFile(fp)) {
    process.exit(0);
  }
  const boxRoot = await requireBoxRoot();
  if ((await loadValidationIgnore(boxRoot)).isIgnored(fp)) process.exit(0);
  const ctx = await buildLoadContext(boxRoot);
  const summary = await lintCardsDispatch([fp], { boxRoot, ctx });
  await refreshDerivedRules(boxRoot, fp);
  const stale = await staleContainsWarning(boxRoot, {
    relPath: path.relative(boxRoot, fp),
    ctx,
  });
  if (summary.totalErrors > 0 || summary.totalWarnings > 0 || stale !== null) {
    const parts: string[] = [];
    if (summary.totalErrors > 0 || summary.totalWarnings > 0) {
      parts.push(formatLintResults(summary, { colors: false }));
    }
    if (stale !== null) parts.push(stale);
    process.stderr.write(`${parts.join("\n")}\n`);
    process.exit(2);
  }
  process.exit(0);
}
