/**
 * Gmail Connector — Pulls emails via the Gmail REST API and creates
 * email-thread/email-message cards.
 *
 * Auth: shared Google OAuth2 credentials (same as Calendar/Drive).
 * Honors the per-box "gmail" service toggle in box-config.
 *
 * Configuration:
 *   config/connectors/gmail.json - { "query": "label:inbox", "labels": [] }
 *
 * State stored in:
 *   config/connectors/gmail-state.json    - { "seenMessageIds": [...] }
 *   config/connectors/gmail.state.json    - { "lastPullDate": "..." } (gitignored)
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
import {
  registerConnector,
  type Connector,
  type SyncResult,
} from "./index.js";
import { createEmailThreadTemplate } from "../schemas/email-thread.js";
import { createEmailMessageTemplate } from "../schemas/email-message.js";
import { stageFiles, commit } from "../cli/lib/git.js";
import { loadTransientState, saveTransientState } from "./transient-state.js";
import { getGoogleAuth } from "./google-auth.js";
import { isGoogleServiceAllowed } from "../webapp/box-config.js";
import { createGoogleAuthService } from "../services/google-auth.js";
import {
  createGoogleGmailService,
  type GoogleGmailService,
  type GmailMessage,
  type GmailPayload,
} from "../services/google-gmail.js";

interface GmailConfig {
  /** Gmail search query (uses Gmail search syntax) */
  query?: string;
  /** Filter to specific labels — joined as label:foo OR label:bar if no query */
  labels?: string[];
}

interface GmailState {
  seenMessageIds: string[];
}

interface GmailTransientState {
  lastPullDate?: string;
}

interface FetchedMessage {
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
  opts: { originalFilename: string | undefined; contentType: string; partId: string | undefined },
): string {
  const { originalFilename, contentType, partId } = opts;
  if (originalFilename) {
    const ext = path.extname(originalFilename).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      return originalFilename;
    }
    const base = path.basename(originalFilename, ext);
    return `${base}.bin`;
  }

  const base = partId ? `attachment-${partId.replace(/[^\w-]/g, "")}` : "attachment";
  const ext = CONTENT_TYPE_EXTENSIONS[contentType] || ".bin";
  return `${base}${ext}`;
}

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

// ─── MIME tree walking ──────────────────────────────────────────────────────

function getHeader(payload: GmailPayload | undefined, name: string): string | undefined {
  if (!payload || !payload.headers) return undefined;
  const lower = name.toLowerCase();
  const found = payload.headers.find((h) => h.name.toLowerCase() === lower);
  return found ? found.value : undefined;
}

function decodeBase64Url(data: string): Buffer {
  // Gmail uses URL-safe base64 (- → +, _ → /, no padding)
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

/**
 * Walk a payload tree and collect all parts.
 */
function flattenParts(payload: GmailPayload): GmailPayload[] {
  const result: GmailPayload[] = [payload];
  if (payload.parts) {
    for (const child of payload.parts) {
      result.push(...flattenParts(child));
    }
  }
  return result;
}

/**
 * Strip HTML to plain text — minimal fallback when no text/plain part exists.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\S\s]*?<\/style>/gi, "")
    .replace(/<script[\S\s]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTextBody(payload: GmailPayload | undefined): string {
  if (!payload) return "";
  const parts = flattenParts(payload);

  // Prefer text/plain
  for (const p of parts) {
    if (p.mimeType === "text/plain" && p.body && p.body.data && !p.filename) {
      return decodeBase64Url(p.body.data).toString("utf-8");
    }
  }

  // Fall back to text/html
  for (const p of parts) {
    if (p.mimeType === "text/html" && p.body && p.body.data && !p.filename) {
      return htmlToText(decodeBase64Url(p.body.data).toString("utf-8"));
    }
  }

  return "";
}

interface AttachmentRef {
  filename: string;
  contentType: string;
  size: number;
  attachmentId: string;
  partId: string | undefined;
}

function extractAttachmentRefs(payload: GmailPayload | undefined): AttachmentRef[] {
  if (!payload) return [];
  const parts = flattenParts(payload);
  const refs: AttachmentRef[] = [];
  for (const p of parts) {
    const hasFile = !!p.filename || !!(p.body && p.body.attachmentId);
    if (!hasFile) continue;
    if (!p.body || !p.body.attachmentId) continue;
    refs.push({
      filename: safeAttachmentFilename({
        originalFilename: p.filename || undefined,
        contentType: p.mimeType || "application/octet-stream",
        partId: p.partId,
      }),
      contentType: p.mimeType || "application/octet-stream",
      size: p.body.size ?? 0,
      attachmentId: p.body.attachmentId,
      partId: p.partId,
    });
  }
  return refs;
}

function isoDateFromInternal(internalDate: string | undefined): string {
  if (!internalDate) return new Date().toISOString();
  const ms = parseInt(internalDate, 10);
  if (Number.isNaN(ms)) return new Date().toISOString();
  return new Date(ms).toISOString();
}

// ─── Connector ──────────────────────────────────────────────────────────────

class GmailConnector implements Connector {
  name = "gmail";
  produces = ["email-thread", "email-message"];
  inboxPaths = ["box/inbox/email"];
  triggeredBy?: string;

  private boxRoot: string;
  private injectedService?: GoogleGmailService | undefined;

  constructor(boxRoot: string, service?: GoogleGmailService) {
    this.boxRoot = boxRoot;
    this.injectedService = service;
  }

  private configPath(): string {
    return path.join(this.boxRoot, "config/connectors/gmail.json");
  }

  private statePath(): string {
    return path.join(this.boxRoot, "config/connectors/gmail-state.json");
  }

  private legacySecretPath(): string {
    return path.join(this.boxRoot, "config/connectors/gmail.secret.json");
  }

  private async loadConfig(): Promise<GmailConfig> {
    try {
      const content = await fs.readFile(this.configPath(), "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
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

  private async getService(): Promise<GoogleGmailService | null> {
    if (this.injectedService) return this.injectedService;

    const auth = await getGoogleAuth(this.boxRoot);
    if (!auth) return null;

    const authService = createGoogleAuthService(auth);
    return createGoogleGmailService(authService);
  }

  /** Best-effort cleanup of the legacy IMAP app-password file. */
  private async cleanupLegacySecret(): Promise<void> {
    try {
      await fs.unlink(this.legacySecretPath());
    } catch {
      // File didn't exist — nothing to clean up
    }
  }

  private buildQuery(config: GmailConfig, lastPullDate: string | undefined): string {
    let base: string;
    if (config.query) {
      base = config.query;
    } else if (config.labels && config.labels.length > 0) {
      base = config.labels.map((l) => `label:${l}`).join(" OR ");
    } else {
      base = "label:inbox";
    }

    if (lastPullDate) {
      const datePart = lastPullDate.split("T")[0];
      return `${base} after:${datePart}`;
    }
    return base;
  }

  async sync(): Promise<SyncResult> {
    // Skip policy check when a fake service is injected (tests)
    if (!this.injectedService) {
      const allowed = await isGoogleServiceAllowed(this.boxRoot, "gmail");
      if (!allowed) {
        return { success: true, created: [], updated: [] };
      }
    }

    const service = await this.getService();
    if (!service) {
      // No tokens — silently skip (matches calendar's behavior for unconfigured boxes)
      return { success: true, created: [], updated: [] };
    }

    await this.cleanupLegacySecret();

    const config = await this.loadConfig();
    const state = await this.loadState();
    const transient = await loadTransientState<GmailTransientState>({
      boxRoot: this.boxRoot,
      connectorName: "gmail",
      defaultValue: {},
    });

    const created: string[] = [];
    const updated: string[] = [];
    const threadNotes: ThreadNote[] = [];

    try {
      const labelMap = new Map<string, string>();
      try {
        const labels = await service.listLabels();
        for (const l of labels) labelMap.set(l.id, l.name);
      } catch {
        // Non-fatal: cards will fall back to label IDs
      }

      const query = this.buildQuery(config, transient.lastPullDate);

      // Paginate through messages.list
      const refs: Array<{ id: string; threadId: string }> = [];
      let pageToken: string | undefined;
      do {
        const listOpts: { q: string; pageToken?: string; maxResults: number } = {
          q: query,
          maxResults: 100,
        };
        if (pageToken) listOpts.pageToken = pageToken;
        const result = await service.listMessages(listOpts);
        refs.push(...result.messages);
        pageToken = result.nextPageToken;
      } while (pageToken);

      if (refs.length === 0) {
        await saveTransientState({
          boxRoot: this.boxRoot,
          connectorName: "gmail",
          data: { lastPullDate: new Date().toISOString() },
        });
        return { success: true, created: [], updated: [] };
      }

      // Fetch each message that we haven't seen yet
      const messages: FetchedMessage[] = [];
      for (const ref of refs) {
        const raw = await service.getMessage(ref.id);
        const messageIdHeader = getHeader(raw.payload, "Message-ID") || raw.id;
        if (state.seenMessageIds.includes(messageIdHeader)) {
          continue;
        }

        const fetched = await this.parseMessage(raw, { service, labelMap });
        if (fetched) messages.push(fetched);
      }

      if (messages.length === 0) {
        await saveTransientState({
          boxRoot: this.boxRoot,
          connectorName: "gmail",
          data: { lastPullDate: new Date().toISOString() },
        });
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
        threadMessages.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        );

        const firstMsg = threadMessages[0]!;
        const subject = firstMsg.subject;
        const dirName = safeDirectoryName(subject, threadId);
        const threadDir = path.join(emailDir, dirName);

        // Check if a directory for this thread already exists (matched by short ID suffix)
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

        let existingCount = 0;
        try {
          const files = await fs.readdir(actualDir);
          existingCount = files.filter((f) =>
            f.match(/^msg-\d+\.email-message\.card$/),
          ).length;
        } catch {
          // empty dir
        }

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

        const messageRefs: string[] = [];
        for (const [i, threadMessage] of threadMessages.entries()) {
          const tmsg = threadMessage!;
          const msgNum = String(existingCount + i + 1).padStart(3, "0");
          const cardFilename = `msg-${msgNum}.email-message.card`;
          const bodyFilename = `msg-${msgNum}.body.txt`;

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
              ref: `attachments/${a.filename}`,
              contentType: a.contentType,
              size: a.size,
            }));
          }
          const cardContent = createEmailMessageTemplate(templateOpts);

          const cardPath = path.join(actualDir, cardFilename);
          await fs.writeFile(cardPath, cardContent);
          created.push(path.relative(this.boxRoot, cardPath));

          const bodyPath = path.join(actualDir, bodyFilename);
          await fs.writeFile(bodyPath, tmsg.textBody);
          created.push(path.relative(this.boxRoot, bodyPath));

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

        try {
          const files = await fs.readdir(actualDir);
          const existingRefs = files
            .filter((f) => f.match(/^msg-\d+\.email-message\.card$/))
            .toSorted();
          for (const ref of existingRefs) {
            if (!messageRefs.includes(ref)) {
              messageRefs.unshift(ref);
            }
          }
        } catch {
          // no existing files
        }

        const allLabels = new Set<string>();
        for (const msg of threadMessages) {
          for (const label of msg.labels) {
            allLabels.add(label);
          }
        }

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

        const threadCardPath = path.join(actualDir, "thread.email-thread.card");
        await fs.writeFile(threadCardPath, threadCard);
        if (existingDir) {
          updated.push(path.relative(this.boxRoot, threadCardPath));
        } else {
          created.push(path.relative(this.boxRoot, threadCardPath));
        }

        threadNotes.push({
          subject,
          from: firstMsg.from,
          isNew: !existingDir,
          messageCount: threadMessages.length,
        });

        for (const msg of threadMessages) {
          if (!state.seenMessageIds.includes(msg.messageId)) {
            state.seenMessageIds.push(msg.messageId);
          }
        }
      }
    } catch (err) {
      await saveTransientState({
        boxRoot: this.boxRoot,
        connectorName: "gmail",
        data: { lastPullDate: new Date().toISOString() },
      });
      await this.saveState(state);

      return {
        success: false,
        created,
        updated,
        error: `Gmail pull failed: ${(err as Error).message}`,
      };
    }

    await saveTransientState({
      boxRoot: this.boxRoot,
      connectorName: "gmail",
      data: { lastPullDate: new Date().toISOString() },
    });
    if (state.seenMessageIds.length > 5000) {
      state.seenMessageIds = state.seenMessageIds.slice(-5000);
    }
    await this.saveState(state);

    if (created.length > 0 || updated.length > 0) {
      const stateRelPath = path.relative(this.boxRoot, this.statePath());
      await stageFiles(this.boxRoot, [...created, ...updated, stateRelPath]);
      await commit(this.boxRoot, {
        message: buildGmailCommitMessage(threadNotes, created.length + updated.length),
        trailers: {
          "Pulled-By": "gmail-connector",
          ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}),
        },
      });
    }

    return { success: true, created, updated };
  }

  /**
   * Parse a Gmail API message into our flat FetchedMessage shape, downloading
   * attachment bytes via separate API calls.
   */
  private async parseMessage(
    raw: GmailMessage,
    { service, labelMap }: { service: GoogleGmailService; labelMap: Map<string, string> },
  ): Promise<FetchedMessage | null> {
    const messageIdHeader = getHeader(raw.payload, "Message-ID") || raw.id;
    const from = getHeader(raw.payload, "From") || "unknown";
    const to = getHeader(raw.payload, "To") || "";
    const cc = getHeader(raw.payload, "Cc");
    const subject = getHeader(raw.payload, "Subject") || "(no subject)";
    const date = isoDateFromInternal(raw.internalDate);
    const textBody = extractTextBody(raw.payload);

    const labels = (raw.labelIds || []).map((id) => labelMap.get(id) || id);

    const attachmentRefs = extractAttachmentRefs(raw.payload);
    const attachments: FetchedMessage["attachments"] = [];
    for (const ref of attachmentRefs) {
      const att = await service.getAttachment(raw.id, ref.attachmentId);
      attachments.push({
        filename: ref.filename,
        contentType: ref.contentType,
        size: ref.size > 0 ? ref.size : att.size,
        content: decodeBase64Url(att.data),
      });
    }

    return {
      messageId: messageIdHeader,
      threadId: raw.threadId,
      from,
      to,
      cc: cc || undefined,
      date,
      subject,
      textBody,
      labels,
      attachments,
    };
  }
}

/**
 * Create and register the Gmail connector for a box.
 */
export function createGmailConnector(
  boxRoot: string,
  service?: GoogleGmailService,
): Connector {
  const connector = new GmailConnector(boxRoot, service);
  registerConnector(connector);
  return connector;
}
