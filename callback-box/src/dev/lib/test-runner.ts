/**
 * Knowledge Audit runner — executes audit prompts against a box via createAgent()
 * and parses session transcripts to extract agent behavior.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import YAML from "yaml";
import { assertStandaloneBox } from "./box-guard.js";
import { testSuiteSchema, type AuditTest, type TestSuite } from "./test-suite-schema.js";
import { errnoCode } from "../../lib/error-guards.js";
import { createAgent } from "../../core/agent/index.js";
import { type KnownToolName, isKnownTool } from "../../shared/known-tools.js";
import { CHAT_SYSTEM_PROMPT, NARRATION_OVERLAY } from "../../core/chat/session/index.js";
import {
  getSessionLogPath,
  parseSessionLog,
  type SessionContentBlock,
} from "../../cli/lib/session.js";
import {
  readTurnUsage,
  summarizeContextUsage,
  type ContextStats,
} from "./context-usage.js";

export type { AuditTest, TestSuite };

export interface AgentBehavior {
  filesRead: string[];
  searches: Array<{ tool: string; summary: string }>;
  bashCommands: string[];
  /** Actual bash commands (not descriptions) for automated checks */
  bashRawCommands: string[];
  responseText: string;
  responseLength: number;
  /** Loaded-context size of this run (null if the session had no turns). */
  context: ContextStats | null;
}

export interface AutomatedChecks {
  containsChecks: Array<{ expected: string; found: boolean }>;
  notContainsChecks: Array<{ forbidden: string; found: boolean }>;
  containsAnyCheck?: { options: string[]; found: boolean; matched?: string | undefined } | undefined;
  cardsContainChecks: Array<{ expected: string; found: boolean; foundIn?: string }>;
  shouldReadChecks: Array<{ file: string; wasRead: boolean }>;
  shouldNotReadChecks: Array<{ file: string; wasRead: boolean }>;
  bashContainsChecks: Array<{ expected: string; found: boolean; matchedCommand?: string }>;
}

export interface TestResult {
  test: AuditTest;
  sessionId: string;
  behavior: AgentBehavior;
  checks: AutomatedChecks;
}

/**
 * Load audit tests from a YAML file.
 */
export async function loadTests(yamlPath: string): Promise<TestSuite> {
  const content = await fs.readFile(yamlPath, "utf-8");
  return testSuiteSchema.parse(YAML.parse(content));
}

/**
 * Find the audits.yaml in a scenario directory.
 */
export function getTestsPath(scenarioDir: string): string {
  return path.join(scenarioDir, "knowledge-audits.yaml");
}

/**
 * Run a single knowledge audit and return the result.
 */
export interface RunTestOptions {
  test: AuditTest;
  boxRoot: string;
  onOutput?: (text: string) => void;
}

export async function runTest(options: RunTestOptions): Promise<TestResult> {
  const { test, boxRoot, onOutput } = options;
  // Guard before any destructive git op — boxRoot must be its own repo.
  await assertStandaloneBox(boxRoot);
  const prompt = test.style
    ? `${test.style}. ${test.prompt}`
    : test.prompt;

  // Save git state so we can restore after the test
  const headBefore = execSync("git rev-parse HEAD", { cwd: boxRoot, encoding: "utf-8" }).trim();

  // Clean any leftover memory files from previous runs
  const memoryDir = path.join(boxRoot, ".claude", "memory");
  await fs.rm(memoryDir, { recursive: true, force: true });

  // Stage fixture files (e.g. a subdirectory CLAUDE.md for landmark
  // audits). Tracked here so post-test cleanup runs even if the agent
  // throws, since `git clean -fd` won't touch gitignored paths.
  const fixturePaths = await writeFixtures(boxRoot, test.fixture);

  // Snapshot card files before the agent runs (for cards_contain checks)
  const cardsBefore = test.cards_contain ? await snapshotCardFiles(boxRoot) : new Map();

  // In chat mode, mirror what ChatSession.resolveSystemPrompt builds:
  // base prompt + NARRATION_OVERLAY (always included; rules gated on the
  // per-turn <chat-app> snapshot inside the user message).
  const systemPrompt = test.chat_mode
    ? `${CHAT_SYSTEM_PROMPT}${NARRATION_OVERLAY}\n\nWORKING DIRECTORY: ${boxRoot}`
    : `WORKING DIRECTORY: ${boxRoot}`;
  const invokeOpts: Parameters<ReturnType<typeof createAgent>["invoke"]>[0] = {
    boxRoot,
    systemPrompt,
    prompt,
    maxTurns: test.max_turns ?? 10,
  };
  if (test.context_dir) {
    invokeOpts.cwd = path.join(boxRoot, test.context_dir);
    invokeOpts.additionalDirectories = [boxRoot];
  }

  const agent = createAgent({
    name: "knowledge-audit",
    ...(onOutput && { onOutput }),
  });
  let result;
  try {
    result = await agent.invoke(invokeOpts);
  } finally {
    await removeFixtures(fixturePaths);
  }

  // Snapshot card files after the agent runs
  const cardsAfter = test.cards_contain ? await snapshotCardFiles(boxRoot) : new Map();

  // Claude Code stores session logs keyed by the SDK's cwd — for
  // landmark-style audits the log lives under the subdirectory's
  // encoded path, not the box root's.
  const logDir = invokeOpts.cwd ?? boxRoot;
  const behavior = await extractBehavior(logDir, result.sessionId);
  const newOrModifiedCards = findNewOrModifiedCards(cardsBefore, cardsAfter);
  const checks = runChecks(test, { behavior, newOrModifiedCards });

  // Restore box to pre-test state: reset commits and clean untracked files
  execSync(`git reset --hard ${headBefore}`, { cwd: boxRoot, encoding: "utf-8" });
  execSync("git clean -fd", { cwd: boxRoot, encoding: "utf-8" });

  return { test, sessionId: result.sessionId, behavior, checks };
}

/**
 * Write fixture files declared by an audit's `fixture` field. Returns
 * the absolute paths written so `removeFixtures` can clean up.
 */
async function writeFixtures(
  boxRoot: string,
  fixture: Record<string, string> | undefined,
): Promise<string[]> {
  if (!fixture) return [];
  const written: string[] = [];
  for (const [relPath, content] of Object.entries(fixture)) {
    const absPath = path.join(boxRoot, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content, "utf-8");
    written.push(absPath);
  }
  return written;
}

async function removeFixtures(paths: string[]): Promise<void> {
  for (const p of paths) {
    await fs.rm(p, { force: true });
  }
}

/**
 * Extract agent behavior from a session transcript.
 *
 * Also walks into sub-agent logs (sibling `<sessionId>/subagents/*.jsonl`
 * directory written by Claude Code when the main agent delegates via the
 * Agent tool). Sub-agent tool calls count as the main agent's behavior for
 * audit purposes — otherwise every delegated Read would be invisible.
 * Sub-agent response text is NOT merged into responseText; only the main
 * agent's text reply is evaluated.
 */
async function extractBehavior(
  logDir: string,
  sessionId: string,
): Promise<AgentBehavior> {
  const logPath = getSessionLogPath(logDir, sessionId);
  const { entries } = await parseSessionLog({ logPath });

  const acc: BehaviorAccumulator = { filesRead: [], searches: [], bashCommands: [], bashRawCommands: [] };
  const responseChunks: string[] = [];

  for (const entry of entries) {
    if (entry.type === "assistant") {
      for (const block of entry.content) {
        if (block.type === "text" && block.text) {
          responseChunks.push(block.text);
        }
        if (block.type === "tool_use") {
          categorizeToolUse(block, acc);
        }
      }
    }
  }

  // Merge tool uses from any sub-agent logs into the accumulator.
  const subagentDir = path.join(path.dirname(logPath), sessionId, "subagents");
  try {
    const subagentFiles = await fs.readdir(subagentDir);
    for (const file of subagentFiles) {
      if (!file.endsWith(".jsonl")) continue;
      const subagentLog = path.join(subagentDir, file);
      const { entries: subEntries } = await parseSessionLog({ logPath: subagentLog });
      for (const entry of subEntries) {
        if (entry.type === "assistant") {
          for (const block of entry.content) {
            if (block.type === "tool_use") {
              categorizeToolUse(block, acc);
            }
          }
        }
      }
    }
  } catch (e) {
    // Sub-agent dir may not exist if the agent never delegated — that's fine.
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`[test-runner] Failed to read subagent logs at ${subagentDir}:`, e);
    }
  }

  const responseText = responseChunks.join("\n").trim();

  // Context-size accounting reads the same main session log (not subagent
  // logs — those are separate contexts; baseline/peak is about what the box
  // agent itself carries every turn).
  const context = summarizeContextUsage(await readTurnUsage(logPath));

  return {
    ...acc,
    responseText,
    responseLength: responseText.split(/\s+/).length,
    context,
  };
}

interface BehaviorAccumulator {
  filesRead: string[];
  searches: Array<{ tool: string; summary: string }>;
  bashCommands: string[];
  bashRawCommands: string[];
}

interface ToolUseContext {
  block: SessionContentBlock;
  acc: BehaviorAccumulator;
  summary: string;
  name: string;
}

/** Per-tool behavior accumulators, keyed on the shared tool vocabulary. */
const TOOL_USE_CATEGORIZERS: Partial<Record<KnownToolName, (ctx: ToolUseContext) => void>> = {
  Read: ({ summary, acc }) => {
    if (summary) acc.filesRead.push(summary);
  },
  Grep: ({ name, summary, acc }) => acc.searches.push({ tool: name, summary }),
  Glob: ({ name, summary, acc }) => acc.searches.push({ tool: name, summary }),
  Bash: ({ block, summary, acc }) => {
    if (summary) acc.bashCommands.push(summary);
    if (block.input) {
      const cmd = String(block.input.command ?? "");
      if (cmd) acc.bashRawCommands.push(cmd);
    }
  },
} satisfies Partial<Record<KnownToolName, (ctx: ToolUseContext) => void>>;

function categorizeToolUse(block: SessionContentBlock, acc: BehaviorAccumulator): void {
  const name = block.toolName ?? "";
  const summary = block.inputSummary ?? "";
  if (isKnownTool(name)) {
    TOOL_USE_CATEGORIZERS[name]?.({ block, acc, summary, name });
  }
}

/**
 * Snapshot all .card files in the box with their mtimes and content hashes.
 */
async function snapshotCardFiles(boxRoot: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  try {
    // Use git ls-files for tracked cards, plus find for untracked
    const output = execSync(
      "find . -name \"*.card\" -type f -not -path \"./.git/*\"",
      { cwd: boxRoot, encoding: "utf-8" },
    );
    for (const line of output.trim().split("\n")) {
      if (!line) continue;
      const fullPath = path.join(boxRoot, line);
      try {
        const content = await fs.readFile(fullPath, "utf-8");
        snapshot.set(line, content);
      } catch (_e) {
        // File may have been deleted between find and read
      }
    }
  } catch (_e) {
    // find command failed, return empty snapshot
  }
  return snapshot;
}

/**
 * Find cards that are new or have different content compared to the before snapshot.
 * Returns a map of relative path → new content.
 */
function findNewOrModifiedCards(
  before: Map<string, string>,
  after: Map<string, string>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const [filePath, content] of after) {
    const oldContent = before.get(filePath);
    if (oldContent === undefined || oldContent !== content) {
      result.set(filePath, content);
    }
  }
  return result;
}

/**
 * Run automated checks against the agent's behavior.
 */
interface RunChecksContext {
  behavior: AgentBehavior;
  newOrModifiedCards: Map<string, string>;
}

function runChecks(test: AuditTest, { behavior, newOrModifiedCards }: RunChecksContext): AutomatedChecks {
  const containsChecks = (test.correct_contains ?? []).map((expected) => ({
    expected,
    found: behavior.responseText.toLowerCase().includes(expected.toLowerCase()),
  }));

  const notContainsChecks = (test.response_not_contains ?? []).map((forbidden) => ({
    forbidden,
    found: behavior.responseText.toLowerCase().includes(forbidden.toLowerCase()),
  }));

  let containsAnyCheck: AutomatedChecks["containsAnyCheck"];
  if (test.correct_contains_any) {
    const lowerText = behavior.responseText.toLowerCase();
    const matched = test.correct_contains_any.find((opt) => lowerText.includes(opt.toLowerCase()));
    containsAnyCheck = { options: test.correct_contains_any, found: !!matched, matched: matched ?? undefined };
  }

  const cardsContainChecks = (test.cards_contain ?? []).map((expected) => {
    const lowerExpected = expected.toLowerCase();
    for (const [filePath, content] of newOrModifiedCards) {
      if (content.toLowerCase().includes(lowerExpected)) {
        return { expected, found: true, foundIn: filePath };
      }
    }
    return { expected, found: false };
  });

  const shouldReadChecks = (test.should_read ?? []).map((file) => ({
    file,
    wasRead: behavior.filesRead.some((f) => f.endsWith(file) || f.includes(file)),
  }));

  const shouldNotReadChecks = (test.should_not_read ?? []).map((file) => ({
    file,
    wasRead: behavior.filesRead.some((f) => f.endsWith(file) || f.includes(file)),
  }));

  const bashContainsChecks = (test.bash_contains ?? []).map((expected) => {
    const lowerExpected = expected.toLowerCase();
    const matched = behavior.bashRawCommands.find((cmd) => cmd.toLowerCase().includes(lowerExpected));
    return { expected, found: !!matched, ...(matched && { matchedCommand: matched }) };
  });

  return { containsChecks, notContainsChecks, containsAnyCheck, cardsContainChecks, shouldReadChecks, shouldNotReadChecks, bashContainsChecks };
}
