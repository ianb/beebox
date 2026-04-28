/**
 * Gmail draft uploader — finds agent-authored draft email-message cards
 * under box/inbox/email/, builds RFC 2822 MIME messages, uploads them as
 * Gmail drafts, and stamps each card with `gmail-draft-id` and
 * `gmail-draft-url` so the user can open the draft in Gmail.
 *
 * Drafts already stamped with `gmail-draft-id` are skipped on subsequent
 * runs — this is a one-shot upload. Editing the card after upload does
 * NOT update the Gmail draft (yet).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseXml, escapeAttr, type ElementNode } from "cardworks";
import type { GoogleGmailService } from "../services/google-gmail.js";

interface DraftFields {
  to: string;
  cc: string | undefined;
  bcc: string | undefined;
  subject: string;
  body: string;
  inReplyToRef: string | undefined;
}

interface UploadResult {
  /** Card paths (relative to boxRoot) that were stamped. */
  updated: string[];
  /** Per-card errors keyed by card path. */
  errors: Array<{ path: string; error: string }>;
}

/**
 * Walk box/inbox/email/ and upload any draft cards that haven't been
 * stamped with a gmail-draft-id yet.
 */
export async function uploadPendingDrafts(opts: {
  boxRoot: string;
  service: GoogleGmailService;
}): Promise<UploadResult> {
  const result: UploadResult = { updated: [], errors: [] };
  const cards = await findDraftCards(opts.boxRoot);
  for (const cardPath of cards) {
    try {
      const stamped = await uploadOneDraft({
        boxRoot: opts.boxRoot,
        service: opts.service,
        cardPath,
      });
      if (stamped) {
        result.updated.push(path.relative(opts.boxRoot, cardPath));
      }
    } catch (err) {
      result.errors.push({
        path: path.relative(opts.boxRoot, cardPath),
        error: (err as Error).message,
      });
    }
  }
  return result;
}

/**
 * Walk box/inbox/email/ for email-message cards with status="draft" and
 * no gmail-draft-id attribute. Returns absolute paths.
 */
async function findDraftCards(boxRoot: string): Promise<string[]> {
  const emailDir = path.join(boxRoot, "box/inbox/email");
  const drafts: string[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(emailDir);
  } catch {
    return drafts;
  }
  for (const entry of entries) {
    const threadDir = path.join(emailDir, entry);
    let stat;
    try {
      stat = await fs.stat(threadDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    let files: string[];
    try {
      files = await fs.readdir(threadDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".email-message.card")) continue;
      const cardPath = path.join(threadDir, file);
      try {
        const content = await fs.readFile(cardPath, "utf-8");
        const root = await parseXml(content, file);
        if (
          root.attrs.status === "draft" &&
          !root.attrs["gmail-draft-id"]
        ) {
          drafts.push(cardPath);
        }
      } catch {
        // unparseable — skip
        continue;
      }
    }
  }
  return drafts;
}

async function uploadOneDraft(opts: {
  boxRoot: string;
  service: GoogleGmailService;
  cardPath: string;
}): Promise<boolean> {
  const content = await fs.readFile(opts.cardPath, "utf-8");
  const root = await parseXml(content, path.basename(opts.cardPath));
  const fields = readDraftFields(root);

  // Resolve threading from in-reply-to ref (if present)
  let inReplyToMessageId: string | undefined;
  let references: string | undefined;
  let threadId: string | undefined;
  if (fields.inReplyToRef) {
    const sourcePath = path.resolve(
      path.dirname(opts.cardPath),
      fields.inReplyToRef,
    );
    const source = await readSourceMessage(sourcePath);
    if (source) {
      inReplyToMessageId = source.messageId;
      references = source.messageId;
      threadId = source.threadId;
    }
  }

  const mimeOpts: BuildMimeOptions = {
    to: fields.to,
    subject: fields.subject,
    body: fields.body,
  };
  if (fields.cc) mimeOpts.cc = fields.cc;
  if (fields.bcc) mimeOpts.bcc = fields.bcc;
  if (inReplyToMessageId) mimeOpts.inReplyToMessageId = inReplyToMessageId;
  if (references) mimeOpts.references = references;
  const mime = buildMime(mimeOpts);

  const createOpts: { raw: string; threadId?: string } = {
    raw: base64UrlEncode(mime),
  };
  if (threadId) createOpts.threadId = threadId;

  const draft = await opts.service.createDraft(createOpts);
  const url = `https://mail.google.com/mail/u/0/#drafts/${draft.message.id}`;

  await stampDraftCard({
    cardPath: opts.cardPath,
    draftId: draft.id,
    draftUrl: url,
  });
  return true;
}

function readDraftFields(root: ElementNode): DraftFields {
  let to = "";
  let cc: string | undefined;
  let bcc: string | undefined;
  let subject = "";
  let body = "";
  let inReplyToRef: string | undefined;
  for (const child of root.children) {
    if (child.tagName === "to") to = child.text || "";
    else if (child.tagName === "cc") cc = child.text || undefined;
    else if (child.tagName === "bcc") bcc = child.text || undefined;
    else if (child.tagName === "subject") subject = child.text || "";
    else if (child.tagName === "body") body = child.text || "";
    else if (child.tagName === "in-reply-to") {
      inReplyToRef = child.attrs.ref;
    }
  }
  if (!to) throw new MissingFieldError("to");
  if (!subject) throw new MissingFieldError("subject");
  if (!body) throw new MissingFieldError("body");
  return { to, cc, bcc, subject, body, inReplyToRef };
}

async function readSourceMessage(
  absPath: string,
): Promise<{ messageId: string; threadId: string } | null> {
  try {
    const content = await fs.readFile(absPath, "utf-8");
    const root = await parseXml(content, path.basename(absPath));
    const messageId = root.attrs["message-id"];
    const threadId = root.attrs["thread-id"];
    if (!messageId || !threadId) return null;
    return { messageId, threadId };
  } catch {
    return null;
  }
}

interface BuildMimeOptions {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyToMessageId?: string;
  references?: string;
}

function buildMime(opts: BuildMimeOptions): string {
  const headers: string[] = [];
  headers.push(`To: ${opts.to}`);
  if (opts.cc) headers.push(`Cc: ${opts.cc}`);
  if (opts.bcc) headers.push(`Bcc: ${opts.bcc}`);
  headers.push(`Subject: ${encodeHeader(opts.subject)}`);
  if (opts.inReplyToMessageId) {
    headers.push(`In-Reply-To: ${opts.inReplyToMessageId}`);
  }
  if (opts.references) {
    headers.push(`References: ${opts.references}`);
  }
  headers.push("MIME-Version: 1.0");
  headers.push("Content-Type: text/plain; charset=UTF-8");
  headers.push("Content-Transfer-Encoding: 8bit");
  return headers.join("\r\n") + "\r\n\r\n" + opts.body;
}

/**
 * RFC 2047 encoded-word for headers with non-ASCII characters.
 * For pure-ASCII subjects we pass through as-is.
 */
function encodeHeader(value: string): string {
  if (!/[^ -~]/.test(value)) return value;
  const b64 = Buffer.from(value, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

function base64UrlEncode(s: string): string {
  return Buffer.from(s, "utf-8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function stampDraftCard(opts: {
  cardPath: string;
  draftId: string;
  draftUrl: string;
}): Promise<void> {
  const content = await fs.readFile(opts.cardPath, "utf-8");
  // Append the two new attrs to the opening <email-message ... > tag.
  // We assume the existing card has status="draft" and no gmail-draft-id.
  const stamped = content.replace(
    /<email-message\b([^>]*)>/,
    (_match, attrs: string) =>
      `<email-message${attrs} gmail-draft-id="${escapeAttr(opts.draftId)}" gmail-draft-url="${escapeAttr(opts.draftUrl)}">`,
  );
  await fs.writeFile(opts.cardPath, stamped);
}

class MissingFieldError extends Error {
  field: string;
  constructor(field: string) {
    super(`Draft is missing required <${field}>`);
    this.name = "MissingFieldError";
    this.field = field;
  }
}
