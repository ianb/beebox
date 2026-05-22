/**
 * Shared utilities for chat thread manipulation.
 *
 * Used by messaging connectors (Telegram, etc.) to:
 * - Append messages to thread XML files
 * - Find unsent agent messages for outbound delivery
 * - Find pending chat jobs for deduplication
 * - Manage people directory entries
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import sanitize from "sanitize-filename";
import { parseCard, escapeAttr, type ElementNode } from "cardworks";
import {
  createChatThreadTemplate,
  createMessageElement,
} from "../schemas/chat-thread.js";
import { createChatJobTemplate } from "../schemas/chat-job.js";
import { getBoxTimeISO } from "../cli/lib/time.js";
import { sanitizeFilenameStem } from "../lib/filename.js";

/**
 * Safe filename stem for a display name/title. Runs through the
 * OS-forbidden-char pass from `sanitize-filename` before applying our
 * shared {@link sanitizeFilenameStem}. Does NOT preserve file extensions —
 * callers that need to keep `.pdf` etc should use
 * {@link sanitizeFilename} from `src/lib/filename.ts` instead.
 */
export function safeFilename(text: string, fallback = "untitled"): string {
  return sanitizeFilenameStem(sanitize(text), { fallback });
}

/**
 * Ensure a thread file exists for the given chat. Returns the relative path.
 */
export async function ensureThreadFile(options: {
  boxRoot: string;
  connector: string;
  chatSlug: string;
  chatId: string;
  description?: string;
  participants?: string[];
}): Promise<string> {
  const { boxRoot, connector, chatSlug, chatId } = options;
  const threadDir = path.join(
    boxRoot,
    "store/chat",
    connector,
    chatSlug
  );
  const threadPath = path.join(threadDir, "thread.chat-thread.card");

  try {
    await fs.access(threadPath);
  } catch {
    await fs.mkdir(threadDir, { recursive: true });
    const content = createChatThreadTemplate({
      chatId,
      connector,
      ...(options.description != null ? { description: options.description } : {}),
      ...(options.participants != null ? { participants: options.participants } : {}),
    });
    await fs.writeFile(threadPath, content);
  }

  return path.relative(boxRoot, threadPath);
}

/**
 * Add a participant to a thread's <participants> block if not already present.
 * Creates the <participants> block if it doesn't exist.
 */
export async function ensureParticipant(options: {
  boxRoot: string;
  threadRelPath: string;
  personRef: string;
}): Promise<void> {
  const absPath = path.join(options.boxRoot, options.threadRelPath);
  let content = await fs.readFile(absPath, "utf-8");

  // Already listed?
  if (content.includes(`ref="${options.personRef}"`)) return;

  const personLine = `    <person ref="${escapeAttr(options.personRef)}" />`;

  if (content.includes("</participants>")) {
    // Append inside existing block
    content = content.replace(
      /<\/participants>/,
      `${personLine}\n  </participants>`
    );
  } else {
    // Insert a participants block after <description> or at the start
    const insertPoint = content.includes("</description>")
      ? content.indexOf("</description>") + "</description>".length
      : content.indexOf(">") + 1;

    const before = content.slice(0, insertPoint);
    const after = content.slice(insertPoint);
    content = `${before}\n  <participants>\n${personLine}\n  </participants>${after}`;
  }

  await fs.writeFile(absPath, content);
}

/**
 * Append a message element to a thread file.
 * Inserts before the closing </chat-thread> tag.
 */
export async function appendMessageToThread(options: {
  boxRoot: string;
  threadRelPath: string;
  message: {
    id?: string;
    sender: string;
    senderId?: string;
    time?: string;
    sent?: string;
    text: string;
  };
}): Promise<void> {
  const absPath = path.join(options.boxRoot, options.threadRelPath);
  const content = await fs.readFile(absPath, "utf-8");
  const msgXml = createMessageElement(options.message);

  const updated = content.replace(
    /<\/chat-thread>/,
    `${msgXml}\n</chat-thread>`
  );
  await fs.writeFile(absPath, updated);
}

/**
 * Find unsent agent messages in a thread file.
 * Returns the parsed thread root and an array of unsent message nodes.
 */
export async function findUnsentAgentMessages(
  absPath: string
): Promise<{
  root: ElementNode;
  unsent: ElementNode[];
}> {
  const content = await fs.readFile(absPath, "utf-8");
  const root = await parseCard(content, { source: path.basename(absPath) });
  const unsent: ElementNode[] = [];

  for (const child of root.children) {
    if (
      child.tagName === "message" &&
      child.attrs.sender === "agent" &&
      !child.attrs.sent
    ) {
      unsent.push(child);
    }
  }

  return { root, unsent };
}

/**
 * Stamp a sent attribute and optional id on an agent message in the thread file.
 * Finds the message by matching text content (since unsent messages have no id).
 */
export async function stampSentMessage(options: {
  absPath: string;
  messageText: string;
  sentAt: string;
  messageId?: string;
}): Promise<void> {
  let content = await fs.readFile(options.absPath, "utf-8");

  // Find the unsent agent message and add sent attribute
  // Match: <message ... sender="agent"...>text</message> without sent=
  // We use a targeted approach: find the specific message line
  const escapedText = options.messageText.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
  const pattern = new RegExp(
    `(<message[^>]*sender="agent"[^>]*)(>)(${escapedText}</message>)`
  );

  const match = content.match(pattern);
  if (!match) return;

  // Only stamp if it doesn't already have sent=
  if (match[1]!.includes("sent=")) return;

  let replacement = `${match[1]} sent="${options.sentAt}"`;
  if (options.messageId) {
    replacement += ` id="${options.messageId}"`;
  }
  replacement += `${match[2]}${match[3]}`;

  content = content.replace(pattern, replacement);
  await fs.writeFile(options.absPath, content);
}

/**
 * Find an existing pending chat job for a given thread ref.
 * Returns the relative path if found, null otherwise.
 */
export async function findExistingChatJob(
  boxRoot: string,
  threadRef: string
): Promise<string | null> {
  const jobsDir = path.join(boxRoot, "box/jobs");
  let entries: string[];
  try {
    entries = await fs.readdir(jobsDir);
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".chat.job.card")) continue;
    const filePath = path.join(jobsDir, entry);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const root = await parseCard(content, { source: entry });
      if (root.attrs.status !== "pending") continue;
      for (const child of root.children) {
        if (child.tagName === "thread" && child.attrs.ref === threadRef) {
          return path.relative(boxRoot, filePath);
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Create a chat job for a thread, unless one already exists.
 * Returns the relative path to the job (new or existing).
 */
export async function createChatJob(options: {
  boxRoot: string;
  threadRef: string;
  description: string;
  source: string;
}): Promise<string> {
  const { boxRoot, threadRef, description, source } = options;

  const existing = await findExistingChatJob(boxRoot, threadRef);
  if (existing) return existing;

  const jobsDir = path.join(boxRoot, "box/jobs");
  await fs.mkdir(jobsDir, { recursive: true });

  const timestamp = getBoxTimeISO(boxRoot)
    .replace(/[.:]/g, "-")
    .slice(0, 19);
  const slug = threadRef
    .replace(/.*\//, "")
    .replace(/\.chat-thread\.card$/, "");
  const jobFilename = `${timestamp}-chat-${safeFilename(slug)}.chat.job.card`;
  const jobPath = path.join(jobsDir, jobFilename);

  const content = createChatJobTemplate({
    created: getBoxTimeISO(boxRoot),
    description,
    threadRef,
    source,
  });
  await fs.writeFile(jobPath, content);
  return path.relative(boxRoot, jobPath);
}

/**
 * Update or create a person's contact file in the people directory.
 */
export async function updatePersonEntry(options: {
  boxRoot: string;
  connector: string;
  connectorId: string | number;
  firstName: string;
  lastName?: string;
  username?: string;
}): Promise<string | null> {
  const { boxRoot, connector, firstName, lastName, username } = options;
  const displayName = [firstName, lastName].filter(Boolean).join(" ");
  const slug = safeFilename(displayName);
  if (!slug) return null;

  const personDir = path.join(boxRoot, "people", slug);
  const filePath = path.join(personDir, `${connector}.json`);

  const data: Record<string, string | number> = {
    [`${connector}Id`]: options.connectorId,
    firstName,
  };
  if (lastName) data.lastName = lastName;
  if (username) data.username = username;

  // Check if file exists and data hasn't changed
  try {
    const existing = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(existing);
    if (JSON.stringify(parsed) === JSON.stringify(data)) {
      return null; // No change
    }
  } catch {
    // File doesn't exist — create it
  }

  await fs.mkdir(personDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
  return path.relative(boxRoot, filePath);
}
