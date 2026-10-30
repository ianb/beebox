/**
 * Knowledge Audit runner — executes audit prompts against a box via createAgent()
 * and parses session transcripts to extract agent behavior.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { parseYaml } from "../../../../lib/read-yaml.js";
import { assertStandaloneBox, assertCleanAuditBox } from "../../box-guard.js";
import { testSuiteSchema, type AuditTest, type SearchWhere, type TestSuite } from "../../test-suite-schema.js";
import type { AgentInvokeOptions } from "../../../../core/agent/types.js";
import type { PiSessionDeps } from "../../../../core/agent/pi-run/session/core.js";
import { loadAgentEngine, type AgentEngine } from "../../../../core/box/config.js";
import { chatSystemPrompt, NARRATION_OVERLAY } from "../../../../core/chat/session/run/core.js";
import { buildLandmarkBoxContext } from "../../../../core/chat/session/landmark-context.js";
import { buildLandmarkSessionNote } from "../../../../core/chat/session/prompts.js";
import type { ContextStats } from "../../context-usage.js";
import { createAuditAgent } from "./audit-agent.js";
import { runChecks } from "../../audit-checks.js";
import { generateAgentContextMirrors } from "../../../../core/agent-context-mirrors.js";
import { AGENTS_MD, CLAUDE_MD } from "../../../../core/agent-instruction-files.js";
import { ensureAuditPackageDocs, removeFixtures, writeFixtures } from "./fixtures.js";

export { extractBehavior, KnowledgeAuditTranscriptError } from "./claude-audit.js";
export type { AuditTest, TestSuite };

export interface AgentBehavior {
  filesRead: string[];
  searches: Array<{ tool: string; summary: string }>;
  bashCommands: string[];
  /** Actual bash commands (not descriptions) for automated checks */
  bashRawCommands: string[];
  responseText: string;
  /** The text the chat shows after folding (see `final_reply`, `visibleReplyText`). */
  replyText: string;
  responseLength: number;
  /** Loaded-context size of this run (null if the session had no turns). */
  context: ContextStats | null;
}

export interface AutomatedChecks {
  containsChecks: Array<{ expected: string; found: boolean }>;
  matchesChecks: Array<{ pattern: string; found: boolean; matched?: string }>;
  notContainsChecks: Array<{ forbidden: string; found: boolean }>;
  notMatchesChecks: Array<{ pattern: string; found: boolean; matched?: string }>;
  containsAnyCheck?: { options: string[]; found: boolean; matched?: string | undefined } | undefined;
  cardsContainChecks: Array<{ expected: string; found: boolean; foundIn?: string }>;
  cardsNotUnderChecks: Array<{ prefix: string; found: boolean; foundAt?: string }>;
  shouldReadChecks: Array<{ file: string; wasRead: boolean }>;
  shouldReadAnyCheck?: { files: string[]; wasRead: boolean; matched?: string | undefined } | undefined;
  shouldNotReadChecks: Array<{ file: string; wasRead: boolean }>;
  bashContainsChecks: Array<{ expected: string; found: boolean; matchedCommand?: string }>;
  shouldSearchCheck?: { where: SearchWhere; found: boolean; matched?: string | undefined } | undefined;
  /** The agent stopped at its turn or budget limit; the audit fails on it. */
  agentStopped?: string | undefined;
}

export interface TestResult {
  test: AuditTest;
  engine: AgentEngine;
  sessionId: string;
  behavior: AgentBehavior;
  checks: AutomatedChecks;
}

class KnowledgeAuditAgentError extends Error {
  constructor(engine: AgentEngine, detail: string) {
    super(`${engine} knowledge-audit agent failed: ${detail}`);
    this.name = "KnowledgeAuditAgentError";
  }
}

/**
 * Load audit tests from a YAML file.
 */
export async function loadTests(yamlPath: string): Promise<TestSuite> {
  const content = await fs.readFile(yamlPath, "utf-8");
  return testSuiteSchema.parse(parseYaml(content));
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
  engine?: AgentEngine;
  onOutput?: (text: string) => void;
  /** Exact status this test's docs setup produced (see runBoxAudits); the box must show exactly this. */
  cliSetupStatus?: string;
  /** pi's runtime seams (`createAuditAgent`); dev-only, never set on a server path. */
  piDeps?: PiSessionDeps;
}

export async function runTest(options: RunTestOptions): Promise<TestResult> {
  const { test, boxRoot, onOutput, cliSetupStatus } = options;
  // Guard before any destructive git op — boxRoot must be its own repo.
  await assertStandaloneBox(boxRoot);
  // Direct runTest callers need the same protection as the CLI. Check before
  // docs, memory cleanup, or fixtures can mutate a pre-existing dirty box.
  assertCleanAuditBox(boxRoot, cliSetupStatus);
  const prompt = test.style
    ? `${test.style}. ${test.prompt}`
    : test.prompt;
  await ensureAuditPackageDocs(boxRoot, test);

  // Save git state so we can restore after the test
  const headBefore = execSync("git rev-parse HEAD", { cwd: boxRoot, encoding: "utf-8" }).trim();
  const engine = options.engine ?? await loadAgentEngine(boxRoot);

  // Clean any leftover memory files from previous runs
  const memoryDir = path.join(boxRoot, ".claude", "memory");
  await fs.rm(memoryDir, { recursive: true, force: true });

  // Stage fixture files (e.g. a subdirectory AGENTS.md for landmark
  // audits). Tracked here so post-test cleanup runs even if the agent
  // throws, since `git clean -fd` won't touch gitignored paths.
  const fixturePaths = await writeFixtures(boxRoot, test.fixture);
  try {
    if (engine !== "claude" && test.fixture !== undefined) {
      // An AGENTS.md fixture is read by Codex and pi directly. A legacy CLAUDE.md
      // fixture (unconverted box) gets an AGENTS.md mirror, removed afterwards.
      await generateAgentContextMirrors(boxRoot);
      fixturePaths.push(...fixturePaths
        .filter((fixturePath) => path.basename(fixturePath) === CLAUDE_MD)
        .map((fixturePath) => path.join(path.dirname(fixturePath), AGENTS_MD)));
    }
    const cardsBefore = test.cards_contain || test.cards_not_under ? await snapshotCardFiles(boxRoot) : new Map();
    // In chat mode, mirror what ChatSession.resolveSystemPrompt builds. A
    // landmark audit (context_dir) also carries the box context and landmark
    // note a Claude landmark chat gets (chat/session/run/start.ts).
    const basePrompt = test.chat_mode
      ? `${chatSystemPrompt()}${NARRATION_OVERLAY}\n\nWORKING DIRECTORY: ${boxRoot}`
      : `WORKING DIRECTORY: ${boxRoot}`;
    const systemPrompt = test.context_dir && engine === "claude"
      ? basePrompt + await buildLandmarkBoxContext(boxRoot) + buildLandmarkSessionNote(test.context_dir)
      : basePrompt;
    const invokeOpts: AgentInvokeOptions = {
      boxRoot,
      systemPrompt,
      prompt,
      maxTurns: test.max_turns ?? 10,
    };
    if (test.context_dir) {
      invokeOpts.cwd = path.join(boxRoot, test.context_dir);
      invokeOpts.additionalDirectories = [boxRoot];
    }
    // Claude keys persisted transcripts by the physical cwd (e.g. macOS
    // /tmp resolves to /private/tmp). Invoke and collect with that same path.
    if (engine === "claude") invokeOpts.cwd = await fs.realpath(invokeOpts.cwd ?? boxRoot);
    const audit = createAuditAgent(engine, { onOutput, piDeps: options.piDeps });
    const result = await audit.agent.invoke(invokeOpts);
    // A run that started and stopped at its limit still has a transcript to
    // grade; only an invocation failure leaves nothing to audit.
    const unauditable = !result.success && (result.invocationFailure === true || result.sessionId === "");
    if (unauditable) throw new KnowledgeAuditAgentError(engine, result.error);
    const cardsAfter = test.cards_contain || test.cards_not_under ? await snapshotCardFiles(boxRoot) : new Map();
    // Claude Code stores session logs keyed by the SDK's cwd.
    const behavior = await audit.behavior({ result, logDir: invokeOpts.cwd ?? boxRoot, boxRoot });
    const newOrModifiedCards = findNewOrModifiedCards(cardsBefore, cardsAfter);
    const checks = runChecks(test, { behavior, newOrModifiedCards });
    if (!result.success) checks.agentStopped = result.error;
    return { test, engine, sessionId: result.sessionId, behavior, checks };
  } finally {
    await removeFixtures(fixturePaths);
    execSync(`git reset --hard ${headBefore}`, { cwd: boxRoot, encoding: "utf-8" });
    execSync("git clean -fd", { cwd: boxRoot, encoding: "utf-8" });
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
