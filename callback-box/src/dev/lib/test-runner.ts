/**
 * Knowledge Audit runner — executes audit prompts against a box via runAgent()
 * and parses session transcripts to extract agent behavior.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import YAML from "yaml";
import { runAgent } from "../../core/agent.js";
import {
  getSessionLogPath,
  parseSessionLog,
  type SessionContentBlock,
} from "../../cli/lib/session.js";

export interface AuditTest {
  id: string;
  prompt: string;
  expected_level: string;
  watch_for: string;
  correct_contains?: string[];
  should_read?: string[];
  should_not_read?: string[];
  style?: string;
  tags?: string[];
  notes?: string;
}

export interface TestSuite {
  tests: AuditTest[];
}

export interface AgentBehavior {
  filesRead: string[];
  searches: Array<{ tool: string; summary: string }>;
  bashCommands: string[];
  responseText: string;
  responseLength: number;
}

export interface AutomatedChecks {
  containsChecks: Array<{ expected: string; found: boolean }>;
  shouldReadChecks: Array<{ file: string; wasRead: boolean }>;
  shouldNotReadChecks: Array<{ file: string; wasRead: boolean }>;
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
  return YAML.parse(content) as TestSuite;
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
  const prompt = test.style
    ? `${test.style}. ${test.prompt}`
    : test.prompt;

  const result = await runAgent({
    boxRoot,
    systemPrompt: `WORKING DIRECTORY: ${boxRoot}`,
    prompt,
    maxTurns: 10,
    onOutput,
  });

  const behavior = await extractBehavior(boxRoot, result.sessionId);
  const checks = runChecks(test, behavior);

  return { test, sessionId: result.sessionId, behavior, checks };
}

/**
 * Extract agent behavior from a session transcript.
 */
async function extractBehavior(
  boxRoot: string,
  sessionId: string,
): Promise<AgentBehavior> {
  const logPath = getSessionLogPath(boxRoot, sessionId);
  const { entries } = await parseSessionLog({ logPath });

  const acc: BehaviorAccumulator = { filesRead: [], searches: [], bashCommands: [] };
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

  const responseText = responseChunks.join("\n").trim();

  return {
    ...acc,
    responseText,
    responseLength: responseText.split(/\s+/).length,
  };
}

interface BehaviorAccumulator {
  filesRead: string[];
  searches: Array<{ tool: string; summary: string }>;
  bashCommands: string[];
}

function categorizeToolUse(block: SessionContentBlock, acc: BehaviorAccumulator): void {
  const name = block.toolName ?? "";
  const summary = block.inputSummary ?? "";

  switch (name) {
    case "Read":
      if (summary) acc.filesRead.push(summary);
      break;
    case "Grep":
    case "Glob":
      acc.searches.push({ tool: name, summary });
      break;
    case "Bash":
      if (summary) acc.bashCommands.push(summary);
      break;
  }
}

/**
 * Run automated checks against the agent's behavior.
 */
function runChecks(test: AuditTest, behavior: AgentBehavior): AutomatedChecks {
  const containsChecks = (test.correct_contains ?? []).map((expected) => ({
    expected,
    found: behavior.responseText.toLowerCase().includes(expected.toLowerCase()),
  }));

  const shouldReadChecks = (test.should_read ?? []).map((file) => ({
    file,
    wasRead: behavior.filesRead.some((f) => f.endsWith(file) || f.includes(file)),
  }));

  const shouldNotReadChecks = (test.should_not_read ?? []).map((file) => ({
    file,
    wasRead: behavior.filesRead.some((f) => f.endsWith(file) || f.includes(file)),
  }));

  return { containsChecks, shouldReadChecks, shouldNotReadChecks };
}
