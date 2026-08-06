/**
 * Gmail MIME parsing — turns raw Gmail API message payloads into our flat
 * `FetchedMessage` shape: header extraction, base64url decoding, MIME-tree
 * walking, text-body extraction (text/plain preferred, html fallback), and
 * attachment-ref collection with safe filenames.
 */

import * as path from "node:path";
import type {
  GoogleGmailService,
  GmailMessage,
  GmailPayload,
} from "../services/google-gmail.js";

export interface FetchedMessage {
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
export function safeDirectoryName(subject: string, threadId: string): string {
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

export function makeSnippet(text: string, maxLen?: number): string {
  maxLen = maxLen ?? 100;
  return text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

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

/**
 * Parse a Gmail API message into our flat FetchedMessage shape, downloading
 * attachment bytes via separate API calls.
 */
export async function parseGmailMessage(
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

/**
 * Extract a Message-ID header (falling back to the raw API id). Used by the
 * connector to dedup against seenMessageIds before fetching attachments.
 */
export function messageIdFor(raw: GmailMessage): string {
  return getHeader(raw.payload, "Message-ID") || raw.id;
}

/** Return the RFC Message-ID header without substituting Gmail's API id. */
export function rfc822MessageIdFor(raw: GmailMessage): string | undefined {
  return getHeader(raw.payload, "Message-ID");
}

export interface GmailMessageSummary {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  labels: string[];
}

/** Build bounded triage metadata without downloading bodies or attachments. */
export function summarizeGmailMessage(
  raw: GmailMessage,
  labelMap: Map<string, string>,
): GmailMessageSummary {
  return {
    messageId: raw.id,
    threadId: raw.threadId,
    from: getHeader(raw.payload, "From") || "unknown",
    subject: getHeader(raw.payload, "Subject") || "(no subject)",
    date: isoDateFromInternal(raw.internalDate),
    snippet: raw.snippet ?? "",
    labels: (raw.labelIds ?? []).map((id) => labelMap.get(id) ?? id),
  };
}
