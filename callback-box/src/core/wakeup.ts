/**
 * Wakeup processing logic.
 *
 * This module contains the core wakeup logic that can be called
 * from both the CLI and the web API.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getSystemState, generateContext } from "./state.js";
import { stageAll, commit, hasCommits, getStatus, stageFiles } from "../cli/lib/git.js";
import { createLoader } from "../cli/lib/loader.js";
import { runPreActions } from "./preactions/index.js";
import {
  runAgent,
  buildInboxProcessingPrompt,
  buildItemProcessingPrompt,
} from "./agent.js";
import { CardLoader } from "cardworks";

export interface WakeupOptions {
  dryRun?: boolean | undefined;
  onLog?: ((message: string) => void) | undefined;
}

export interface WakeupResult {
  success: boolean;
  phases: PhaseResult[];
  error?: string;
}

export interface PhaseResult {
  name: string;
  skipped?: boolean | undefined;
  message?: string | undefined;
  error?: string | undefined;
}

/**
 * Run the wakeup processing cycle.
 */
export async function runWakeup(
  boxRoot: string,
  options: WakeupOptions = {}
): Promise<WakeupResult> {
  const { dryRun = false, onLog = console.log } = options;
  const results: PhaseResult[] = [];

  try {
    // Get current state
    const state = await getSystemState(boxRoot);
    const context = await generateContext(boxRoot);

    onLog("Current state:");
    onLog(`  Inbox: ${state.inbox.length} item(s)`);
    onLog(`  Questions: ${state.questions.length} (${context.pendingQuestions.length} pending)`);
    onLog(`  Commands: ${state.commands.length}`);
    onLog(`  Git: ${state.git.clean ? "clean" : "uncommitted changes"}`);
    onLog("");

    // Phase 1: Run pre-actions
    onLog("[Run pre-actions]");
    if (dryRun) {
      onLog("  (dry run - skipping)");
      results.push({ name: "pre-actions", skipped: true });
    } else {
      const preActionResult = await runPreActionsPhase(boxRoot, state, onLog);
      results.push({ name: "pre-actions", ...preActionResult });
    }
    onLog("");

    // Phase 2: Check inbox
    onLog("[Check inbox]");
    if (dryRun) {
      onLog("  (dry run - skipping)");
      results.push({ name: "check-inbox", skipped: true });
    } else {
      const inboxResult = await checkInboxPhase(boxRoot, state, onLog);
      results.push({ name: "check-inbox", ...inboxResult });
    }
    onLog("");

    // Phase 3: Process pending questions
    onLog("[Process pending questions]");
    if (dryRun) {
      onLog("  (dry run - skipping)");
      results.push({ name: "process-questions", skipped: true });
    } else {
      const questionsResult = await processQuestionsPhase(context, onLog);
      results.push({ name: "process-questions", ...questionsResult });
    }
    onLog("");

    // Phase 4: Execute ready commands
    onLog("[Execute ready commands]");
    if (dryRun) {
      onLog("  (dry run - skipping)");
      results.push({ name: "execute-commands", skipped: true });
    } else {
      const commandsResult = await executeCommandsPhase(state, onLog);
      results.push({ name: "execute-commands", ...commandsResult });
    }
    onLog("");

    // Phase 5: Expire old briefs
    onLog("[Expire old briefs]");
    if (dryRun) {
      onLog("  (dry run - skipping)");
      results.push({ name: "expire-briefs", skipped: true });
    } else {
      const expireResult = await expireBriefsPhase(boxRoot, onLog);
      results.push({ name: "expire-briefs", ...expireResult });
    }
    onLog("");

    // Phase 6: Run tailing phase
    onLog("[Run tailing phase]");
    if (dryRun) {
      onLog("  (dry run - skipping)");
      results.push({ name: "tailing", skipped: true });
    } else {
      const tailingResult = await runTailingPhase(onLog);
      results.push({ name: "tailing", ...tailingResult });
    }
    onLog("");

    // Commit any remaining changes
    if (!dryRun) {
      const status = await getStatus(boxRoot);
      if (!status.clean && (await hasCommits(boxRoot))) {
        onLog("[Committing changes]");
        await stageAll(boxRoot);
        await commit(boxRoot, {
          message: "Wakeup processing cycle",
          trailers: {
            "Triggered-By": "cb wakeup",
          },
        });
        onLog("  Changes committed");
      }
    }

    return { success: true, phases: results };
  } catch (error) {
    return {
      success: false,
      phases: results,
      error: (error as Error).message,
    };
  }
}

/**
 * Run pre-actions phase.
 */
async function runPreActionsPhase(
  boxRoot: string,
  state: Awaited<ReturnType<typeof getSystemState>>,
  onLog: (msg: string) => void
): Promise<Omit<PhaseResult, "name">> {
  if (state.inbox.length === 0) {
    onLog("  No items to prepare");
    return { message: "No items to prepare" };
  }

  const loader = createLoader(boxRoot);
  let actionsRun = 0;

  for (const item of state.inbox) {
    try {
      const card = await loader.load(item.path);
      const results = await runPreActions({
        boxRoot,
        loader,
        card,
        cardPath: item.path,
      });

      if (results.length > 0) {
        actionsRun += results.length;
      }
    } catch (error) {
      onLog(`  Error processing ${item.relativePath}: ${(error as Error).message}`);
    }
  }

  if (actionsRun === 0) {
    onLog("  No pre-actions needed");
    return { message: "No pre-actions needed" };
  }

  // Commit pre-action changes
  const status = await getStatus(boxRoot);
  if (!status.clean) {
    await stageAll(boxRoot);
    await commit(boxRoot, {
      message: "Pre-action processing",
      trailers: {
        "Triggered-By": "cb wakeup",
        Phase: "pre-actions",
      },
    });
    onLog("  Pre-action changes committed");
  }

  return { message: `Ran ${actionsRun} pre-action(s)` };
}

/**
 * Check inbox phase - invokes agent to process inbox items.
 */
async function checkInboxPhase(
  boxRoot: string,
  state: Awaited<ReturnType<typeof getSystemState>>,
  onLog: (msg: string) => void
): Promise<Omit<PhaseResult, "name">> {
  // Filter to only new items
  const newItems = state.inbox.filter((item) => item.status === "new");

  if (newItems.length === 0) {
    onLog("  No new items in inbox");
    return { message: "No new items in inbox" };
  }

  // Limit batch size to avoid expensive agent runs
  const BATCH_SIZE = 10;
  const itemsToProcess = newItems.slice(0, BATCH_SIZE);
  const remaining = newItems.length - itemsToProcess.length;

  if (remaining > 0) {
    onLog(`  Processing ${itemsToProcess.length} of ${newItems.length} new item(s) (${remaining} remaining for next run)`);
  } else {
    onLog(`  Processing ${itemsToProcess.length} new item(s) with agent...`);
  }

  const systemPrompt = buildInboxProcessingPrompt(boxRoot);
  const itemPaths = itemsToProcess.map((item) => item.relativePath);
  const userPrompt = buildItemProcessingPrompt(itemPaths);

  try {
    const result = await runAgent({
      boxRoot,
      systemPrompt,
      prompt: userPrompt,
      onOutput: (text) => {
        // Stream output to log
        for (const line of text.split("\n")) {
          if (line.trim()) {
            onLog(`  > ${line}`);
          }
        }
      },
    });

    if (!result.success) {
      onLog(`  Agent error: ${result.error}`);
      return {
        message: `Agent failed: ${result.error}`,
        error: result.error,
      };
    }

    // Commit any changes made by the agent
    const status = await getStatus(boxRoot);
    if (!status.clean) {
      await stageAll(boxRoot);
      await commit(boxRoot, {
        message: `Process ${itemsToProcess.length} inbox item(s)`,
        trailers: {
          "Triggered-By": "cb wakeup",
          Phase: "check-inbox",
          "Items-Processed": String(itemsToProcess.length),
        },
      });
      onLog("  Agent changes committed");
    }

    const msg = remaining > 0
      ? `Processed ${itemsToProcess.length} item(s), ${remaining} remaining`
      : `Processed ${itemsToProcess.length} item(s)`;
    return { message: msg };
  } catch (error) {
    const errMsg = (error as Error).message;
    onLog(`  Error running agent: ${errMsg}`);
    return { message: `Agent error: ${errMsg}`, error: errMsg };
  }
}

/**
 * Process questions phase - simulated for now.
 */
async function processQuestionsPhase(
  context: Awaited<ReturnType<typeof generateContext>>,
  onLog: (msg: string) => void
): Promise<Omit<PhaseResult, "name">> {
  if (context.pendingQuestions.length === 0) {
    onLog("  No pending questions");
    return { message: "No pending questions" };
  }

  for (const q of context.pendingQuestions) {
    onLog(`  Waiting for answer: ${q.path}`);
    onLog(`    "${q.prompt}"`);
  }

  return { message: `${context.pendingQuestions.length} pending question(s)` };
}

/**
 * Execute commands phase - simulated for now.
 */
async function executeCommandsPhase(
  state: Awaited<ReturnType<typeof getSystemState>>,
  onLog: (msg: string) => void
): Promise<Omit<PhaseResult, "name">> {
  const ready = state.commands.filter((c) => c.status === "ready");

  if (ready.length === 0) {
    onLog("  No ready commands");
    return { message: "No ready commands" };
  }

  for (const cmd of ready) {
    onLog(`  Would execute: ${cmd.relativePath}`);
  }

  return { message: `${ready.length} command(s) ready (execution not yet implemented)` };
}

/**
 * Expire old briefs phase.
 *
 * Briefs older than 1 week are automatically moved to the archive
 * with read-reason="expired" to distinguish them from user-read briefs.
 */
async function expireBriefsPhase(
  boxRoot: string,
  onLog: (msg: string) => void
): Promise<Omit<PhaseResult, "name">> {
  const EXPIRY_DAYS = 7;
  const now = Date.now();
  const expiryMs = EXPIRY_DAYS * 24 * 60 * 60 * 1000;

  const unreadDir = path.join(boxRoot, "box/output/briefs");
  const archiveDir = path.join(boxRoot, "store/archive/briefs");

  let files: string[];
  try {
    files = await fs.readdir(unreadDir);
  } catch {
    onLog("  No briefs directory");
    return { message: "No briefs to expire" };
  }

  const briefFiles = files.filter((f) => f.endsWith(".news-brief.card"));
  if (briefFiles.length === 0) {
    onLog("  No unread briefs");
    return { message: "No briefs to expire" };
  }

  let expiredCount = 0;
  const filesToStage: string[] = [];

  for (const file of briefFiles) {
    const fullPath = path.join(unreadDir, file);

    // Check file modification time
    const stat = await fs.stat(fullPath);
    const age = now - stat.mtimeMs;

    if (age > expiryMs) {
      onLog(`  Expiring: ${file} (${Math.floor(age / (24 * 60 * 60 * 1000))} days old)`);

      // Add expiry attributes to the card
      try {
        const loader = new CardLoader(boxRoot);
        const card = await loader.load(fullPath);
        card.element.attrs["read-at"] = new Date().toISOString();
        card.element.attrs["read-reason"] = "expired";
        await loader.save(card);
      } catch (err) {
        onLog(`    Warning: Could not update card attributes: ${(err as Error).message}`);
      }

      // Move to archive
      await fs.mkdir(archiveDir, { recursive: true });
      const newPath = path.join(archiveDir, file);
      await fs.rename(fullPath, newPath);

      filesToStage.push(`box/output/briefs/${file}`);
      filesToStage.push(`store/archive/briefs/${file}`);
      expiredCount++;
    }
  }

  if (expiredCount === 0) {
    onLog("  No briefs old enough to expire");
    return { message: "No briefs expired" };
  }

  // Stage and commit
  await stageFiles(boxRoot, filesToStage);
  await commit(boxRoot, {
    message: `Expire ${expiredCount} old brief(s)`,
    trailers: {
      "Triggered-By": "cb wakeup",
      Phase: "expire-briefs",
      "Briefs-Expired": String(expiredCount),
    },
  });

  onLog(`  Expired ${expiredCount} brief(s)`);
  return { message: `Expired ${expiredCount} brief(s)` };
}

/**
 * Run tailing phase - simulated for now.
 */
async function runTailingPhase(
  onLog: (msg: string) => void
): Promise<Omit<PhaseResult, "name">> {
  onLog("  Would run tailing phase:");
  onLog("    - Update indexes");
  onLog("    - Schedule next wakeup");
  onLog("    - Clean up old archives");

  return { message: "Tailing phase not yet implemented" };
}
