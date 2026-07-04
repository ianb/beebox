/**
 * Triage stage — the second stage of the triage pipeline.
 *
 * Reads intake-complete items from `inbox/staged/`, compiles the
 * triage-instructions doc from landmarks' `destinations:` frontmatter
 * (entries scoped `for: [triage]`), runs the triage subagent against the
 * batch, and applies its decisions via the routing module.
 *
 * See `docs/triage-design.md` §Triage (stage 2).
 */

import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { getBoxDir } from "../cli/lib/paths.js";
import { createAgent } from "./agent.js";
import {
  compileTriageInstructions,
  type CompiledTriageInstructions,
  type TriageCategory,
} from "./triage-instructions.js";
import {
  applyTriage,
  type TriageApplication,
  type TriageDecision,
} from "./triage-routing.js";

class TriageAgentFailedError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(`triage agent failed: ${detail}`);
    this.name = "TriageAgentFailedError";
    this.detail = detail;
  }
}

/**
 * Maximum bytes of file content included per item in the triage
 * prompt. Items larger than this are truncated with an ellipsis.
 */
const ITEM_CONTENT_LIMIT = 4000;

interface StagedItem {
  file: string;
  content: string;
  truncated: boolean;
}

async function listStagedItems(boxRoot: string): Promise<StagedItem[]> {
  const stagedDir = getBoxDir(boxRoot, "inboxStaged");
  let entries: Dirent[];
  try {
    entries = await fs.readdir(stagedDir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const items: StagedItem[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const full = path.join(stagedDir, entry.name);
    const raw = await fs.readFile(full, "utf-8").catch(() => "");
    const truncated = raw.length > ITEM_CONTENT_LIMIT;
    const content = truncated ? raw.slice(0, ITEM_CONTENT_LIMIT) + "\n...[truncated]" : raw;
    items.push({ file: entry.name, content, truncated });
  }
  return items;
}

const DecisionSchema = z.object({
  file: z.string(),
  category: z.string().nullable(),
  confidence: z.enum(["confident", "probable", "guess"]),
  reason: z.string(),
});

const TriageResponseSchema = z.object({
  decisions: z.array(DecisionSchema),
});

type TriageResponse = z.infer<typeof TriageResponseSchema>;

function systemPrompt(instructions: CompiledTriageInstructions): string {
  return [
    "You are the triage agent for a Callback Box.",
    "",
    "Your job: for each staged item, choose one category and a confidence level.",
    "",
    "Confidence levels:",
    "- `confident` — the rules clearly say this item belongs in the chosen category. No further review needed.",
    "- `probable` — the rules likely fit, but it's a judgment call worth flagging for review.",
    "- `guess` — you don't have enough signal to commit. Set `category` to null. The boxholder will be asked.",
    "",
    "Return ONE decision per item, in the same order as the input list. Do not invent categories — only the names listed below are valid.",
    "",
    instructions.doc,
  ].join("\n");
}

function userPrompt(items: StagedItem[]): string {
  const lines: string[] = [];
  lines.push("Triage the following staged items.");
  lines.push("");
  for (const item of items) {
    lines.push(`### \`${item.file}\``);
    lines.push("");
    lines.push("```");
    lines.push(item.content);
    lines.push("```");
    lines.push("");
  }
  lines.push(
    "Return a JSON object `{ decisions: [...] }` with one decision per item, in input order.",
  );
  return lines.join("\n");
}

export interface RunTriageOptions {
  boxRoot: string;
  /** Optional override — useful for tests. Default: invokes the live subagent. */
  decide?: (
    items: StagedItem[],
    instructions: CompiledTriageInstructions,
  ) => Promise<TriageResponse>;
  dryRun?: boolean;
}

export interface TriageResult {
  /** Categories available to the triage agent on this pass. */
  categories: TriageCategory[];
  /** Per-item decision returned by the agent. */
  decisions: TriageDecision[];
  /** Per-item routing outcome. */
  applications: TriageApplication[];
  /** True if nothing was in `inbox/staged/`. */
  empty: boolean;
}

async function liveDecide(
  items: StagedItem[],
  { instructions, boxRoot }: { instructions: CompiledTriageInstructions; boxRoot: string },
): Promise<TriageResponse> {
  const agent = createAgent({ name: "triage" });
  const result = await agent.invokeStructured(TriageResponseSchema, {
    boxRoot,
    systemPrompt: systemPrompt(instructions),
    prompt: userPrompt(items),
  });
  if (!result.success || result.data === null) {
    throw new TriageAgentFailedError(result.error ?? "no data");
  }
  return result.data;
}

/**
 * Run one triage pass. Returns the agent's decisions and the routing
 * outcomes; the filesystem reflects the applications by the time this
 * returns.
 */
export async function runTriage(options: RunTriageOptions): Promise<TriageResult> {
  const items = await listStagedItems(options.boxRoot);
  const instructions = await compileTriageInstructions(options.boxRoot);

  if (items.length === 0) {
    return { categories: instructions.categories, decisions: [], applications: [], empty: true };
  }

  const decide =
    options.decide ?? ((i, instr) => liveDecide(i, { instructions: instr, boxRoot: options.boxRoot }));
  const response = await decide(items, instructions);

  // Align response with input order; missing files default to guess.
  const byFile = new Map(response.decisions.map((d) => [d.file, d]));
  const decisions: TriageDecision[] = items.map((item) => {
    const d = byFile.get(item.file);
    if (!d) {
      return {
        file: item.file,
        category: null,
        confidence: "guess",
        reason: "Triage agent did not return a decision for this item.",
      };
    }
    return d;
  });

  if (options.dryRun) {
    return {
      categories: instructions.categories,
      decisions,
      applications: [],
      empty: false,
    };
  }

  const applications = await applyTriage({
    boxRoot: options.boxRoot,
    decisions,
    categories: instructions.categories,
  });

  return { categories: instructions.categories, decisions, applications, empty: false };
}
