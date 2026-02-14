/**
 * cb pair - Manage dropbox pairing for browser message relay.
 *
 * Subcommands:
 *   cb pair create --url <worker-url>  Create channel + generate pairing code
 *   cb pair status                     Show current pairing status
 */

import { Command } from "commander";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createChannel, generatePairingCode } from "callback-dropbox/client";
import { requireBoxRoot } from "../lib/paths.js";
import type { DropboxConfig } from "../../connectors/dropbox.js";

function configPath(boxRoot: string): string {
  return path.join(boxRoot, "config/connectors/dropbox.secret.json");
}

async function loadConfig(boxRoot: string): Promise<DropboxConfig | null> {
  try {
    const content = await fs.readFile(configPath(boxRoot), "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function saveConfig(boxRoot: string, config: DropboxConfig): Promise<void> {
  const dir = path.dirname(configPath(boxRoot));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath(boxRoot), JSON.stringify(config, null, 2));
}

export const pairCommand = new Command("pair")
  .description("Manage dropbox pairing for browser message relay");

pairCommand
  .command("create")
  .description("Create a new channel and generate a pairing code")
  .requiredOption("--url <worker-url>", "Dropbox worker URL")
  .action(async (options: { url: string }) => {
    const boxRoot = await requireBoxRoot();
    const workerUrl = options.url.replace(/\/$/, "");

    console.log("Creating channel...");
    const { channelId, apiKey, channelKey } = await createChannel(workerUrl);

    console.log("Generating pairing code...");
    const { code, expiresAt } = await generatePairingCode({
      workerUrl,
      apiKey,
      channelId,
      channelKey,
    });

    const config: DropboxConfig = {
      workerUrl,
      channelId,
      apiKey,
      channelKey,
    };
    await saveConfig(boxRoot, config);

    const expiresIn = Math.round(
      (new Date(expiresAt).getTime() - Date.now()) / 1000 / 60
    );

    console.log(`\nPairing code: ${code}`);
    console.log(`Expires in ~${expiresIn} minutes (${expiresAt})`);
    console.log("\nConfig saved to config/connectors/dropbox.secret.json");
    console.log("(This file is gitignored — credentials stay local.)");
  });

pairCommand
  .command("status")
  .description("Show current pairing status")
  .action(async () => {
    const boxRoot = await requireBoxRoot();
    const config = await loadConfig(boxRoot);

    if (!config) {
      console.log("Not paired. Run: cb pair create --url <worker-url>");
      return;
    }

    console.log(`Paired to: ${config.workerUrl}`);
    console.log(`Channel:   ${config.channelId}`);

    // Try a test poll to verify connectivity
    try {
      const { DropboxClient } = await import("callback-dropbox/client");
      const client = new DropboxClient({
        url: config.workerUrl,
        apiKey: config.apiKey,
        channelKey: config.channelKey,
      });
      const messages = await client.poll();
      console.log(`Status:    connected (${messages.length} pending message(s))`);
    } catch (err) {
      console.log(`Status:    error — ${(err as Error).message}`);
    }
  });
