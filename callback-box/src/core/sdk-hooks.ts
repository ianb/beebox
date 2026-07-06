/**
 * In-process SDK hook callbacks.
 *
 * Replaces the file-based `plugins/card-validator/` plugin: same matchers
 * and behavior, but runs inside the callback-box server process so we get
 * structured logging and don't pay shell-startup overhead per tool call.
 */

import type {
  HookCallbackMatcher,
  HookJSONOutput,
  PostToolUseHookInput,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { formatLintResults } from "../cards/index.js";
import { lint as markdownlint } from "markdownlint/promise";
import { customLinkRules, linkRuleConfig } from "./markdown-lint-rules.js";
import { lintCardsDispatch } from "./card-lint.js";
import { buildLoadContext } from "./load-context.js";
import { isViewFile, findBoxRoot } from "../lib/paths.js";
import { lintViewFile } from "../webapp/views/compiler.js";

function markdownConfig(boxRoot: string): Record<string, unknown> {
  return { default: false, MD009: true, MD037: true, MD038: true, MD047: true, ...linkRuleConfig(boxRoot) };
}

/** Best-effort extraction of `file_path` from a Write/Edit tool input. */
function extractFilePath(toolInput: unknown): string | null {
  if (toolInput === null || typeof toolInput !== "object") return null;
  const fp = (toolInput as { file_path?: unknown }).file_path;
  return typeof fp === "string" ? fp : null;
}

/**
 * PostToolUse hook for Write/Edit:
 *   - Reject `tricks/scripts/<name>.ts` placed directly in the dir
 *     (must be in a subdirectory: `tricks/scripts/<name>/index.ts`).
 *   - Validate `.card` files via cardworks lint and surface any issues
 *     as additionalContext so the model sees the warning.
 *   - Validate `.md` files via markdownlint and custom link rules.
 *
 * All checks just inject context — they don't block the tool from
 * succeeding (matches the prior shell-hook semantics, which exited 0
 * even on validation failures).
 */
export function cardValidatorHook(): HookCallbackMatcher {
  return {
    matcher: "Write|Edit|MultiEdit",
    hooks: [
      async (input): Promise<HookJSONOutput> => {
        if (input.hook_event_name !== "PostToolUse") return {};
        const post = input as PostToolUseHookInput;
        const filePath = extractFilePath(post.tool_input);
        if (filePath === null) return {};

        // Agent-authored view: compile-check it (syntax/JSX/imports).
        if (isViewFile(filePath)) {
          const err = await lintViewFile(filePath);
          if (err === null) return {};
          return {
            hookSpecificOutput: {
              hookEventName: "PostToolUse",
              additionalContext: `View compile error for ${filePath}:\n${err}`,
            },
          };
        }

        // Tricks dir layout enforcement.
        if (/tricks\/scripts\/[^/]+\.ts$/.test(filePath)) {
          return {
            hookSpecificOutput: {
              hookEventName: "PostToolUse",
              additionalContext:
                "Trick scripts must be in a subdirectory: tricks/scripts/<name>/index.ts, not directly in tricks/scripts/",
            },
          };
        }

        if (filePath.endsWith(".card")) {
          const additional = await runCardLint(post.cwd, filePath);
          if (additional === null) return {};
          return {
            hookSpecificOutput: {
              hookEventName: "PostToolUse",
              additionalContext: additional,
            },
          };
        }

        const basename = filePath.split("/").pop() ?? "";
        if (filePath.endsWith(".md") && basename !== "CLAUDE.md" && !filePath.includes("/.claude/")) {
          const additional = await runMarkdownLint(filePath, { startDir: post.cwd });
          if (additional === null) return {};
          return {
            hookSpecificOutput: {
              hookEventName: "PostToolUse",
              additionalContext: additional,
            },
          };
        }

        return {};
      },
    ],
  };
}

/** Best-effort extraction of the shell `command` from a Bash tool input. */
function extractCommand(toolInput: unknown): string | null {
  if (toolInput === null || typeof toolInput !== "object") return null;
  const cmd = (toolInput as { command?: unknown }).command;
  return typeof cmd === "string" ? cmd : null;
}

/**
 * True for a `git mv` that moves box content (a `store/` path or a `.card`).
 * Plain command-string match — a nudge tolerates false negatives on exotic
 * invocations, and requiring a store/.card token avoids false positives.
 */
function isGitMvOnBoxContent(command: string): boolean {
  if (!/\bgit\s+mv\b/.test(command)) return false;
  return /(^|\s|\/)store\//.test(command) || /\.card\b/.test(command);
}

const GIT_MV_NUDGE =
  "You're using `git mv` on box content. `git mv` relocates files but does NOT " +
  "rewrite inbound references, so links/refs pointing at the moved content will " +
  "dangle. Prefer `cb mv` — it moves the files AND rewrites every reference, " +
  "including inline links in `.md` dossiers. Use plain `git mv` only if you " +
  "intentionally want to move without updating references.";

/**
 * PreToolUse hook for Bash: when the agent reaches for `git mv` on box content,
 * suggest `cb mv` instead (which rewrites inbound references). Advisory only —
 * it injects context, never blocks, since `git mv` is occasionally what's
 * wanted (a move where references should NOT follow).
 */
export function gitMvNudgeHook(): HookCallbackMatcher {
  return {
    matcher: "Bash",
    hooks: [
      async (input): Promise<HookJSONOutput> => {
        if (input.hook_event_name !== "PreToolUse") return {};
        const pre = input as PreToolUseHookInput;
        const command = extractCommand(pre.tool_input);
        if (command === null || !isGitMvOnBoxContent(command)) return {};
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            additionalContext: GIT_MV_NUDGE,
          },
        };
      },
    ],
  };
}

async function runMarkdownLint(filePath: string, { startDir }: { startDir: string }): Promise<string | null> {
  // CB002 needs the box root, and the SDK cwd can be a landmark subdirectory in
  // chat sessions — so resolve the real root by walking up, never trust cwd. If
  // we can't find a box, skip link validation rather than mis-resolve.
  const boxRoot = await findBoxRoot(startDir);
  if (boxRoot === null) return null;
  try {
    const results = await markdownlint({ files: [filePath], config: markdownConfig(boxRoot), customRules: customLinkRules });
    const errors = results[filePath] ?? [];
    if (errors.length === 0) return null;
    const lines = errors.map(
      (e) => `  ${filePath}:${e.lineNumber} [${e.ruleNames[0]}] ${e.ruleDescription}${e.errorDetail ? ` (${e.errorDetail})` : ""}`
    );
    return `Markdown lint warning for ${filePath}:\n${lines.join("\n")}`;
  } catch (e) {
    return `Markdown lint could not run for ${filePath}: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function runCardLint(cwd: string, filePath: string): Promise<string | null> {
  try {
    const ctx = await buildLoadContext(cwd);
    const summary = await lintCardsDispatch([filePath], { boxRoot: cwd, ctx });
    if (summary.totalErrors === 0 && summary.totalWarnings === 0) return null;
    const formatted = formatLintResults(summary, { colors: false });
    return `Card validation warning for ${filePath}:\n${formatted}`;
  } catch (e) {
    return `Card validation could not run for ${filePath}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
