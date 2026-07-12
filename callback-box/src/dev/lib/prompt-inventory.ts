/**
 * Prompt inventory — collect every *static* prompt, instruction, and rule in
 * the system: agent system prompts, schema instructions, connector rules, and
 * procedure templates. Pure collection (no rendering, no I/O beyond reading the
 * bundled procedure templates), so both `prompt-report.ts` (markdown) and
 * `prompt-viewer.ts` (the HTML dev tool) can consume it.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { cardSchemas } from "../../schemas/registry.js";
import { buildReactorSystemPrompt, buildReactorUserPrompt } from "../../core/reactor/prompts.js";
import { CHAT_SYSTEM_PROMPT } from "../../core/chat/session/index.js";
import { buildThreadSystemPrompt } from "../../core/chat/session/thread.js";
import { COMMIT_NUDGE_PROMPT } from "../../core/agent/index.js";
import { OBSERVER_SYSTEM_PROMPT } from "../../core/retro/observer.js";
import { VALIDATION_SYSTEM_PROMPT } from "../../scenario/runner.js";
import { buildJudgePrompt } from "../../core/procedure/engine-validate-model.js";
import { buildTriageSystemPrompt } from "../../core/triage/index.js";
import { connectorRules } from "../../core/init-rules.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import { errnoCode } from "../../lib/error-guards.js";

const PLACEHOLDER = "${boxRoot}";
const TEMPLATES_DIR = path.join(PACKAGE_ROOT, "templates", "procedures");

export interface PromptEntry {
  /** Section heading */
  title: string;
  /** Source file (relative to callback-box/) */
  source: string;
  /** When/where this prompt is used */
  scope: string;
  /** The prompt text */
  text: string;
}

/** Collect all static prompts in the system, in a stable order. */
export async function collectPrompts(): Promise<PromptEntry[]> {
  const entries: PromptEntry[] = [];

  // ── 1. Agent system prompts ──────────────────────────────────────

  entries.push({
    title: "Reactor System Prompt",
    source: "src/core/reactor/prompts.ts → buildReactorSystemPrompt()",
    scope: "Prepended as the system prompt for every batch job agent session. This is the wrapper that tells the agent what context it already has and how to process jobs.",
    text: buildReactorSystemPrompt(PLACEHOLDER),
  });

  entries.push({
    title: "Reactor User Prompt (template)",
    source: "src/core/reactor/prompts.ts → buildReactorUserPrompt()",
    scope: "The user message sent to the batch job agent. Job descriptions (XML + inlined refs + schema instructions) are interpolated into this template.",
    text: buildReactorUserPrompt(["<job-paths>"], ["<job-descriptions>"]),
  });

  entries.push({
    title: "Chat System Prompt",
    source: "src/core/chat/session/index.ts → CHAT_SYSTEM_PROMPT",
    scope: "System prompt for the persistent web UI chat session. Active whenever the user is chatting via the main chat page.",
    text: CHAT_SYSTEM_PROMPT,
  });

  entries.push({
    title: "Chat Thread System Prompt",
    source: "src/core/chat/session/thread.ts → buildThreadSystemPrompt()",
    scope: "System prompt for per-thread chat sessions (e.g. Telegram threads). Each thread gets its own long-lived Claude process with this prompt.",
    text: buildThreadSystemPrompt({
      threadRef: "${threadRef}",
      chatDescription: "${chatDescription}",
      sessionViewBaseUrl: "${sessionViewBaseUrl}",
    }),
  });

  entries.push({
    title: "Commit Nudge Prompt",
    source: "src/core/agent/index.ts → COMMIT_NUDGE_PROMPT",
    scope: "Sent as a follow-up user message when an agent session ends with uncommitted changes. Resumes the session to force a commit.",
    text: COMMIT_NUDGE_PROMPT,
  });

  // ── 1b. Single-purpose subagent prompts ──────────────────────────
  // Tool-scoped LLM passes with their own system prompt, spawned outside
  // the reactor/chat loop for one specific judgment or extraction.

  entries.push({
    title: "Retro Observer System Prompt",
    source: "src/core/retro/observer.ts → OBSERVER_SYSTEM_PROMPT",
    scope: "System prompt for the retrospective observer — one tool-less LLM pass (cheap tier) per chat session during a retro scan, extracting what the boxholder implicitly taught the assistant into structured observations.",
    text: OBSERVER_SYSTEM_PROMPT,
  });

  entries.push({
    title: "Scenario Validator System Prompt",
    source: "src/scenario/runner.ts → VALIDATION_SYSTEM_PROMPT",
    scope: "System prompt for a scenario step's `prompt`-type validation check (non-dry-run): a fresh agent inspects the box state and answers PASS/FAIL against the check's described condition.",
    text: VALIDATION_SYSTEM_PROMPT,
  });

  entries.push({
    title: "Procedure Judge System Prompt (template)",
    source: "src/core/procedure/engine-validate-model.ts → buildJudgePrompt()",
    scope: "System prompt for a procedure `validate` phase's model-evaluated instruction check (defaults to sonnet, fail-closed). The step's instructions, `whys:`, and git diff are interpolated; the model returns a structured pass/fail verdict.",
    text: buildJudgePrompt({
      instructions: ["${instruction}"],
      whys: ["${why}"],
      diff: "${diff}",
    }),
  });

  entries.push({
    title: "Triage System Prompt (template)",
    source: "src/core/triage/index.ts → buildTriageSystemPrompt()",
    scope: "System prompt for the triage subagent (`cb wakeup` preprocessing): categorizes each staged inbox item with a confidence level. The box's compiled per-landmark triage instructions are interpolated as the ruleset.",
    text: buildTriageSystemPrompt({ doc: "${triageInstructions}", categories: [] }),
  });

  // ── 2. Schema instructions ───────────────────────────────────────

  for (const schema of cardSchemas) {
    if (!schema.instructions) continue;
    entries.push({
      title: `Schema: ${schema.type}`,
      source: `src/schemas/ → ${schema.type} schema instructions`,
      scope: `Injected into agent context when processing a \`*.${schema.type}.card\` file. Delivered two ways: (1) appended to the job description in batch processing, and (2) auto-loaded as a .claude/rules/ file (generated when \`cb init\` runs) matching \`**/*.${schema.type}.card\`.`,
      text: schema.instructions,
    });
  }

  // ── 4. Connector rules ───────────────────────────────────────────

  for (const rule of connectorRules) {
    entries.push({
      title: `Connector Rule: ${rule.name}`,
      source: "src/core/init-rules.ts → connectorRules[]",
      scope: `Auto-loaded as a .claude/rules/ file when agents read/edit files matching: ${rule.paths.join(", ")}`,
      text: rule.instructions,
    });
  }

  // ── 5. Procedure templates ───────────────────────────────────────

  try {
    const files = await fs.readdir(TEMPLATES_DIR);
    const procedureFiles = files.filter((f) => f.endsWith(".procedure.card")).toSorted();

    for (const file of procedureFiles) {
      const content = await fs.readFile(path.join(TEMPLATES_DIR, file), "utf-8");
      const name = file.replace(".procedure.card", "");
      entries.push({
        title: `Procedure: ${name}`,
        source: `templates/procedures/${file}`,
        scope: `Installed into boxes by \`cb init\`. Executed via \`cb procedure run ${name}\`. Each <agent> element within <step>/<run> is a separate agent session with its own system prompt. The procedure engine prepends a context block (date, run path, step ID) to each agent prompt.`,
        text: content,
      });
    }
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Could not read procedure templates dir ${TEMPLATES_DIR}, skipping:`, e);
    }
  }

  // ── 6. Procedure context block (template) ────────────────────────

  entries.push({
    title: "Procedure Context Block (template)",
    source: "src/core/procedure/engine.ts → buildContextBlock()",
    scope: "Prepended to every procedure agent's system prompt. Provides the agent with the current date, run card path, step ID, and any precheck output or runtime directive.",
    text: `# Context

Current date: \${date}
Procedure run: \${runCardPath}
Step: \${stepId} (defined at \${procedurePath} \${stepLineRange})

<precheck>
\${precheckOutput}
</precheck>

<directive>
\${directive}
</directive>`,
  });

  return entries;
}
