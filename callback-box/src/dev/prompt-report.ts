#!/usr/bin/env tsx
/**
 * Prompt Report — generates a Markdown document listing every prompt,
 * instruction, and rule in the system, with context about when each is used.
 *
 * Usage:
 *   pnpm prompt-report
 *   pnpm prompt-report --output docs/prompts.md
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { cardSchemas } from "../schemas/registry.js";
import { buildReactorSystemPrompt, buildReactorUserPrompt } from "../core/reactor/prompts.js";
import { CHAT_SYSTEM_PROMPT } from "../core/chat-session.js";
import { buildThreadSystemPrompt } from "../core/chat-thread-session.js";
import { COMMIT_NUDGE_PROMPT } from "../core/agent.js";
import { connectorRules } from "../core/init-rules.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { wordCount } from "./lib/context-assembly.js";

const PLACEHOLDER = "${boxRoot}";
const TEMPLATES_DIR = path.join(PACKAGE_ROOT, "templates", "procedures");

// ─── Helpers ────────────────────────────────────────────────────────

function lineCount(text: string): number {
  return text.split("\n").length;
}

function fencePrompt(text: string): string {
  // Use a fenced block that won't collide with content
  const fence = text.includes("````") ? "`````" : "````";
  return `${fence}\n${text}\n${fence}`;
}

interface PromptEntry {
  /** Section heading */
  title: string;
  /** Source file (relative to callback-box/) */
  source: string;
  /** When/where this prompt is used */
  scope: string;
  /** The prompt text */
  text: string;
}

// ─── Collect all prompts ────────────────────────────────────────────

async function collectPrompts(): Promise<PromptEntry[]> {
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
    source: "src/core/chat-session.ts → CHAT_SYSTEM_PROMPT",
    scope: "System prompt for the persistent web UI chat session. Active whenever the user is chatting via the main chat page.",
    text: CHAT_SYSTEM_PROMPT,
  });

  entries.push({
    title: "Chat Thread System Prompt",
    source: "src/core/chat-thread-session.ts → buildThreadSystemPrompt()",
    scope: "System prompt for per-thread chat sessions (e.g. Telegram threads). Each thread gets its own long-lived Claude process with this prompt.",
    text: buildThreadSystemPrompt({
      threadRef: "${threadRef}",
      chatDescription: "${chatDescription}",
      sessionViewBaseUrl: "${sessionViewBaseUrl}",
    }),
  });

  entries.push({
    title: "Commit Nudge Prompt",
    source: "src/core/agent.ts → COMMIT_NUDGE_PROMPT",
    scope: "Sent as a follow-up user message when an agent session ends with uncommitted changes. Resumes the session to force a commit.",
    text: COMMIT_NUDGE_PROMPT,
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
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
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

// ─── Generate markdown ──────────────────────────────────────────────

function generateMarkdown(entries: PromptEntry[]): string {
  const lines: string[] = [];
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  lines.push("# Prompt Report");
  lines.push("");
  lines.push(`Generated: ${now}`);
  lines.push("");
  lines.push("This document lists every prompt, instruction, and rule in the callback-box system.");
  lines.push("It is auto-generated by `pnpm prompt-report` — do not edit by hand.");
  lines.push("");

  // Table of contents
  lines.push("## Table of Contents");
  lines.push("");

  // Group entries by category
  const categories = [
    { name: "Agent System Prompts", prefix: ["Reactor", "Chat", "Commit"] },
    { name: "Job-Specific Prompts", prefix: ["News", "Feedback", "Guide Revision"] },
    { name: "Schema Instructions", prefix: ["Schema:"] },
    { name: "Connector Rules", prefix: ["Connector"] },
    { name: "Procedure Templates", prefix: ["Procedure:"] },
    { name: "Procedure Infrastructure", prefix: ["Procedure Context"] },
  ];

  for (const cat of categories) {
    const catEntries = entries.filter((e) =>
      cat.prefix.some((p) => e.title.startsWith(p))
    );
    if (catEntries.length === 0) continue;

    lines.push(`### ${cat.name} (${catEntries.length})`);
    lines.push("");
    for (const entry of catEntries) {
      const anchor = entry.title.toLowerCase().replace(/[^\da-z]+/g, "-").replace(/-+$/, "");
      const words = wordCount(entry.text);
      lines.push(`- [${entry.title}](#${anchor}) — ${words} words`);
    }
    lines.push("");
  }

  // Totals
  const totalWords = entries.reduce((sum, e) => sum + wordCount(e.text), 0);
  const totalEntries = entries.length;
  lines.push(`**Total: ${totalEntries} prompts/instructions, ~${totalWords.toLocaleString()} words**`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Full entries
  for (const entry of entries) {
    lines.push(`## ${entry.title}`);
    lines.push("");
    lines.push(`**Source:** \`${entry.source}\``);
    lines.push("");
    lines.push(`**Scope:** ${entry.scope}`);
    lines.push("");
    lines.push(`**Size:** ${wordCount(entry.text)} words, ${lineCount(entry.text)} lines`);
    lines.push("");
    lines.push(fencePrompt(entry.text));
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Main ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let outputPath: string | null = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--output" && args[i + 1]) {
    outputPath = args[i + 1]!;
    i++;
  }
}

const entries = await collectPrompts();
const markdown = generateMarkdown(entries);

if (outputPath) {
  const resolved = path.resolve(outputPath);
  await fs.writeFile(resolved, markdown);
  console.log(`Wrote ${entries.length} prompts to ${resolved}`);
} else {
  // Default: write to docs/prompts.md
  const defaultPath = path.join(PACKAGE_ROOT, "docs", "prompts.md");
  await fs.writeFile(defaultPath, markdown);
  console.log(`Wrote ${entries.length} prompts to docs/prompts.md`);
}
