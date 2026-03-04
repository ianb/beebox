/**
 * Pushover Connector — sends push notifications for cards in box/output/.
 *
 * This is an outbound-only connector. During sync it finds pending
 * pushover-message cards, sends them via the Pushover API, records the
 * result on the card, commits, then deletes the card and commits the deletion.
 *
 * Configuration: config/connectors/pushover.secret.json
 * { "apiKey": "...", "userKey": "..." }
 *
 * Falls back to PUSHOVER_API_KEY / PUSHOVER_USER_KEY env vars.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import ky from "ky";
import { glob } from "glob";
import { parseXml, type ElementNode } from "cardworks";
import {
  registerConnector,
  type Connector,
  type SyncResult,
} from "./index.js";
import { stageFiles, commit } from "../cli/lib/git.js";

const PUSHOVER_API_URL = "https://api.pushover.net/1/messages.json";

interface PushoverConfig {
  apiKey: string;
  userKey: string;
}

function getChildText(children: ElementNode[], tagName: string): string | undefined {
  const el = children.find((c) => c.tagName === tagName);
  if (!el) return undefined;
  return (el as { text?: string }).text?.trim();
}

class PushoverConnector implements Connector {
  name = "pushover";
  produces: string[] = [];
  triggeredBy?: string;

  private boxRoot: string;

  constructor(boxRoot: string) {
    this.boxRoot = boxRoot;
  }

  private configPath(): string {
    return path.join(this.boxRoot, "config/connectors/pushover.secret.json");
  }

  async loadConfig(): Promise<PushoverConfig | null> {
    // Try config file first
    try {
      const content = await fs.readFile(this.configPath(), "utf-8");
      const parsed = JSON.parse(content);
      if (parsed.apiKey && parsed.userKey) return parsed;
    } catch {
      // Fall through to env vars
    }

    // Fall back to env vars
    const apiKey = process.env.PUSHOVER_API_KEY;
    const userKey = process.env.PUSHOVER_USER_KEY;
    if (apiKey && userKey) return { apiKey, userKey };

    return null;
  }

  async sync(): Promise<SyncResult> {
    const config = await this.loadConfig();
    if (!config) {
      return { success: true, created: [], updated: [] };
    }

    // Find pending pushover-message cards in box/output/
    const outputDir = path.join(this.boxRoot, "box/output");
    let cardPaths: string[];
    try {
      cardPaths = await glob("**/*.pushover-message.card", { cwd: outputDir });
    } catch {
      return { success: true, created: [], updated: [] };
    }

    if (cardPaths.length === 0) {
      return { success: true, created: [], updated: [] };
    }

    const pushed: string[] = [];
    const errors: string[] = [];

    for (const relCard of cardPaths) {
      const cardRelPath = path.join("box/output", relCard);
      const cardAbsPath = path.join(this.boxRoot, cardRelPath);

      try {
        const content = await fs.readFile(cardAbsPath, "utf-8");
        const root = await parseXml(content, relCard);

        // Only process pending cards
        if (root.attrs["status"] !== "pending") continue;

        const children = (root.children ?? []) as ElementNode[];
        const message = getChildText(children, "message");
        if (!message) {
          errors.push(`${cardRelPath}: missing <message> element`);
          continue;
        }

        // Build form body
        const form = new URLSearchParams();
        form.set("token", config.apiKey);
        form.set("user", config.userKey);
        form.set("message", message);

        const title = getChildText(children, "title");
        if (title) form.set("title", title);

        const url = getChildText(children, "url");
        if (url) form.set("url", url);

        const urlTitle = getChildText(children, "url-title");
        if (urlTitle) form.set("url_title", urlTitle);

        const priority = getChildText(children, "priority");
        if (priority) form.set("priority", priority);

        const sound = getChildText(children, "sound");
        if (sound) form.set("sound", sound);

        const html = getChildText(children, "html");
        if (html === "1") form.set("html", "1");

        // Send the notification
        const responseBody = await ky
          .post(PUSHOVER_API_URL, { body: form, retry: 2 })
          .json<{ status?: number; request?: string; errors?: string[] }>();

        if (responseBody.status === 1) {
          // Success — update card with response info
          const sentAt = new Date().toISOString();
          const requestId = responseBody.request ?? "unknown";
          const updatedContent = content.replace(
            /status="pending"/,
            "status=\"sent\""
          ).replace(
            /<\/pushover-message>/,
            `  <response sent-at="${sentAt}" request-id="${requestId}" />\n</pushover-message>`
          );

          await fs.writeFile(cardAbsPath, updatedContent);
          await stageFiles(this.boxRoot, [cardRelPath]);
          const commitTitle = title ? `Send pushover: ${title}` : "Send pushover message";
          await commit(this.boxRoot, {
            message: commitTitle,
            trailers: { "Pushed-By": "pushover-connector", ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}) },
          });

          // Delete the card
          await fs.unlink(cardAbsPath);
          await stageFiles(this.boxRoot, [cardRelPath]);
          await commit(this.boxRoot, {
            message: "Delete sent pushover message",
            trailers: { "Pushed-By": "pushover-connector", ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}) },
          });

          pushed.push(cardRelPath);
        } else {
          // Failure — update card with error
          const errorMsg = responseBody.errors?.join("; ") ?? "Unknown Pushover error";
          const updatedContent = content.replace(
            /status="pending"/,
            "status=\"failed\""
          ).replace(
            /<\/pushover-message>/,
            `  <error>${errorMsg}</error>\n</pushover-message>`
          );

          await fs.writeFile(cardAbsPath, updatedContent);
          await stageFiles(this.boxRoot, [cardRelPath]);
          await commit(this.boxRoot, {
            message: `Pushover send failed: ${errorMsg}`,
            trailers: { "Pushed-By": "pushover-connector", ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}) },
          });

          errors.push(`${cardRelPath}: ${errorMsg}`);
        }
      } catch (err) {
        errors.push(`${cardRelPath}: ${(err as Error).message}`);
      }
    }

    const result: SyncResult = {
      success: errors.length === 0,
      created: [],
      updated: [],
    };
    if (pushed.length > 0) result.pushed = pushed;
    if (errors.length > 0) result.error = errors.join("; ");
    return result;
  }
}

/**
 * Create and register the Pushover connector for a box.
 */
export function createPushoverConnector(boxRoot: string): Connector {
  const connector = new PushoverConnector(boxRoot);
  registerConnector(connector);
  return connector;
}
