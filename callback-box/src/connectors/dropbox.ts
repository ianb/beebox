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
import {
  DropboxClient,
  type DecryptedMessage,
  MemoMessageSchema,
  type MemoMessage,
  SaveToBriefMessageSchema,
  type SaveToBriefMessage,
} from "callback-dropbox/client";
import { CardLoader, type ElementNode } from "cardworks";
import {
  registerConnector,
  type Connector,
  type PullResult,
  type ExecuteResult,
} from "./index.js";
import { createDropboxMemoTemplate } from "../schemas/memo.js";
import { createNewsItemTemplate } from "../schemas/news-item.js";
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

function parseMemoMessage(data: unknown): MemoMessage | null {
  // Accept canonical "memo" type
  const result = MemoMessageSchema.safeParse(data);
  if (result.success) return result.data;
  // Backward compat: accept legacy "message" type
  if (data && typeof data === "object" && (data as Record<string, unknown>).type === "message") {
    const patched = { ...data as Record<string, unknown>, type: "memo" as const };
    const retry = MemoMessageSchema.safeParse(patched);
    if (retry.success) return retry.data;
  }
  return null;
}

function parseSaveToBriefMessage(data: unknown): SaveToBriefMessage | null {
  const result = SaveToBriefMessageSchema.safeParse(data);
  if (result.success) return result.data;
  return null;
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
  handles: string[] = ["open-tab"];
  produces = ["memo", "news-item"];

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

      for (const msg of messages) {
        try {
          const result = this.messageToCard(msg);
          if (!result) {
            // Unknown message type — skip, don't delete (might be handled later)
            continue;
          }

          const timestamp = new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .slice(0, 19);
          const label = this.messageLabel(msg);
          const dir = result.type === "news-item"
            ? path.join(this.boxRoot, "box/inbox/news")
            : path.join(this.boxRoot, "box/inbox");
          await fs.mkdir(dir, { recursive: true });
          const ext = result.type === "news-item" ? "news-item.card" : "memo.card";
          const filename = `${safeFilename(label)}_${timestamp}.${ext}`;
          const cardPath = path.join(dir, filename);

          await fs.writeFile(cardPath, result.content);
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
        message: `Pull ${created.length} item(s) from dropbox`,
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

  private messageToCard(msg: DecryptedMessage): { content: string; type: "memo" | "news-item" } | null {
    const saveToBrief = parseSaveToBriefMessage(msg.data);
    if (saveToBrief) {
      return {
        content: createNewsItemTemplate({
          title: saveToBrief.title,
          link: saveToBrief.url,
          published: saveToBrief.timestamp || msg.createdAt,
          feedTitle: "Saved from browser",
          guid: saveToBrief.url,
          source: "user",
        }),
        type: "news-item",
      };
    }

    const memo = parseMemoMessage(msg.data);
    if (memo) {
      const opts: Parameters<typeof createDropboxMemoTemplate>[0] = {
        content: memo.text,
        timestamp: memo.timestamp || msg.createdAt,
      };
      // Support both nested context object and flat url field
      if (memo.context) {
        const ctx: { url?: string; title?: string; selectedText?: string } = {};
        if (memo.context.url) ctx.url = memo.context.url;
        if (memo.context.title) ctx.title = memo.context.title;
        if (memo.context.selectedText) ctx.selectedText = memo.context.selectedText;
        opts.context = ctx;
      } else if (memo.url) {
        opts.context = { url: memo.url };
      }
      return { content: createDropboxMemoTemplate(opts), type: "memo" };
    }
    // Unknown message type
    return null;
  }

  private messageLabel(msg: DecryptedMessage): string {
    const saveToBrief = parseSaveToBriefMessage(msg.data);
    if (saveToBrief) {
      return saveToBrief.title.slice(0, 50);
    }
    const memo = parseMemoMessage(msg.data);
    if (memo) {
      return memo.text.slice(0, 50);
    }
    return "Dropbox_Message";
  }

  async execute(cardPath: string, dryRun: boolean): Promise<ExecuteResult> {
    const config = await this.loadConfig();
    if (!config) {
      return { success: false, error: "Dropbox connector not configured" };
    }

    // Load and parse the command card
    const loader = new CardLoader(this.boxRoot);
    const card = await loader.load(cardPath);
    const el = card.element;

    const cardType = el.attrs["type"];
    if (cardType !== "open-tab") {
      return { success: false, error: `Unsupported command type: ${cardType}` };
    }

    // Extract child elements
    const children = el.children as ElementNode[];
    const url = children.find((c) => c.tagName === "url")?.text?.trim();
    const title = children.find((c) => c.tagName === "title")?.text?.trim();
    const message = children.find((c) => c.tagName === "message")?.text?.trim();

    if (!url || !title || !message) {
      return { success: false, error: "Command card missing required fields (url, title, message)" };
    }

    if (dryRun) {
      return { success: true, details: { type: "open-tab", url, title, message } };
    }

    const client = new DropboxClient({
      url: config.workerUrl,
      apiKey: config.apiKey,
      channelKey: config.channelKey,
    });

    await client.send(
      { type: "open-tab", url, title, message },
      { sender: "agent", contentType: "application/json" }
    );

    return { success: true };
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
