/**
 * Gmail draft uploader — finds agent-authored email-outbound cards under
 * _content/inbox/email/, builds RFC 2822 MIME messages, uploads them as Gmail
 * drafts, and stamps each card with `gmail-draft-id` and `gmail-draft-url`
 * so the user can open the draft in Gmail.
 *
 * Drafts already stamped with `gmail-draft-id` are skipped on subsequent
 * runs — this is a one-shot upload. Editing the card after upload does
 * NOT update the Gmail draft (yet).
 *
 * Outbound cards live in `*.email-outbound.card` files, intentionally
 * separate from `*.email-message.card` (received) so the wakeup intake
 * step doesn't try to triage them as incoming mail.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode, errorMessage } from "../lib/error-guards.js";
import { isRecord } from "../lib/is-record.js";
import { parse as parseYaml } from "yaml";
import { parseFrontmatterObject, renderFrontmatterBlock, splitCardContent } from "../cards/index.js";
import { parseCardText } from "../core/card-io.js";
import { createCardSchemaMap } from "../schemas/registry.js";
import { containWithinBox, realpathContained } from "../lib/box-containment.js";
import { getBoxDir } from "../lib/paths.js";
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
 * Walk _content/inbox/email/ and upload any draft cards that haven't been
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
        error: errorMessage(err),
      });
    }
  }
  return result;
}

/**
 * Walk _content/inbox/email/ for email-outbound cards in draft status without
 * a gmail-draft-id stamp. Returns absolute paths.
 */
async function findDraftCards(boxRoot: string): Promise<string[]> {
  const emailDir = path.join(getBoxDir(boxRoot, "inbox"), "email");
  const drafts: string[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(emailDir);
  } catch (e) {
    // No email dir (or unreadable) means no drafts to upload — expected on boxes
    // that have never received email.
    if (errnoCode(e) !== "ENOENT") {
      console.debug(`gmail-drafts: cannot read ${emailDir}, no drafts to upload:`, e);
    }
    return drafts;
  }
  for (const entry of entries) {
    const threadDir = path.join(emailDir, entry);
    let stat;
    try {
      stat = await fs.stat(threadDir);
    } catch (e) {
      console.warn(`gmail-drafts: cannot stat ${threadDir}, skipping:`, e);
      continue;
    }
    if (!stat.isDirectory()) continue;
    let files: string[];
    try {
      files = await fs.readdir(threadDir);
    } catch (e) {
      console.warn(`gmail-drafts: cannot read ${threadDir}, skipping:`, e);
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".email-outbound.card")) continue;
      const cardPath = path.join(threadDir, file);
      try {
        const content = await fs.readFile(cardPath, "utf-8");
        const fm = parseFrontmatterObject(content);
        if (fm === null) continue;
        const status = typeof fm["status"] === "string" ? fm["status"] : "draft";
        const stamped = typeof fm["gmail-draft-id"] === "string";
        if (status === "draft" && !stamped) {
          drafts.push(cardPath);
        }
      } catch (e) {
        // unparseable or unreadable — skip this card, keep scanning the rest
        console.warn(`gmail-drafts: cannot read/parse ${cardPath}, skipping:`, e);
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
  const parsed = parseCardText(content, {
    source: path.basename(opts.cardPath),
    schemas: await createCardSchemaMap(opts.boxRoot),
  });
  const fields = readDraftFields(parsed.fields);

  // Resolve threading from in-reply-to ref (if present). The ref points at a
  // received `email-message` card (see resolveCardRef for the accepted forms).
  // If we can't resolve it, throw — silent fallback means the draft uploads
  // as a brand-new thread, which the user only notices when they open Gmail.
  let inReplyToMessageId: string | undefined;
  let references: string | undefined;
  let threadId: string | undefined;
  if (fields.inReplyToRef) {
    const sourcePath = await resolveCardRef({
      boxRoot: opts.boxRoot,
      cardPath: opts.cardPath,
      ref: fields.inReplyToRef,
    });
    if (sourcePath === null) {
      console.warn(`gmail-drafts: in-reply-to ref "${fields.inReplyToRef}" in ${opts.cardPath} escapes the box`);
      throw new UnresolvedInReplyToRefError(fields.inReplyToRef, "(escapes box)");
    }
    const source = await readSourceMessage(sourcePath);
    if (!source) {
      throw new UnresolvedInReplyToRefError(fields.inReplyToRef, sourcePath);
    }
    inReplyToMessageId = source.messageId;
    references = source.messageId;
    threadId = source.threadId;
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

function readDraftFields(fields: Record<string, unknown>): DraftFields {
  const to = typeof fields["to"] === "string" ? fields["to"] : "";
  const cc = typeof fields["cc"] === "string" && fields["cc"] !== "" ? fields["cc"] : undefined;
  const bcc = typeof fields["bcc"] === "string" && fields["bcc"] !== "" ? fields["bcc"] : undefined;
  const subject = typeof fields["subject"] === "string" ? fields["subject"] : "";
  const body = typeof fields["body"] === "string" ? fields["body"] : "";
  const irt = fields["in-reply-to"];
  let inReplyToRef: string | undefined;
  if (isRecord(irt)) {
    const ref = irt["ref"];
    if (typeof ref === "string" && ref !== "") inReplyToRef = ref;
  }
  const missing = !to ? "to" : !subject ? "subject" : !body ? "body" : undefined;
  if (missing !== undefined) throw new MissingFieldError(missing);
  return { to, cc, bcc, subject, body, inReplyToRef };
}

async function readSourceMessage(
  absPath: string,
): Promise<{ messageId: string; threadId: string } | null> {
  try {
    const content = await fs.readFile(absPath, "utf-8");
    const parsed = parseCardText(content, {
      source: path.basename(absPath),
      schemas: await createCardSchemaMap(),
    });
    const messageId = parsed.fields["message-id"];
    const threadId = parsed.fields["thread-id"];
    if (typeof messageId !== "string" || typeof threadId !== "string") return null;
    return { messageId, threadId };
  } catch (e) {
    // Unreadable/unparseable source card — return null so uploadOneDraft raises a
    // precise "ref did not resolve" error. Log the underlying cause first so it
    // isn't lost behind that message.
    console.warn(`gmail-drafts: cannot read source message ${absPath}:`, e);
    return null;
  }
}

/**
 * Resolve a ref attribute (e.g. on <in-reply-to ref="...">) to a contained
 * box-relative path (or null on escape). Three forms: card-relative
 * ("msg-001.email-message.card" → next to the draft card), box-relative
 * ("_content/inbox/email/…"), box-absolute ("/_content/inbox/email/…", leading slash) —
 * both box forms resolve from the box root. (`path.resolve` alone mishandles
 * the leading-slash form as host-absolute.) Returns an absolute path proven to
 * stay inside the box (string containment + realpath symlink check), or null on
 * escape — which the caller surfaces as an unresolved ref.
 */
async function resolveCardRef(opts: {
  boxRoot: string;
  cardPath: string;
  ref: string;
}): Promise<string | null> {
  const ref = opts.ref;
  let abs: string;
  if (ref.startsWith("/")) {
    abs = path.join(opts.boxRoot, ref.slice(1));
  } else if (/^_[a-z]+\//.test(ref)) {
    abs = path.join(opts.boxRoot, ref);
  } else {
    abs = path.resolve(path.dirname(opts.cardPath), ref);
  }
  const contained = containWithinBox(opts.boxRoot, abs);
  if (contained === null) return null;
  const safe = await realpathContained(opts.boxRoot, contained);
  return safe === null ? null : path.join(opts.boxRoot, safe);
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
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) {
    throw new StampDraftCardError(opts.cardPath, `${opts.cardPath} has no frontmatter`);
  }
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatterText);
  } catch (e) {
    throw new StampDraftCardError(opts.cardPath, `invalid YAML in ${opts.cardPath}: ${errorMessage(e)}`);
  }
  if (!isRecord(fm)) {
    throw new StampDraftCardError(opts.cardPath, `frontmatter in ${opts.cardPath} is not a mapping`);
  }
  const fields = fm;
  fields["gmail-draft-id"] = opts.draftId;
  fields["gmail-draft-url"] = opts.draftUrl;
  await fs.writeFile(opts.cardPath, renderFrontmatterBlock(fields, split.body));
}

class MissingFieldError extends Error {
  constructor(readonly field: string) {
    super(`Draft is missing required <${field}>`);
    this.name = "MissingFieldError";
  }
}

class UnresolvedInReplyToRefError extends Error {
  constructor(readonly ref: string, readonly sourcePath: string) {
    super(
      `in-reply-to ref "${ref}" did not resolve to a readable email-message card with message-id and thread-id (looked at ${sourcePath})`,
    );
    this.name = "UnresolvedInReplyToRefError";
  }
}

class StampDraftCardError extends Error {
  constructor(readonly cardPath: string, detail: string) {
    super(`stampDraftCard: ${detail}`);
    this.name = "StampDraftCardError";
  }
}
