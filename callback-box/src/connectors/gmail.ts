/**
 * Gmail Connector - Pulls emails via IMAP and creates email-thread/email-message cards.
 *
 * Configuration:
 *   config/connectors/gmail.json          - { "query": "label:inbox", "labels": [] }
 *   config/connectors/gmail.secret.json   - { "user": "you@gmail.com", "appPassword": "xxxx xxxx xxxx xxxx" }
 *
 * State stored in config/connectors/gmail-state.json:
 *   { "seenMessageIds": [...], "lastPullDate": "..." }
 *
 * Each Gmail thread becomes a directory in box/inbox/email/:
 *   thread-Subject_Line-abc123/
 *     thread.email-thread.card
 *     msg-001.email-message.card
 *     msg-001.body.txt
 *     msg-002.email-message.card
 *     msg-002.body.txt
 *     attachments/
 *       document.pdf
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import {
  registerConnector,
  type Connector,
  type SyncResult,
  type ExecuteResult,
} from "./index.js";
import { createEmailThreadTemplate } from "../schemas/email-thread.js";
import { createEmailMessageTemplate } from "../schemas/email-message.js";
import { stageFiles, commit } from "../cli/lib/git.js";

interface GmailConfig {
  /** Gmail search query (uses Gmail search syntax via X-GM-RAW) */
  query?: string;
  /** Filter to specific labels */
  labels?: string[];
}

interface GmailSecret {
  user: string;
  appPassword: string;
}

interface GmailState {
  seenMessageIds: string[];
  lastPullDate?: string;
}

interface FetchedMessage {
  uid: number;
  messageId: string;
  threadId: string;
  from: string;
  to: string;
  cc: string | undefined;
  date: string;
  subject: string;
  textBody: string;
  labels: string[];
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    content: Buffer;
  }>;
}

/**
 * Generate a safe directory name from a subject and thread ID.
 */
function safeDirectoryName(subject: string, threadId: string): string {
  const safePart = subject
    .replace(/^(re|fwd|fw):\s*/gi, "")
    .replace(/[^\d\sA-Za-z-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 40);
  const shortId = threadId.slice(-8);
  return `thread-${safePart}-${shortId}`;
}

/**
 * Allowed attachment extensions. Anything outside this set gets .bin.
 */
const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".csv", ".rtf", ".odt", ".ods",
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".tiff",
  ".mp3", ".wav", ".ogg", ".m4a", ".webm", ".mp4", ".mov", ".avi",
  ".zip", ".gz", ".tar", ".7z", ".rar",
  ".html", ".htm", ".xml", ".json", ".ics", ".eml", ".vcf",
]);

/**
 * Map content-type to extension for attachments missing a filename.
 */
const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "text/plain": ".txt",
  "text/html": ".html",
  "text/csv": ".csv",
  "text/calendar": ".ics",
  "application/json": ".json",
  "application/zip": ".zip",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "video/mp4": ".mp4",
};

/**
 * Produce a safe attachment filename with a whitelisted extension.
 */
function safeAttachmentFilename(
  opts: { originalFilename: string | undefined | false; contentType: string; cid: string | undefined },
): string {
  const { originalFilename, contentType, cid } = opts;
  if (originalFilename) {
    const ext = path.extname(originalFilename).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      return originalFilename;
    }
    // Known filename but disallowed extension — keep the name, swap extension
    const base = path.basename(originalFilename, ext);
    return `${base}.bin`;
  }

  // No filename — generate one from CID or fallback, with extension from content-type
  const base = cid ? `attachment-${cid.replace(/[^\w-]/g, "")}` : "attachment";
  const ext = CONTENT_TYPE_EXTENSIONS[contentType] || ".bin";
  return `${base}${ext}`;
}

/**
 * Extract a short snippet from body text.
 */
function makeSnippet(text: string, maxLen = 100): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

interface ThreadNote {
  subject: string;
  from: string;
  isNew: boolean;
  messageCount: number;
}

function displayName(from: string): string {
  // "Alice Smith <alice@example.com>" → "Alice Smith"
  const match = from.match(/^(.+?)\s*<[^>]+>$/);
  return match ? match[1]!.trim() : from;
}

function buildGmailCommitMessage(notes: ThreadNote[], fileCount: number): string {
  const subject = `Pull ${notes.length} Gmail thread${notes.length === 1 ? "" : "s"} (${fileCount} file${fileCount === 1 ? "" : "s"})`;
  if (notes.length === 0) return subject;

  const newThreads = notes.filter((n) => n.isNew);
  const updatedThreads = notes.filter((n) => !n.isNew);
  const lines = [subject, ""];
  const cap = 5;

  if (newThreads.length > 0) {
    lines.push("New:");
    for (const n of newThreads.slice(0, cap)) {
      lines.push(`- "${n.subject}" from ${displayName(n.from)}`);
    }
    if (newThreads.length > cap) {
      lines.push(`  + ${newThreads.length - cap} more`);
    }
    if (updatedThreads.length > 0) lines.push("");
  }

  if (updatedThreads.length > 0) {
    lines.push("Updated:");
    for (const n of updatedThreads.slice(0, cap)) {
      lines.push(`- "${n.subject}" (+${n.messageCount} message${n.messageCount === 1 ? "" : "s"})`);
    }
    if (updatedThreads.length > cap) {
      lines.push(`  + ${updatedThreads.length - cap} more`);
    }
  }

  return lines.join("\n").trimEnd();
}

class GmailConnector implements Connector {
  name = "gmail";
  handles: string[] = []; // No outbound commands yet (future: email-draft, email-send)
  produces = ["email-thread", "email-message"];

  private boxRoot: string;

  constructor(boxRoot: string) {
    this.boxRoot = boxRoot;
  }

  private configPath(): string {
    return path.join(this.boxRoot, "config/connectors/gmail.json");
  }

  private secretPath(): string {
    return path.join(this.boxRoot, "config/connectors/gmail.secret.json");
  }

  private statePath(): string {
    return path.join(this.boxRoot, "config/connectors/gmail-state.json");
  }

  private async loadConfig(): Promise<GmailConfig> {
    try {
      const content = await fs.readFile(this.configPath(), "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private async loadSecret(): Promise<GmailSecret | null> {
    try {
      const content = await fs.readFile(this.secretPath(), "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async loadState(): Promise<GmailState> {
    try {
      const content = await fs.readFile(this.statePath(), "utf-8");
      return JSON.parse(content);
    } catch {
      return { seenMessageIds: [] };
    }
  }

  private async saveState(state: GmailState): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath()), { recursive: true });
    await fs.writeFile(this.statePath(), JSON.stringify(state, null, 2));
  }

  async sync(): Promise<SyncResult> {
    const secret = await this.loadSecret();
    if (!secret) {
      // Not configured — silently skip
      return { success: true, created: [], updated: [] };
    }

    const config = await this.loadConfig();
    const state = await this.loadState();

    const client = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: {
        user: secret.user,
        pass: secret.appPassword,
      },
      logger: false,
    });

    // Prevent unhandled 'error' events from crashing the process
    // (e.g. ECONNRESET after we're done pulling)
    client.on("error", () => {
      // Silently ignore — connection errors after pull are harmless
    });

    const created: string[] = [];
    const updated: string[] = [];
    const threadNotes: ThreadNote[] = [];

    try {
      await client.connect();

      const lock = await client.getMailboxLock("[Gmail]/All Mail");
      try {
        // Build search criteria
        const searchCriteria: Record<string, unknown> = {};

        // Use Gmail's native search if a query is provided
        if (config.query) {
          searchCriteria.gmraw = config.query;
        } else if (config.labels && config.labels.length > 0) {
          // Search by label(s)
          searchCriteria.gmraw = config.labels
            .map((l) => `label:${l}`)
            .join(" ");
        } else {
          // Default: inbox messages
          searchCriteria.gmraw = "label:inbox";
        }

        // Only fetch messages newer than last pull if we have a date
        if (state.lastPullDate) {
          const existing = searchCriteria.gmraw as string;
          searchCriteria.gmraw = `${existing} after:${state.lastPullDate.split("T")[0]}`;
        }

        const searchResult = await client.search(searchCriteria, { uid: true });
        const uids = searchResult || [];

        if (uids.length === 0) {
          return { success: true, created: [], updated: [] };
        }

        // Fetch messages with source for full parsing
        const messages: FetchedMessage[] = [];

        for await (const msg of client.fetch(uids, {
          uid: true,
          envelope: true,
          source: true,
          labels: true,
          threadId: true,
        }, { uid: true })) {
          const envelope = msg.envelope;
          if (!envelope) continue;
          const msgId = envelope.messageId;
          if (!msgId || state.seenMessageIds.includes(msgId)) {
            continue;
          }

          // Parse the full message source with mailparser
          const source = msg.source;
          if (!source) continue;
          const parsed = await simpleParser(source);

          const toAddrs = parsed.to;
          const ccAddrs = parsed.cc;

          const fetched: FetchedMessage = {
            uid: msg.uid,
            messageId: msgId,
            threadId: msg.threadId || String(msg.uid),
            from: parsed.from?.text || envelope.from?.[0]?.address || "unknown",
            to: toAddrs ? (Array.isArray(toAddrs) ? toAddrs.map((a: { text: string }) => a.text).join(", ") : toAddrs.text) : "",
            cc: ccAddrs ? (Array.isArray(ccAddrs) ? ccAddrs.map((a: { text: string }) => a.text).join(", ") : ccAddrs.text) : undefined,
            date: (parsed.date || new Date()).toISOString(),
            subject: parsed.subject || "(no subject)",
            textBody: parsed.text || "",
            labels: msg.labels ? Array.from(msg.labels) : [],
            attachments: (parsed.attachments || []).map((att) => ({
              filename: safeAttachmentFilename({ originalFilename: att.filename, contentType: att.contentType || "application/octet-stream", cid: att.cid || undefined }),
              contentType: att.contentType || "application/octet-stream",
              size: att.size,
              content: att.content,
            })),
          };

          messages.push(fetched);
        }

        if (messages.length === 0) {
          return { success: true, created: [], updated: [] };
        }

        // Group messages by thread
        const threads = new Map<string, FetchedMessage[]>();
        for (const msg of messages) {
          const existing = threads.get(msg.threadId) || [];
          existing.push(msg);
          threads.set(msg.threadId, existing);
        }

        // Create/update thread directories
        const emailDir = path.join(this.boxRoot, "box/inbox/email");
        await fs.mkdir(emailDir, { recursive: true });
        for (const [threadId, threadMessages] of threads) {
          // Sort messages by date
          threadMessages.sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
          );

          const firstMsg = threadMessages[0]!;
          const subject = firstMsg.subject;
          const dirName = safeDirectoryName(subject, threadId);
          const threadDir = path.join(emailDir, dirName);

          // Check if thread directory already exists
          let existingDir: string | null = null;
          try {
            const entries = await fs.readdir(emailDir);
            existingDir =
              entries.find((e) => e.endsWith(`-${threadId.slice(-8)}`)) || null;
          } catch {
            // emailDir doesn't exist yet
          }

          const actualDir = existingDir
            ? path.join(emailDir, existingDir)
            : threadDir;
          await fs.mkdir(actualDir, { recursive: true });

          // Find existing message count for numbering
          let existingCount = 0;
          try {
            const files = await fs.readdir(actualDir);
            existingCount = files.filter((f) =>
              f.match(/^msg-\d+\.email-message\.card$/)
            ).length;
          } catch {
            // empty dir
          }

          // Collect all participants across thread
          const participants = new Set<string>();
          for (const msg of threadMessages) {
            participants.add(msg.from);
            if (msg.to) {
              for (const addr of msg.to.split(",").map((s) => s.trim())) {
                if (addr) participants.add(addr);
              }
            }
            if (msg.cc) {
              for (const addr of msg.cc.split(",").map((s) => s.trim())) {
                if (addr) participants.add(addr);
              }
            }
          }

          // Write individual message cards
          const messageRefs: string[] = [];
          for (const [i, threadMessage] of threadMessages.entries()) {
            const tmsg = threadMessage!;
            const msgNum = String(existingCount + i + 1).padStart(3, "0");
            const cardFilename = `msg-${msgNum}.email-message.card`;
            const bodyFilename = `msg-${msgNum}.body.txt`;

            // Write message card
            const templateOpts: Parameters<typeof createEmailMessageTemplate>[0] = {
              messageId: tmsg.messageId,
              threadId: tmsg.threadId,
              from: tmsg.from,
              to: tmsg.to,
              date: tmsg.date,
              subject: tmsg.subject,
              snippet: makeSnippet(tmsg.textBody),
              bodyFile: bodyFilename,
            };
            if (tmsg.cc) {
              templateOpts.cc = tmsg.cc;
            }
            if (tmsg.attachments.length > 0) {
              templateOpts.attachments = tmsg.attachments.map((a) => ({
                file: `attachments/${a.filename}`,
                contentType: a.contentType,
                size: a.size,
              }));
            }
            const cardContent = createEmailMessageTemplate(templateOpts);

            const cardPath = path.join(actualDir, cardFilename);
            await fs.writeFile(cardPath, cardContent);
            created.push(path.relative(this.boxRoot, cardPath));

            // Write body text file
            const bodyPath = path.join(actualDir, bodyFilename);
            await fs.writeFile(bodyPath, tmsg.textBody);
            created.push(path.relative(this.boxRoot, bodyPath));

            // Write attachments
            if (tmsg.attachments.length > 0) {
              const attachDir = path.join(actualDir, "attachments");
              await fs.mkdir(attachDir, { recursive: true });
              for (const att of tmsg.attachments) {
                const attPath = path.join(attachDir, att.filename);
                await fs.writeFile(attPath, att.content);
                created.push(path.relative(this.boxRoot, attPath));
              }
            }

            messageRefs.push(cardFilename);
          }

          // Also include existing message refs
          try {
            const files = await fs.readdir(actualDir);
            const existingRefs = files
              .filter((f) => f.match(/^msg-\d+\.email-message\.card$/))
              .toSorted();
            // Merge: existing + new (avoid duplicates)
            for (const ref of existingRefs) {
              if (!messageRefs.includes(ref)) {
                messageRefs.unshift(ref); // existing ones come first
              }
            }
          } catch {
            // no existing files
          }

          // Collect all labels
          const allLabels = new Set<string>();
          for (const msg of threadMessages) {
            for (const label of msg.labels) {
              allLabels.add(label);
            }
          }

          // Write/update thread card
          const lastMsg = threadMessages[threadMessages.length - 1]!;
          const threadOpts: Parameters<typeof createEmailThreadTemplate>[0] = {
            threadId,
            subject,
            participants: Array.from(participants),
            dateStart: firstMsg.date,
            dateEnd: lastMsg.date,
            messageRefs: messageRefs.toSorted(),
          };
          if (allLabels.size > 0) {
            threadOpts.labels = Array.from(allLabels);
          }
          if (!existingDir) {
            threadOpts.status = "new";
          }
          const threadCard = createEmailThreadTemplate(threadOpts);

          const threadCardPath = path.join(
            actualDir,
            "thread.email-thread.card"
          );
          await fs.writeFile(threadCardPath, threadCard);
          if (existingDir) {
            updated.push(path.relative(this.boxRoot, threadCardPath));
          } else {
            created.push(path.relative(this.boxRoot, threadCardPath));
          }

          // Accumulate thread note for commit message
          threadNotes.push({
            subject,
            from: firstMsg.from,
            isNew: !existingDir,
            messageCount: threadMessages.length,
          });

          // Track seen message IDs
          for (const msg of threadMessages) {
            if (!state.seenMessageIds.includes(msg.messageId)) {
              state.seenMessageIds.push(msg.messageId);
            }
          }
        }
      } finally {
        lock.release();
      }

      try {
        await client.logout();
      } catch {
        // Connection may already be closed — ignore logout errors
      }
    } catch (err) {
      // Make sure we save state even on error
      state.lastPullDate = new Date().toISOString();
      await this.saveState(state);

      return {
        success: false,
        created,
        updated,
        error: `Gmail pull failed: ${(err as Error).message}`,
      };
    }

    // Update state
    state.lastPullDate = new Date().toISOString();
    // Keep last 5000 seen message IDs to prevent unbounded growth
    if (state.seenMessageIds.length > 5000) {
      state.seenMessageIds = state.seenMessageIds.slice(-5000);
    }
    await this.saveState(state);

    // Commit if we created or updated any files
    if (created.length > 0 || updated.length > 0) {
      await stageFiles(this.boxRoot, [...created, ...updated]);
      await commit(this.boxRoot, {
        message: buildGmailCommitMessage(threadNotes, created.length + updated.length),
        trailers: {
          "Pulled-By": "gmail-connector",
        },
      });
    }

    return { success: true, created, updated };
  }

  async execute(_cardPath: string, _dryRun: boolean): Promise<ExecuteResult> {
    return {
      success: false,
      error: "Gmail connector does not support command execution yet",
    };
  }
}

/**
 * Create and register the Gmail connector for a box.
 */
export function createGmailConnector(boxRoot: string): Connector {
  const connector = new GmailConnector(boxRoot);
  registerConnector(connector);
  return connector;
}
