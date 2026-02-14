/**
 * cb execute-commands - Execute all ready command cards.
 *
 * Scans box/commands/ for cards with status="ready", dispatches each
 * to the appropriate connector, and archives successful ones.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { CardLoader } from "cardworks";
import { requireBoxRoot } from "../lib/paths.js";
import { stageFiles, commit } from "../lib/git.js";
import { createRssConnector } from "../../connectors/rss.js";
import { createDropboxConnector } from "../../connectors/dropbox.js";
import { createRaindropConnector } from "../../connectors/raindrop.js";
import { getConnectorForCardType } from "../../connectors/index.js";

export interface ExecuteCommandsResult {
  sent: string[];
  failed: string[];
  skipped: string[];
}

export async function executeCommands(
  boxRoot: string,
  options: { dryRun?: boolean; onLog?: (msg: string) => void } = {}
): Promise<ExecuteCommandsResult> {
  const { dryRun = false, onLog = console.log } = options;

  // Initialize connectors so the registry is populated
  createRssConnector(boxRoot);
  createDropboxConnector(boxRoot);
  createRaindropConnector(boxRoot);

  const commandsDir = path.join(boxRoot, "box/commands");
  const archiveDir = path.join(boxRoot, "store/archive/commands");

  let entries: string[];
  try {
    entries = await fs.readdir(commandsDir);
  } catch {
    onLog("No commands directory");
    return { sent: [], failed: [], skipped: [] };
  }

  const cardFiles = entries.filter((f) => f.endsWith(".command.card"));
  if (cardFiles.length === 0) {
    onLog("No command cards found");
    return { sent: [], failed: [], skipped: [] };
  }

  const loader = new CardLoader(boxRoot);
  const sent: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  const filesToStage: string[] = [];

  for (const file of cardFiles) {
    const cardPath = path.join(commandsDir, file);
    const relativePath = path.relative(boxRoot, cardPath);

    try {
      const card = await loader.load(cardPath);
      const el = card.element;

      if (el.attrs["status"] !== "ready") {
        onLog(`  Skipping ${file} (status=${el.attrs["status"] ?? "none"})`);
        skipped.push(relativePath);
        continue;
      }

      const cardType = el.attrs["type"];
      if (!cardType) {
        onLog(`  Skipping ${file} (no type attribute)`);
        skipped.push(relativePath);
        continue;
      }

      const connector = getConnectorForCardType(cardType);
      if (!connector) {
        onLog(`  No connector handles type "${cardType}" for ${file}`);
        failed.push(relativePath);
        continue;
      }

      onLog(`  Executing ${file} via ${connector.name}...`);

      if (dryRun) {
        onLog("    (dry run - would execute)");
        skipped.push(relativePath);
        continue;
      }

      const result = await connector.execute(cardPath, false);

      if (result.success) {
        onLog("    Sent successfully");

        // Update card status and archive it
        el.attrs["status"] = "sent";
        el.attrs["sent-at"] = new Date().toISOString();
        await loader.save(card);

        await fs.mkdir(archiveDir, { recursive: true });
        const archivePath = path.join(archiveDir, file);
        await fs.rename(cardPath, archivePath);

        filesToStage.push(relativePath);
        filesToStage.push(path.relative(boxRoot, archivePath));
        sent.push(relativePath);
      } else {
        onLog(`    Failed: ${result.error}`);

        el.attrs["status"] = "failed";
        el.attrs["error"] = result.error ?? "Unknown error";
        await loader.save(card);

        filesToStage.push(relativePath);
        failed.push(relativePath);
      }
    } catch (err) {
      onLog(`  Error processing ${file}: ${(err as Error).message}`);
      failed.push(relativePath);
    }
  }

  // Commit changes if any commands were processed
  if (filesToStage.length > 0 && !dryRun) {
    await stageFiles(boxRoot, filesToStage);
    await commit(boxRoot, {
      message: `Execute ${sent.length} command(s)${failed.length > 0 ? `, ${failed.length} failed` : ""}`,
      trailers: {
        "Triggered-By": "cb execute-commands",
      },
    });
  }

  return { sent, failed, skipped };
}

export const executeCommandsCommand = new Command("execute-commands")
  .description("Execute all ready command cards")
  .option("--dry-run", "Show what would happen without executing")
  .action(async (options: { dryRun?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();

      console.log("Executing ready commands...");
      const result = await executeCommands(boxRoot, {
        dryRun: options.dryRun ?? false,
      });

      const parts: string[] = [];
      if (result.sent.length > 0) parts.push(`${result.sent.length} sent`);
      if (result.failed.length > 0) parts.push(`${result.failed.length} failed`);
      if (result.skipped.length > 0) parts.push(`${result.skipped.length} skipped`);

      if (parts.length === 0) {
        console.log("No commands to execute.");
      } else {
        console.log(`\nDone: ${parts.join(", ")}.`);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });
