/** Write complete Gmail thread snapshots into tracked email-thread cards. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseFrontmatterObject } from "../cards/index.js";
import { createEmailThreadTemplate } from "../schemas/email-thread.js";
import { createEmailMessageTemplate } from "../schemas/email-message.js";
import { attachDirFor } from "../shared/attach-path.js";
import { withCardLock } from "../lib/card-lock.js";
import { invariant } from "../lib/invariant.js";
import { safeDirectoryName, makeSnippet, type FetchedMessage } from "./gmail-mime.js";
import { preserveAgentFields } from "./preserve-agent-fields.js";
import { findTrackedGmailThreads, type TrackedGmailThread } from "./gmail-tracking.js";
import type { ThreadNote } from "./gmail-commit.js";

const MESSAGE_CARD_RE = /^msg-\d+\.email-message\.card$/;

export interface WriteThreadsResult {
  created: string[];
  updated: string[];
  notes: ThreadNote[];
  seenMessageIds: string[];
}

interface ExistingMessages {
  ids: Set<string>;
  refs: string[];
}

export class InvalidTrackedGmailMessageCardError extends Error {
  readonly cardPath: string;

  constructor(cardPath: string) {
    super(`Tracked Gmail message card has no valid message-id: ${cardPath}`);
    this.name = "InvalidTrackedGmailMessageCardError";
    this.cardPath = cardPath;
  }
}

function groupByThread(messages: FetchedMessage[]): Map<string, FetchedMessage[]> {
  const threads = new Map<string, FetchedMessage[]>();
  for (const message of messages) {
    const existing = threads.get(message.threadId) ?? [];
    existing.push(message);
    threads.set(message.threadId, existing);
  }
  return threads;
}

async function readExistingMessages(attachDir: string): Promise<ExistingMessages> {
  let entries: string[];
  try {
    entries = await fs.readdir(attachDir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { ids: new Set(), refs: [] };
    }
    throw error;
  }
  const refs = entries.filter((entry) => MESSAGE_CARD_RE.test(entry)).toSorted();
  const ids = new Set<string>();
  for (const ref of refs) {
    const cardPath = path.join(attachDir, ref);
    const fields = parseFrontmatterObject(await fs.readFile(cardPath, "utf-8"));
    const messageId = fields?.["message-id"];
    if (typeof messageId !== "string" || messageId === "") {
      throw new InvalidTrackedGmailMessageCardError(cardPath);
    }
    ids.add(messageId);
  }
  return { ids, refs };
}

function collectParticipants(messages: FetchedMessage[]): string[] {
  const participants = new Set<string>();
  for (const message of messages) {
    participants.add(message.from);
    for (const field of [message.to, message.cc]) {
      if (field === undefined) continue;
      for (const address of field.split(",").map((value) => value.trim())) {
        if (address !== "") participants.add(address);
      }
    }
  }
  return [...participants];
}

function messageTemplateOptions(
  message: FetchedMessage,
  bodyFilename: string,
): Parameters<typeof createEmailMessageTemplate>[0] {
  return {
    messageId: message.messageId,
    threadId: message.threadId,
    from: message.from,
    to: message.to,
    ...(message.cc === undefined ? {} : { cc: message.cc }),
    date: message.date,
    subject: message.subject,
    snippet: makeSnippet(message.textBody),
    bodyFile: bodyFilename,
    ...(message.attachments.length === 0
      ? {}
      : {
          attachments: message.attachments.map((attachment) => ({
            ref: `attachments/${attachment.filename}`,
            contentType: attachment.contentType,
            size: attachment.size,
          })),
        }),
  };
}

async function writeMessage(opts: {
  message: FetchedMessage;
  messageNumber: number;
  attachDir: string;
  boxRoot: string;
}): Promise<{ paths: string[]; ref: string }> {
  const number = String(opts.messageNumber).padStart(3, "0");
  const basename = `msg-${number}`;
  const ref = `${basename}.email-message.card`;
  const bodyFilename = `${basename}.body.txt`;
  const messageAttachDir = path.join(opts.attachDir, `${basename}.attach`);
  await fs.mkdir(messageAttachDir, { recursive: true });
  const cardPath = path.join(opts.attachDir, ref);
  await fs.writeFile(
    cardPath,
    createEmailMessageTemplate(messageTemplateOptions(opts.message, bodyFilename)),
  );
  const bodyPath = path.join(messageAttachDir, bodyFilename);
  await fs.writeFile(bodyPath, opts.message.textBody);
  const paths = [path.relative(opts.boxRoot, cardPath), path.relative(opts.boxRoot, bodyPath)];
  if (opts.message.attachments.length > 0) {
    const attachmentDir = path.join(messageAttachDir, "attachments");
    await fs.mkdir(attachmentDir, { recursive: true });
    for (const attachment of opts.message.attachments) {
      const attachmentPath = path.join(attachmentDir, attachment.filename);
      await fs.writeFile(attachmentPath, attachment.content);
      paths.push(path.relative(opts.boxRoot, attachmentPath));
    }
  }
  return { paths, ref };
}

function cardLocation(opts: {
  boxRoot: string;
  threadId: string;
  subject: string;
  tracked: TrackedGmailThread | undefined;
}): { cardPath: string; attachDir: string; isNew: boolean } {
  if (opts.tracked !== undefined) {
    return {
      cardPath: opts.tracked.absPath,
      attachDir: attachDirFor(opts.tracked.absPath),
      isNew: false,
    };
  }
  const emailDir = path.join(opts.boxRoot, "box/inbox/email");
  const basename = safeDirectoryName(opts.subject, opts.threadId);
  const cardPath = path.join(emailDir, `${basename}.email-thread.card`);
  return { cardPath, attachDir: attachDirFor(cardPath), isNew: true };
}

async function writeThreadCard(opts: {
  cardPath: string;
  threadId: string;
  messages: FetchedMessage[];
  refs: string[];
  isNew: boolean;
}): Promise<boolean> {
  const first = opts.messages[0];
  const last = opts.messages.at(-1);
  invariant(first !== undefined && last !== undefined, "a Gmail thread snapshot has at least one message");
  const labels = new Set(opts.messages.flatMap((message) => message.labels));
  const template = createEmailThreadTemplate({
    threadId: opts.threadId,
    subject: first.subject,
    participants: collectParticipants(opts.messages),
    dateStart: first.date,
    dateEnd: last.date,
    messageRefs: opts.refs.toSorted(),
    ...(labels.size === 0 ? {} : { labels: [...labels] }),
    ...(opts.isNew ? { status: "new" } : {}),
  });
  const content = await preserveAgentFields(template, { existingPath: opts.cardPath });
  let existing: string | null = null;
  try {
    existing = await fs.readFile(opts.cardPath, "utf-8");
  } catch (_error) {
    // A new tracked card has no existing content to compare.
  }
  if (existing === content) return false;
  await fs.writeFile(opts.cardPath, content);
  return true;
}

async function writeOneThread(opts: {
  boxRoot: string;
  threadId: string;
  messages: FetchedMessage[];
  tracked: TrackedGmailThread | undefined;
  result: WriteThreadsResult;
}): Promise<void> {
  opts.messages.sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
  const first = opts.messages[0];
  invariant(first !== undefined, "a grouped Gmail thread has at least one message");
  const location = cardLocation({
    boxRoot: opts.boxRoot,
    threadId: opts.threadId,
    subject: first.subject,
    tracked: opts.tracked,
  });
  await withCardLock(location.cardPath, async () => {
    await fs.mkdir(path.dirname(location.cardPath), { recursive: true });
    await fs.mkdir(location.attachDir, { recursive: true });
    const existing = await readExistingMessages(location.attachDir);
    const refs = [...existing.refs];
    let newMessageCount = 0;
    for (const message of opts.messages) {
      opts.result.seenMessageIds.push(message.messageId);
      if (existing.ids.has(message.messageId)) continue;
      newMessageCount += 1;
      const written = await writeMessage({
        message,
        messageNumber: existing.refs.length + newMessageCount,
        attachDir: location.attachDir,
        boxRoot: opts.boxRoot,
      });
      refs.push(written.ref);
      opts.result.created.push(...written.paths);
    }
    const cardChanged = await writeThreadCard({
      cardPath: location.cardPath,
      threadId: opts.threadId,
      messages: opts.messages,
      refs,
      isNew: location.isNew,
    });
    const cardRelPath = path.relative(opts.boxRoot, location.cardPath);
    if (location.isNew) opts.result.created.push(cardRelPath);
    else if (cardChanged) opts.result.updated.push(cardRelPath);
    if (location.isNew || cardChanged || newMessageCount > 0) {
      opts.result.notes.push({
        subject: first.subject,
        from: first.from,
        isNew: location.isNew,
        messageCount: newMessageCount,
      });
    }
  });
}

/** Write complete Gmail thread snapshots, creating cards only for unknown IDs. */
export async function writeThreadCards(opts: {
  boxRoot: string;
  messages: FetchedMessage[];
  /** When supplied, unknown thread IDs are created only if explicitly allowed. */
  createThreadIds?: ReadonlySet<string>;
}): Promise<WriteThreadsResult> {
  const result: WriteThreadsResult = { created: [], updated: [], notes: [], seenMessageIds: [] };
  const tracked = await findTrackedGmailThreads(opts.boxRoot);
  for (const [threadId, messages] of groupByThread(opts.messages)) {
    const existing = tracked.get(threadId);
    if (existing === undefined && opts.createThreadIds?.has(threadId) === false) {
      console.warn(`Gmail: tracked card disappeared during sync; not recreating thread ${threadId}`);
      continue;
    }
    await writeOneThread({
      boxRoot: opts.boxRoot,
      threadId,
      messages,
      tracked: existing,
      result,
    });
  }
  return result;
}
