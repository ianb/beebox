/**
 * System state inspection.
 *
 * Provides utilities for querying the current state of the callback box,
 * used by both the CLI and webapp.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxDir, parseCardName, requireBoxRoot } from "../cli/lib/paths.js";
import { getStatus, getLog, type GitStatus, type GitLogEntry } from "../cli/lib/git.js";
import { createLoader } from "../cli/lib/loader.js";
import { getBoxMetadata } from "./box.js";
import type { ElementNode } from "cardworks";

export interface CardInfo {
  path: string;
  relativePath: string;
  name: string;
  type: string;
  tagName: string;
  status?: string | undefined;
}

export interface SystemState {
  boxRoot: string;
  boxVersion: string;
  created: string;
  git: GitStatus;
  inbox: CardInfo[];
  commands: CardInfo[];
  questions: CardInfo[];
  recentActivity: GitLogEntry[];
}

export interface PendingQuestion {
  path: string;
  prompt: string;
  options?: string[] | undefined;
}

export interface ContextOutput {
  summary: string;
  pendingQuestions: PendingQuestion[];
  inboxCount: number;
  commandCount: number;
}

/**
 * Scan a directory for card files.
 *
 * @param dir - Directory to scan
 * @param boxRoot - Box root for relative paths
 * @returns Array of card info
 */
async function scanCards(dir: string, boxRoot: string): Promise<CardInfo[]> {
  const cards: CardInfo[] = [];
  const loader = createLoader(boxRoot);

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return cards;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".card")) continue;

    const fullPath = path.join(dir, entry);
    const parsed = parseCardName(entry);
    if (!parsed) continue;

    try {
      const card = await loader.load(fullPath);
      const element = card.element;

      cards.push({
        path: fullPath,
        relativePath: path.relative(boxRoot, fullPath),
        name: parsed.name,
        type: parsed.type,
        tagName: element.tagName,
        status: element.attrs["status"],
      });
    } catch {
      // Skip invalid cards
      cards.push({
        path: fullPath,
        relativePath: path.relative(boxRoot, fullPath),
        name: parsed.name,
        type: parsed.type,
        tagName: "unknown",
        status: undefined,
      });
    }
  }

  return cards;
}

/**
 * Get the current system state.
 *
 * @param boxRoot - Optional box root (will be auto-detected if not provided)
 * @returns The system state
 */
export async function getSystemState(boxRoot?: string): Promise<SystemState> {
  const root = boxRoot ?? await requireBoxRoot();
  const metadata = await getBoxMetadata(root);

  if (!metadata) {
    throw new Error("Invalid callback box: missing marker file");
  }

  const [git, inbox, commands, questions, recentActivity] = await Promise.all([
    getStatus(root),
    scanCards(getBoxDir(root, "inbox"), root),
    scanCards(getBoxDir(root, "commands"), root),
    scanCards(getBoxDir(root, "questions"), root),
    getLog(root, 10),
  ]);

  return {
    boxRoot: root,
    boxVersion: metadata.version,
    created: metadata.created,
    git,
    inbox,
    commands,
    questions,
    recentActivity,
  };
}

/**
 * Generate context for an agent.
 *
 * This provides the information an agent needs to understand
 * what's happening and decide what to do next.
 *
 * @param boxRoot - Optional box root
 * @returns Context information
 */
export async function generateContext(boxRoot?: string): Promise<ContextOutput> {
  const root = boxRoot ?? await requireBoxRoot();
  const state = await getSystemState(root);
  const loader = createLoader(root);

  // Get pending questions with their prompts
  const pendingQuestions: PendingQuestion[] = [];

  for (const q of state.questions) {
    if (q.status !== "pending") continue;

    try {
      const card = await loader.load(q.path);
      const element = card.element;

      // Find prompt and options
      let prompt = "";
      let options: string[] | undefined;

      for (const child of element.children as ElementNode[]) {
        if (child.tagName === "prompt") {
          prompt = child.text ?? "";
        }
        if (child.tagName === "input") {
          const opts = (child.children as ElementNode[])
            .filter((c: ElementNode) => c.tagName === "option")
            .map((c: ElementNode) => c.text ?? "");
          if (opts.length > 0) {
            options = opts;
          }
        }
      }

      pendingQuestions.push({
        path: q.relativePath,
        prompt,
        options,
      });
    } catch {
      // Skip invalid cards
    }
  }

  // Build summary
  const parts: string[] = [];

  if (state.inbox.length > 0) {
    parts.push(`${state.inbox.length} item(s) in inbox`);
  }

  if (pendingQuestions.length > 0) {
    parts.push(`${pendingQuestions.length} pending question(s)`);
  }

  if (state.commands.length > 0) {
    const ready = state.commands.filter(c => c.status === "ready");
    parts.push(`${state.commands.length} command(s) (${ready.length} ready)`);
  }

  if (!state.git.clean) {
    const changes = state.git.modified.length + state.git.untracked.length;
    parts.push(`${changes} uncommitted change(s)`);
  }

  const summary = parts.length > 0
    ? parts.join(", ")
    : "System is idle - no pending items";

  return {
    summary,
    pendingQuestions,
    inboxCount: state.inbox.length,
    commandCount: state.commands.length,
  };
}
