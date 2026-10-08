/**
 * Dev-guidance knowledge audits: ask a headless Claude Code session in this
 * monorepo checkout what it knows from the dev guidance (root and package
 * CLAUDE.md files, project skills, docs), observed through
 * `claude -p --output-format stream-json`.
 *
 * Flags, and why:
 * - `--setting-sources project` loads the project skills and settings but not
 *   user or local settings; `--settings {"disableAllHooks":true}` keeps the
 *   project SessionStart/SessionEnd hooks (registry, sweeps, worktree
 *   removal) from running for an audit.
 * - `--strict-mcp-config` with no `--mcp-config` drops user MCP connectors.
 * - `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` keeps the developer's auto-memory out,
 *   so a pass means tracked guidance taught it. The user-level
 *   `~/.claude/CLAUDE.md` still loads; the CLI has no switch for it short of
 *   `--bare`, which also drops project CLAUDE.md discovery and OAuth.
 * - `--tools Read,Grep,Glob,Skill`: read-only, no Bash or Edit, so the audit
 *   cannot change the checkout. A Skill invocation counts as a read of that
 *   skill's SKILL.md, which is what it loads.
 * - The prompt travels on stdin (the variadic `--tools` would swallow a
 *   positional prompt), as in `bin/cross-model-run.ts`.
 */

import { spawn, execFileSync } from "node:child_process";
import * as path from "node:path";
import { z } from "zod";
import type { AgentBehavior, AuditTest, TestResult } from "./runner/run-test.js";
import { runChecks } from "../audit-checks.js";
import { parseUsage, summarizeContextUsage, type TurnUsage } from "../context-usage.js";
import { isRecord } from "../../../shared/is-record.js";

export const DEFAULT_DEV_AUDIT_MODEL = "claude-opus-5-5";
const DEFAULT_MAX_TURNS = 10;
const SESSION_TIMEOUT_MS = 10 * 60_000;

/** Parent-session bindings a nested `claude -p` must not inherit. */
const PARENT_SESSION_ENV = [
  "CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_BRIDGE_SESSION_ID",
  "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_CODE_ENTRYPOINT",
];

class DevAuditExitError extends Error {
  constructor(exit: string, stderr: string) {
    super(`dev knowledge-audit session: claude exited ${exit}: ${stderr.trim().slice(-2000)}`);
    this.name = "DevAuditExitError";
  }
}

class DevAuditIncompleteError extends Error {
  constructor(auditId: string, resultSubtype: string | null) {
    super(`dev knowledge-audit ${auditId} ended with ${resultSubtype ?? "no result event"}`);
    this.name = "DevAuditIncompleteError";
  }
}

export function devClaudeArgs(options: { model: string; maxTurns: number }): string[] {
  return [
    "-p", "--model", options.model, "--max-turns", String(options.maxTurns),
    "--setting-sources", "project", "--settings", JSON.stringify({ disableAllHooks: true }),
    "--strict-mcp-config", "--no-session-persistence", "--tools", "Read,Grep,Glob,Skill",
    "--output-format", "stream-json", "--verbose",
  ];
}

const blockSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  name: z.string().optional(),
  input: z.unknown().optional(),
});
const streamLineSchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  session_id: z.string().optional(),
  message: z.object({
    id: z.string().optional(),
    content: z.array(blockSchema).optional(),
    usage: z.unknown().optional(),
  }).optional(),
});

export interface DevSessionTrace {
  behavior: AgentBehavior;
  sessionId: string;
  /** The `result` event's subtype: `success`, `error_max_turns`, … (null if absent). */
  resultSubtype: string | null;
}

function inputString(input: unknown, key: string): string {
  if (!isRecord(input)) return "";
  const value = input[key];
  return typeof value === "string" ? value : "";
}

/**
 * Normalize a stream-json transcript into audit behavior. Read paths are made
 * repo-relative; a Skill call is recorded as a read of its SKILL.md. Stream
 * events repeat one message's usage for each of its content blocks, so usage
 * is counted once per message id.
 */
export function devBehaviorFromStreamJson(lines: string[], repoRoot: string): DevSessionTrace {
  const behavior: AgentBehavior = {
    filesRead: [], searches: [], bashCommands: [], bashRawCommands: [], responseText: "", responseLength: 0, context: null,
  };
  const chunks: string[] = [];
  const usageByMessage = new Map<string, TurnUsage>();
  let sessionId = "";
  let resultSubtype: string | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const parsed = streamLineSchema.safeParse(JSON.parse(line));
    if (!parsed.success) continue;
    const event = parsed.data;
    if (event.session_id) sessionId = event.session_id;
    if (event.type === "result") resultSubtype = event.subtype ?? null;
    if (event.type !== "assistant" || !event.message) continue;
    const usage = parseUsage(event.message.usage);
    if (usage && event.message.id) usageByMessage.set(event.message.id, usage);
    for (const block of event.message.content ?? []) {
      if (block.type === "text" && block.text) chunks.push(block.text);
      if (block.type !== "tool_use") continue;
      const tool = block.name ?? "";
      if (tool === "Read") {
        const file = inputString(block.input, "file_path");
        if (file) behavior.filesRead.push(path.isAbsolute(file) ? path.relative(repoRoot, file) : file);
      } else if (tool === "Skill") {
        const skill = inputString(block.input, "skill");
        if (skill) behavior.filesRead.push(`.claude/skills/${skill}/SKILL.md`);
      } else if (tool === "Grep" || tool === "Glob") {
        const where = inputString(block.input, "path");
        behavior.searches.push({ tool, summary: `${inputString(block.input, "pattern")}${where ? ` in ${where}` : ""}` });
      }
    }
  }
  behavior.responseText = chunks.join("\n").trim();
  behavior.responseLength = behavior.responseText.split(/\s+/).filter(Boolean).length;
  behavior.context = summarizeContextUsage([...usageByMessage.values()]);
  return { behavior, sessionId, resultSubtype };
}

export function devRepoRoot(from: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: from, encoding: "utf-8" }).trim();
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" };
  for (const key of PARENT_SESSION_ENV) Reflect.deleteProperty(env, key);
  return env;
}

/** Run `claude -p` in its own process group; resolve with stdout lines. */
async function runClaude(options: { args: string[]; cwd: string; prompt: string }): Promise<string[]> {
  const child = spawn("claude", options.args, { cwd: options.cwd, env: childEnv(), detached: true, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  child.stdin.end(options.prompt);
  const timer = setTimeout(() => {
    if (child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
  }, SESSION_TIMEOUT_MS);
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timer));
  // A max-turns stop exits 1 with a result event; the caller reports it.
  if (exit.signal !== null || (exit.code !== 0 && !stdout.includes("\"type\":\"result\""))) {
    throw new DevAuditExitError(exit.signal ?? String(exit.code), stderr);
  }
  return stdout.split("\n");
}

export async function runDevTest(options: { test: AuditTest; repoRoot: string; model: string }): Promise<TestResult> {
  const { test, repoRoot, model } = options;
  const prompt = test.style ? `${test.style}. ${test.prompt}` : test.prompt;
  const lines = await runClaude({
    args: devClaudeArgs({ model, maxTurns: test.max_turns ?? DEFAULT_MAX_TURNS }),
    cwd: repoRoot,
    prompt,
  });
  const trace = devBehaviorFromStreamJson(lines, repoRoot);
  if (trace.resultSubtype !== "success") {
    throw new DevAuditIncompleteError(test.id, trace.resultSubtype);
  }
  const checks = runChecks(test, { behavior: trace.behavior, newOrModifiedCards: new Map() });
  return { test, engine: "claude", sessionId: trace.sessionId, behavior: trace.behavior, checks };
}
