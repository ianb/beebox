/**
 * Gmail thread-card writing — given freshly fetched messages, groups them by
 * thread and writes/updates the on-disk card structure under
 * box/inbox/email/: one `*.email-thread.card` per thread plus a sibling
 * `*.attach/` scope holding per-message `*.email-message.card` files, body
 * text, and downloaded attachments.
 *
 * The connector hands us the fetched messages and the box root; we own the
 * filesystem layout decisions (basename matching, message numbering, ref
 * merging) and report back what was created/updated plus per-thread notes.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createEmailThreadTemplate } from "../schemas/email-thread.js";
import { createEmailMessageTemplate } from "../schemas/email-message.js";
import { type FetchedMessage, makeSnippet, safeDirectoryName } from "./gmail-mime.js";
import type { ThreadNote } from "./gmail-commit.js";

const MESSAGE_CARD_RE = /^msg-\d+\.email-message\.card$/;

interface WriteThreadsResult {
  created: string[];
  updated: string[];
  notes: ThreadNote[];
  /** messageIds that were written, to fold into seenMessageIds */
  seenMessageIds: string[];
}

/** Group flat fetched messages into per-thread buckets. */
function groupByThread(messages: FetchedMessage[]): Map<string, FetchedMessage[]> {
  const threads = new Map<string, FetchedMessage[]>();
  for (const msg of messages) {
    const existing = threads.get(msg.threadId) || [];
    existing.push(msg);
    threads.set(msg.threadId, existing);
  }
  return threads;
}

/**
 * Find the basename of an existing thread card for this thread (matched by the
 * short ID suffix), or null if this thread is new.
 */
async function findExistingBasename(emailDir: string, threadId: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(emailDir);
    const suffix = `-${threadId.slice(-8)}`;
    const existingCard = entries.find((e) => e.endsWith(`${suffix}.email-thread.card`));
    if (existingCard) {
      return existingCard.slice(0, -".email-thread.card".length);
    }
  } catch (e) {
    // emailDir doesn't exist yet — treat thread as new
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("Gmail: could not scan email dir for existing thread, treating as new:", e);
    }
  }
  return null;
}

/** Count existing `msg-NNN.email-message.card` files in a thread attach dir. */
async function countExistingMessages(attachDir: string): Promise<number> {
  try {
    const files = await fs.readdir(attachDir);
    return files.filter((f) => f.match(MESSAGE_CARD_RE)).length;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("Gmail: could not read attach dir to count messages:", e);
    }
    return 0;
  }
}

/** Collect the distinct participant addresses across a thread's messages. */
function collectParticipants(threadMessages: FetchedMessage[]): Set<string> {
  const participants = new Set<string>();
  for (const msg of threadMessages) {
    participants.add(msg.from);
    for (const field of [msg.to, msg.cc]) {
      if (!field) continue;
      for (const addr of field.split(",").map((s) => s.trim())) {
        if (addr) participants.add(addr);
      }
    }
  }
  return participants;
}

/** Build the email-message template options for one message. */
function messageTemplateOpts(
  tmsg: FetchedMessage,
  bodyFilename: string,
): Parameters<typeof createEmailMessageTemplate>[0] {
  const opts: Parameters<typeof createEmailMessageTemplate>[0] = {
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
    opts.cc = tmsg.cc;
  }
  if (tmsg.attachments.length > 0) {
    opts.attachments = tmsg.attachments.map((a) => ({
      ref: `attachments/${a.filename}`,
      contentType: a.contentType,
      size: a.size,
    }));
  }
  return opts;
}

/** Write one message's card, body, and attachment files; return paths created. */
async function writeMessage(opts: {
  tmsg: FetchedMessage;
  msgNum: string;
  attachDir: string;
  boxRoot: string;
}): Promise<{ created: string[]; cardFilename: string }> {
  const { tmsg, msgNum, attachDir, boxRoot } = opts;
  const messageBasename = `msg-${msgNum}`;
  const cardFilename = `${messageBasename}.email-message.card`;
  const bodyFilename = `${messageBasename}.body.txt`;
  const messageAttachDir = path.join(attachDir, `${messageBasename}.attach`);
  const created: string[] = [];

  const cardContent = createEmailMessageTemplate(messageTemplateOpts(tmsg, bodyFilename));
  const cardPath = path.join(attachDir, cardFilename);
  await fs.writeFile(cardPath, cardContent);
  created.push(path.relative(boxRoot, cardPath));

  await fs.mkdir(messageAttachDir, { recursive: true });
  const bodyPath = path.join(messageAttachDir, bodyFilename);
  await fs.writeFile(bodyPath, tmsg.textBody);
  created.push(path.relative(boxRoot, bodyPath));

  if (tmsg.attachments.length > 0) {
    const attachmentsSubdir = path.join(messageAttachDir, "attachments");
    await fs.mkdir(attachmentsSubdir, { recursive: true });
    for (const att of tmsg.attachments) {
      const attPath = path.join(attachmentsSubdir, att.filename);
      await fs.writeFile(attPath, att.content);
      created.push(path.relative(boxRoot, attPath));
    }
  }

  return { created, cardFilename };
}

/** Merge any pre-existing message-card refs into the new refs list. */
async function mergeExistingRefs(attachDir: string, messageRefs: string[]): Promise<void> {
  try {
    const files = await fs.readdir(attachDir);
    const existingRefs = files.filter((f) => f.match(MESSAGE_CARD_RE)).toSorted();
    for (const ref of existingRefs) {
      if (!messageRefs.includes(ref)) {
        messageRefs.unshift(ref);
      }
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("Gmail: could not read attach dir to merge message refs:", e);
    }
  }
}

/** Build and write the thread-level card; return its relative path. */
async function writeThreadCard(opts: {
  emailDir: string;
  cardFilename: string;
  threadId: string;
  subject: string;
  participants: Set<string>;
  threadMessages: FetchedMessage[];
  messageRefs: string[];
  isNew: boolean;
  boxRoot: string;
}): Promise<string> {
  const {
    emailDir, cardFilename, threadId, subject, participants,
    threadMessages, messageRefs, isNew, boxRoot,
  } = opts;

  const allLabels = new Set<string>();
  for (const msg of threadMessages) {
    for (const label of msg.labels) allLabels.add(label);
  }

  const firstMsg = threadMessages[0]!;
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
  if (isNew) {
    threadOpts.status = "new";
  }

  const threadCardPath = path.join(emailDir, cardFilename);
  await fs.writeFile(threadCardPath, createEmailThreadTemplate(threadOpts));
  return path.relative(boxRoot, threadCardPath);
}

/** Write the full card structure for a single thread. */
async function writeOneThread(opts: {
  emailDir: string;
  threadId: string;
  threadMessages: FetchedMessage[];
  boxRoot: string;
  result: WriteThreadsResult;
}): Promise<void> {
  const { emailDir, threadId, threadMessages, boxRoot, result } = opts;

  threadMessages.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const firstMsg = threadMessages[0]!;
  const subject = firstMsg.subject;

  const existingBasename = await findExistingBasename(emailDir, threadId);
  const actualBasename = existingBasename ?? safeDirectoryName(subject, threadId);
  const actualCardFilename = `${actualBasename}.email-thread.card`;
  const actualAttachDir = path.join(emailDir, `${actualBasename}.attach`);
  await fs.mkdir(actualAttachDir, { recursive: true });

  const existingCount = await countExistingMessages(actualAttachDir);
  const participants = collectParticipants(threadMessages);

  const messageRefs: string[] = [];
  for (const [i, threadMessage] of threadMessages.entries()) {
    const msgNum = String(existingCount + i + 1).padStart(3, "0");
    const { created, cardFilename } = await writeMessage({
      tmsg: threadMessage!,
      msgNum,
      attachDir: actualAttachDir,
      boxRoot,
    });
    result.created.push(...created);
    messageRefs.push(cardFilename);
  }

  await mergeExistingRefs(actualAttachDir, messageRefs);

  const threadCardRelPath = await writeThreadCard({
    emailDir,
    cardFilename: actualCardFilename,
    threadId,
    subject,
    participants,
    threadMessages,
    messageRefs,
    isNew: !existingBasename,
    boxRoot,
  });
  if (existingBasename) {
    result.updated.push(threadCardRelPath);
  } else {
    result.created.push(threadCardRelPath);
  }

  result.notes.push({
    subject,
    from: firstMsg.from,
    isNew: !existingBasename,
    messageCount: threadMessages.length,
  });

  for (const msg of threadMessages) {
    if (!result.seenMessageIds.includes(msg.messageId)) {
      result.seenMessageIds.push(msg.messageId);
    }
  }
}

/**
 * Group fetched messages by thread and write/update all thread + message cards.
 * Returns created/updated relative paths, per-thread notes, and the messageIds
 * that were written (for folding into the connector's seenMessageIds set).
 */
export async function writeThreadCards(opts: {
  boxRoot: string;
  messages: FetchedMessage[];
}): Promise<WriteThreadsResult> {
  const { boxRoot, messages } = opts;
  const result: WriteThreadsResult = {
    created: [],
    updated: [],
    notes: [],
    seenMessageIds: [],
  };

  const threads = groupByThread(messages);

  const emailDir = path.join(boxRoot, "box/inbox/email");
  await fs.mkdir(emailDir, { recursive: true });

  for (const [threadId, threadMessages] of threads) {
    await writeOneThread({ emailDir, threadId, threadMessages, boxRoot, result });
  }

  return result;
}
