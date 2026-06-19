/**
 * Shared utilities for chat thread manipulation.
 *
 * Used by messaging connectors (Telegram, etc.) to:
 * - Append messages to thread YAML files
 * - Find unsent agent messages for outbound delivery
 * - Find pending chat jobs for deduplication
 * - Manage people directory entries
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import sanitize from "sanitize-filename";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { splitCardContent } from "../cards/index.js";
import {
  createChatThreadTemplate,
  createMessageEntry,
  type ChatThreadFields,
  type ChatThreadMessage,
} from "../schemas/chat-thread.js";
import { createChatJobTemplate, type ChatJobFields } from "../schemas/chat-job.js";
import { getBoxTimeISO } from "../cli/lib/time.js";
import { sanitizeFilenameStem } from "../lib/filename.js";

class MissingFrontmatterError extends Error {
  constructor(absPath: string) {
    super(`Chat thread missing frontmatter: ${absPath}`);
    this.name = "MissingFrontmatterError";
  }
}

export function safeFilename(text: string, fallback?: string): string {
  fallback = fallback ?? "untitled";
  return sanitizeFilenameStem(sanitize(text), { fallback });
}

async function readThreadFields(absPath: string): Promise<ChatThreadFields> {
  const content = await fs.readFile(absPath, "utf-8");
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) {
    throw new MissingFrontmatterError(absPath);
  }
  return parseYaml(split.frontmatterText) as ChatThreadFields;
}

async function writeThreadFields(absPath: string, fields: ChatThreadFields): Promise<void> {
  await fs.writeFile(absPath, `---\n${stringifyYaml(fields)}---\n`);
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
  const threadDir = path.join(boxRoot, "store/chat", connector, chatSlug);
  const threadPath = path.join(threadDir, "thread.chat-thread.card");

  try {
    await fs.access(threadPath);
  } catch (_e) {
    // access() throws when the thread file doesn't exist yet — that's the
    // signal to create it. The error carries no actionable detail.
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
 * Add a participant to a thread's participants[] if not already present.
 */
export async function ensureParticipant(options: {
  boxRoot: string;
  threadRelPath: string;
  personRef: string;
}): Promise<void> {
  const absPath = path.join(options.boxRoot, options.threadRelPath);
  const fields = await readThreadFields(absPath);
  const participants = fields.participants ?? [];
  if (participants.some((p) => p.ref === options.personRef)) return;
  fields.participants = [...participants, { ref: options.personRef }];
  await writeThreadFields(absPath, fields);
}

/**
 * Append a message entry to a thread's entries[].
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
  const fields = await readThreadFields(absPath);
  fields.entries = [...(fields.entries ?? []), createMessageEntry(options.message)];
  await writeThreadFields(absPath, fields);
}

/**
 * Find unsent agent messages in a thread file.
 */
export async function findUnsentAgentMessages(
  absPath: string
): Promise<{
  fields: ChatThreadFields;
  unsent: ChatThreadMessage[];
}> {
  const fields = await readThreadFields(absPath);
  const unsent: ChatThreadMessage[] = [];
  for (const entry of fields.entries ?? []) {
    if (entry.kind === "message" && entry.sender === "agent" && entry.sent === undefined) {
      unsent.push(entry);
    }
  }
  return { fields, unsent };
}

/**
 * Stamp a sent timestamp and optional id on an unsent agent message.
 * Finds the message by matching text content.
 */
export async function stampSentMessage(options: {
  absPath: string;
  messageText: string;
  sentAt: string;
  messageId?: string;
}): Promise<void> {
  const fields = await readThreadFields(options.absPath);
  for (const entry of fields.entries ?? []) {
    if (
      entry.kind === "message" &&
      entry.sender === "agent" &&
      entry.sent === undefined &&
      entry.text === options.messageText
    ) {
      entry.sent = options.sentAt;
      if (options.messageId !== undefined) entry.id = options.messageId;
      await writeThreadFields(options.absPath, fields);
      return;
    }
  }
}

/**
 * Find an existing pending chat job for a given thread ref.
 */
export async function findExistingChatJob(
  boxRoot: string,
  threadRef: string
): Promise<string | null> {
  const jobsDir = path.join(boxRoot, "box/jobs");
  let entries: string[];
  try {
    entries = await fs.readdir(jobsDir);
  } catch (_e) {
    // No jobs directory means no existing chat jobs — nothing to find.
    return null;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".chat.job.card")) continue;
    const filePath = path.join(jobsDir, entry);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const split = splitCardContent(content);
      if (!split.hasFrontmatter) continue;
      const fields = parseYaml(split.frontmatterText) as ChatJobFields;
      if (fields.status !== "pending") continue;
      if (fields.thread?.ref === threadRef) {
        return path.relative(boxRoot, filePath);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Skipping unreadable chat job file ${filePath}:`, e);
      }
      continue;
    }
  }
  return null;
}

/**
 * Create a chat job for a thread, unless one already exists.
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
 *
 * Also ensures a minimal `people/<slug>.person.card` exists so refs from
 * chat-thread and similar can resolve. Without that, every newly-seen
 * Telegram correspondent triggers a broken-reference at validate time.
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
  const personCardPath = path.join(boxRoot, "people", `${slug}.person.card`);

  // Seed a minimal person card if none exists. The connector knows the
  // display name and not much else; the boxholder is expected to enrich
  // the card later. Doesn't overwrite existing cards.
  try {
    await fs.access(personCardPath);
  } catch (_e) {
    // access() throws when no person card exists yet — that's the signal to
    // seed a minimal one. The error carries no actionable detail.
    const cardYaml = `status: active\nname: ${displayName}\n`;
    await fs.writeFile(personCardPath, `---\n${cardYaml}---\n`);
  }

  const data: Record<string, string | number> = {
    [`${connector}Id`]: options.connectorId,
    firstName,
  };
  if (lastName) data.lastName = lastName;
  if (username) data.username = username;

  try {
    const existing = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(existing);
    if (JSON.stringify(parsed) === JSON.stringify(data)) {
      return null;
    }
  } catch (_e) {
    // File doesn't exist (or is unparseable) — fall through to write it.
  }

  await fs.mkdir(personDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
  return path.relative(boxRoot, filePath);
}
