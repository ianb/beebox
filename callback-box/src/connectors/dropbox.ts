/**
 * Dropbox Connector - Polls callback-dropbox relay for incoming messages.
 *
 * Configuration (secrets) stored in config/connectors/dropbox.secret.json:
 * {
 *   "workerUrl": "https://callback-dropbox.xxx.workers.dev",
 *   "channelId": "...",
 *   "apiKey": "sk-...",
 *   "channelKey": "base64..."
 * }
 *
 * State stored in config/connectors/dropbox-state.json:
 * { "lastPollTime": "2026-01-01T00:00:00Z" }
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DropboxClient, type DecryptedMessage } from "callback-dropbox/client";
import {
  registerConnector,
  type Connector,
  type PullResult,
  type ExecuteResult,
} from "./index.js";
import { createDropboxMemoTemplate } from "../schemas/memo.js";
import { stageFiles, commit } from "../cli/lib/git.js";

export interface DropboxConfig {
  workerUrl: string;
  channelId: string;
  apiKey: string;
  channelKey: string;
}

interface DropboxState {
  lastPollTime?: string;
}

interface MemoMessage {
  type: string;
  text: string;
  url?: string;
  context?: {
    url?: string;
    title?: string;
    selectedText?: string;
  };
  timestamp?: string;
}

function isMemoMessage(data: unknown): data is MemoMessage {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (d.type === "memo" || d.type === "message") && typeof d.text === "string";
}

function safeFilename(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 50)
    || "Memo";
}

class DropboxConnector implements Connector {
  name = "dropbox";
  handles: string[] = [];
  produces = ["memo"];

  private boxRoot: string;

  constructor(boxRoot: string) {
    this.boxRoot = boxRoot;
  }

  private configPath(): string {
    return path.join(this.boxRoot, "config/connectors/dropbox.secret.json");
  }

  private statePath(): string {
    return path.join(this.boxRoot, "config/connectors/dropbox-state.json");
  }

  async loadConfig(): Promise<DropboxConfig | null> {
    try {
      const content = await fs.readFile(this.configPath(), "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async loadState(): Promise<DropboxState> {
    try {
      const content = await fs.readFile(this.statePath(), "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private async saveState(state: DropboxState): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath()), { recursive: true });
    await fs.writeFile(this.statePath(), JSON.stringify(state, null, 2));
  }

  async pull(): Promise<PullResult> {
    const config = await this.loadConfig();
    if (!config) {
      return { success: true, created: [], updated: [] };
    }

    const client = new DropboxClient({
      url: config.workerUrl,
      apiKey: config.apiKey,
      channelKey: config.channelKey,
    });

    const state = await this.loadState();
    const created: string[] = [];
    const errors: string[] = [];

    try {
      const messages = await client.poll(
        state.lastPollTime ? { since: state.lastPollTime } : {}
      );

      if (messages.length === 0) {
        return { success: true, created: [], updated: [] };
      }

      const inboxDir = path.join(this.boxRoot, "box/inbox");
      await fs.mkdir(inboxDir, { recursive: true });

      for (const msg of messages) {
        try {
          const cardContent = this.messageToCard(msg);
          if (!cardContent) {
            // Unknown message type — skip, don't delete (might be handled later)
            continue;
          }

          const timestamp = new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .slice(0, 19);
          const label = this.messageLabel(msg);
          const filename = `${safeFilename(label)}_${timestamp}.memo.card`;
          const cardPath = path.join(inboxDir, filename);

          await fs.writeFile(cardPath, cardContent);
          created.push(path.relative(this.boxRoot, cardPath));

          await client.deleteMessage(msg.id);
        } catch (err) {
          errors.push(`Failed to process message ${msg.id}: ${(err as Error).message}`);
        }
      }

      // Update last poll time to the most recent message
      const latestTime = messages
        .map((m) => m.createdAt)
        .sort()
        .pop();
      if (latestTime) {
        state.lastPollTime = latestTime;
      }
    } catch (err) {
      errors.push(`Poll failed: ${(err as Error).message}`);
    }

    await this.saveState(state);

    if (created.length > 0) {
      await stageFiles(this.boxRoot, created);
      await commit(this.boxRoot, {
        message: `Pull ${created.length} memo(s) from dropbox`,
        trailers: {
          "Pulled-By": "dropbox-connector",
        },
      });
    }

    const result: PullResult = {
      success: errors.length === 0,
      created,
      updated: [],
    };
    if (errors.length > 0) {
      result.error = errors.join("; ");
    }
    return result;
  }

  private messageToCard(msg: DecryptedMessage): string | null {
    if (isMemoMessage(msg.data)) {
      const opts: Parameters<typeof createDropboxMemoTemplate>[0] = {
        content: msg.data.text,
        timestamp: msg.data.timestamp || msg.createdAt,
      };
      // Support both nested context object and flat url field
      if (msg.data.context) {
        opts.context = msg.data.context;
      } else if (msg.data.url) {
        opts.context = { url: msg.data.url };
      }
      return createDropboxMemoTemplate(opts);
    }
    // Unknown message type
    return null;
  }

  private messageLabel(msg: DecryptedMessage): string {
    if (isMemoMessage(msg.data)) {
      return msg.data.text.slice(0, 50);
    }
    return "Dropbox_Message";
  }

  async execute(_cardPath: string, _dryRun: boolean): Promise<ExecuteResult> {
    return {
      success: false,
      error: "Dropbox connector does not support command execution yet",
    };
  }
}

/**
 * Create and register the Dropbox connector for a box.
 */
export function createDropboxConnector(boxRoot: string): Connector {
  const connector = new DropboxConnector(boxRoot);
  registerConnector(connector);
  return connector;
}
