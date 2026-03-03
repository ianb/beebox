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
  SavePageMessageSchema,
  type SavePageMessage,
} from "callback-dropbox/client";
import {
  registerConnector,
  type Connector,
  type SyncResult,
} from "./index.js";
import { createDropboxMemoTemplate } from "../schemas/memo.js";
import { createNewsItemTemplate } from "../schemas/news-item.js";
import { createRecordTemplate } from "../schemas/record.js";
import { stageFiles, commit } from "../cli/lib/git.js";
import { createOrAppendIntakeJob } from "./intake-utils.js";
import { loadTransientState, saveTransientState } from "./transient-state.js";
import { safeFilename } from "./chat-utils.js";

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

function parseSavePageMessage(data: unknown): SavePageMessage | null {
  const result = SavePageMessageSchema.safeParse(data);
  if (result.success) return result.data;
  return null;
}



const TYPE_LABELS: Record<string, string> = {
  record: "Saved page",
  "news-item": "Brief",
  memo: "Memo",
};

interface DropboxNote {
  typeLabel: string;
  title: string;
}

function buildDropboxCommitMessage(notes: DropboxNote[]): string {
  const subject = `Pull ${notes.length} item${notes.length === 1 ? "" : "s"} from Dropbox`;
  if (notes.length === 0) return subject;

  const lines = [subject, ""];
  const cap = 5;
  for (const note of notes.slice(0, cap)) {
    lines.push(`- ${note.typeLabel}: "${note.title}"`);
  }
  if (notes.length > cap) {
    lines.push(`  + ${notes.length - cap} more`);
  }
  return lines.join("\n");
}

class DropboxConnector implements Connector {
  name = "dropbox";
  produces = ["memo", "news-item", "record"];
  triggeredBy?: string;

  private boxRoot: string;

  constructor(boxRoot: string) {
    this.boxRoot = boxRoot;
  }

  private configPath(): string {
    return path.join(this.boxRoot, "config/connectors/dropbox.secret.json");
  }

  async loadConfig(): Promise<DropboxConfig | null> {
    try {
      const content = await fs.readFile(this.configPath(), "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async sync(): Promise<SyncResult> {
    const config = await this.loadConfig();
    if (!config) {
      return { success: true, created: [], updated: [] };
    }

    const client = new DropboxClient({
      url: config.workerUrl,
      apiKey: config.apiKey,
      channelKey: config.channelKey,
    });

    const state = await loadTransientState<DropboxState>({
      boxRoot: this.boxRoot, connectorName: "dropbox", defaultValue: {},
    });
    const created: string[] = [];
    const errors: string[] = [];
    const notes: DropboxNote[] = [];

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
            .replace(/[.:]/g, "-")
            .slice(0, 19);
          const label = this.messageLabel(msg);
          const dir = result.dir
            ? path.join(this.boxRoot, result.dir)
            : result.type === "news-item"
              ? path.join(this.boxRoot, "box/inbox/news")
              : path.join(this.boxRoot, "box/inbox");
          await fs.mkdir(dir, { recursive: true });
          const extMap = { "news-item": "news-item.card", memo: "memo.card", record: "record.card" } as const;
          const ext = extMap[result.type];
          const baseName = `${safeFilename(label, "Memo")}_${timestamp}`;
          const filename = `${baseName}.${ext}`;
          const cardPath = path.join(dir, filename);

          await fs.writeFile(cardPath, result.content);
          created.push(path.relative(this.boxRoot, cardPath));

          // Accumulate note for commit message
          notes.push({
            typeLabel: TYPE_LABELS[result.type] || result.type,
            title: label,
          });

          // Write frozen HTML sidecar if present
          if (result.frozenHtml) {
            const frozenPath = path.join(dir, `${baseName}.frozen`);
            await fs.writeFile(frozenPath, result.frozenHtml);
            created.push(path.relative(this.boxRoot, frozenPath));
          }

          await client.deleteMessage(msg.id);
        } catch (err) {
          errors.push(`Failed to process message ${msg.id}: ${(err as Error).message}`);
        }
      }

      // Update last poll time to the most recent message
      const latestTime = messages
        .map((m) => m.createdAt)
        .toSorted()
        .pop();
      if (latestTime) {
        state.lastPollTime = latestTime;
      }
    } catch (err) {
      errors.push(`Poll failed: ${(err as Error).message}`);
    }

    await saveTransientState({ boxRoot: this.boxRoot, connectorName: "dropbox", data: state });

    if (created.length > 0) {
      await stageFiles(this.boxRoot, created);
      await commit(this.boxRoot, {
        message: buildDropboxCommitMessage(notes),
        trailers: {
          "Pulled-By": "dropbox-connector",
          ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}),
        },
      });
    }

    // Create intake job for non-news inbox items
    const jobs: string[] = [];
    const intakeItems = created.filter(
      (p) => !p.includes("box/inbox/news/") && p.endsWith(".card")
    );
    if (intakeItems.length > 0) {
      const jobPath = await createOrAppendIntakeJob({
        boxRoot: this.boxRoot,
        source: "dropbox-connector",
        items: intakeItems,
        priority: "normal",
        description: `Triage ${intakeItems.length} item${intakeItems.length === 1 ? "" : "s"} from Dropbox`,
      });
      jobs.push(jobPath);
      await stageFiles(this.boxRoot, [jobPath]);
      await commit(this.boxRoot, {
        message: "Create intake job for Dropbox items",
        trailers: { "Created-By": "dropbox-connector", ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}) },
      });
    }

    const result: SyncResult = {
      success: errors.length === 0,
      created,
      updated: [],
    };
    if (jobs.length > 0) result.jobs = jobs;
    if (errors.length > 0) {
      result.error = errors.join("; ");
    }
    return result;
  }

  private messageToCard(msg: DecryptedMessage): {
    content: string;
    type: "memo" | "news-item" | "record";
    dir?: string;
    frozenHtml?: string;
  } | null {
    const savePage = parseSavePageMessage(msg.data);
    if (savePage) {
      const sources: Array<{ ref: string; text?: string }> = [];
      const sourceText = [savePage.siteName, savePage.byline].filter(Boolean).join(" — ");
      sources.push({ ref: savePage.url, text: sourceText || "Saved from browser" });

      const templateOpts: Parameters<typeof createRecordTemplate>[0] = {
        name: savePage.title,
        sources,
      };
      if (savePage.excerpt) templateOpts.description = savePage.excerpt;
      if (savePage.markdown) templateOpts.content = savePage.markdown;

      const result: {
        content: string;
        type: "memo" | "news-item" | "record";
        dir: string;
        frozenHtml?: string;
      } = {
        content: createRecordTemplate(templateOpts),
        type: "record",
        dir: savePage.intent === "do" ? "box/inbox/pages-todo" : "box/inbox/pages-saved",
      };
      if (savePage.frozenHtml) result.frozenHtml = savePage.frozenHtml;
      return result;
    }

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
    const savePage = parseSavePageMessage(msg.data);
    if (savePage) {
      return savePage.title.slice(0, 50);
    }
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

}

/**
 * Create and register the Dropbox connector for a box.
 */
export function createDropboxConnector(boxRoot: string): Connector {
  const connector = new DropboxConnector(boxRoot);
  registerConnector(connector);
  return connector;
}
