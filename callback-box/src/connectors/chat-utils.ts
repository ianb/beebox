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
import { parse as parseYaml } from "yaml";
import { renderFrontmatterBlock, splitCardContent } from "../cards/index.js";
import {
  createChatThreadTemplate,
  createMessageEntry,
  type ChatThreadFields,
  type ChatThreadMessage,
} from "../schemas/chat-thread.js";
import { createChatJobTemplate } from "../schemas/chat-job.js";
import { sanitizeFilenameStem } from "../shared/filename.js";
import { withCardLock } from "../lib/card-lock.js";
import { isRecord } from "../lib/is-record.js";
import { findPendingJobCard, timestampedJobFilename } from "./job-cards.js";

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

/**
 * Raw YAML parse of a thread file's frontmatter — before the schema's own
 * `entries: z.array(ThreadEntry).default([])` has had a chance to run.
 * `ChatThreadFields` promises a validated card (entries always present); this
 * function skips zod validation for speed, so it must be honest that an
 * older or hand-edited thread file can genuinely omit `entries:`.
 */
type RawChatThreadFields = Omit<ChatThreadFields, "entries"> & {
  entries?: ChatThreadFields["entries"];
};

async function readThreadFields(absPath: string): Promise<ChatThreadFields> {
  const content = await fs.readFile(absPath, "utf-8");
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) {
    throw new MissingFrontmatterError(absPath);
  }
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: raw (deliberately unvalidated) thread frontmatter read; whole-shape vouch normalized to ChatThreadFields on return
  const raw = parseYaml(split.frontmatterText) as RawChatThreadFields;
  return { ...raw, entries: raw.entries ?? [] };
}

async function writeThreadFields(absPath: string, fields: ChatThreadFields): Promise<void> {
  await fs.writeFile(absPath, renderFrontmatterBlock(fields));
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

  // Serialize the check-then-create so two first messages for the same new
  // thread can't both pass the access() check and race to create/overwrite the
  // file. Same key as the thread-card RMW helpers below.
  await withCardLock(threadPath, async () => {
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
  });

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
  // Serialize the thread-card RMW so concurrent participant/message writes to
  // the same thread can't clobber each other (see lib/card-lock.ts).
  await withCardLock(absPath, async () => {
    const fields = await readThreadFields(absPath);
    const participants = fields.participants ?? [];
    if (participants.some((p) => p.ref === options.personRef)) return;
    fields.participants = [...participants, { ref: options.personRef }];
    await writeThreadFields(absPath, fields);
  });
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
  // Serialize the thread-card RMW: two inbound messages to the same thread
  // (e.g. concurrent webhook deliveries) must not both read the same entries[]
  // and drop one append.
  await withCardLock(absPath, async () => {
    const fields = await readThreadFields(absPath);
    fields.entries = [...fields.entries, createMessageEntry(options.message)];
    await writeThreadFields(absPath, fields);
  });
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
  for (const entry of fields.entries) {
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
  // Serialize the thread-card RMW so a sent-stamp write can't race with a
  // concurrent append/participant write on the same thread.
  await withCardLock(options.absPath, async () => {
    const fields = await readThreadFields(options.absPath);
    for (const entry of fields.entries) {
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
  });
}

/**
 * Find an existing pending chat job for a given thread ref. Returns the
 * box-relative path, or null when none exists.
 */
async function findExistingChatJob(
  boxRoot: string,
  threadRef: string
): Promise<string | null> {
  const jobsDir = path.join(boxRoot, "box/jobs");
  const found = await findPendingJobCard({
    jobsDir,
    suffix: ".chat.job.card",
    match: (fields) => {
      if (fields["status"] !== "pending") return false;
      const thread = fields["thread"];
      const ref = isRecord(thread) ? thread["ref"] : undefined;
      return ref === threadRef;
    },
  });
  return found === null ? null : path.relative(boxRoot, found);
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

  const slug = threadRef
    .replace(/.*\//, "")
    .replace(/\.chat-thread\.card$/, "");
  const jobFilename = timestampedJobFilename(boxRoot, {
    stem: `chat-${safeFilename(slug)}`,
    extension: "chat.job.card",
  });
  const jobPath = path.join(jobsDir, jobFilename);

  const content = createChatJobTemplate({
    description,
    threadRef,
    source,
  });
  await fs.writeFile(jobPath, content);
  return path.relative(boxRoot, jobPath);
}

export interface UpdatePersonResult {
  /**
   * Relative path to the `people/<slug>.person.card`, returned when the card
   * was created or refreshed (so the caller can stage it). `null` when the
   * card already existed and wasn't touched.
   */
  cardPath: string | null;
  /**
   * Relative path to the connector metadata json
   * (`people/<slug>/<connector>.json`), returned when it was written.
   * `null` when the on-disk metadata already matched.
   */
  metadataPath: string | null;
}

/**
 * Update or create a person's contact file in the people directory.
 *
 * Also ensures a minimal `people/<slug>.person.card` exists so refs from
 * chat-thread and similar can resolve. Without that, every newly-seen
 * Telegram correspondent triggers a broken-reference at validate time.
 *
 * With `force: true`, an existing person card has its connector-derived
 * identity (`name`) refreshed in place — agent-owned fields (status, email,
 * phone, address, role, aliases, contains, body, …) are preserved untouched. Username and
 * numeric ids have no field in the person-card schema; they live in the
 * sibling `<connector>.json` metadata, which is always kept current.
 */
export async function updatePersonEntry(options: {
  boxRoot: string;
  connector: string;
  connectorId: string | number;
  firstName: string;
  lastName?: string;
  username?: string;
  force?: boolean;
}): Promise<UpdatePersonResult> {
  const { boxRoot, connector, firstName, lastName, username, force } = options;
  const displayName = [firstName, lastName].filter(Boolean).join(" ");
  const slug = safeFilename(displayName);
  if (!slug) return { cardPath: null, metadataPath: null };

  const personDir = path.join(boxRoot, "people", slug);
  const filePath = path.join(personDir, `${connector}.json`);
  const personCardPath = path.join(boxRoot, "people", `${slug}.person.card`);

  // Seed a minimal person card if none exists. The connector knows the
  // display name and not much else; the boxholder is expected to enrich
  // the card later. An existing card is left alone unless `force` is set,
  // in which case its `name` is refreshed without clobbering agent fields.
  let cardChanged = false;
  let cardExists = true;
  try {
    await fs.access(personCardPath);
  } catch (_e) {
    // access() throws when no person card exists yet — the signal to seed a
    // minimal one. The error carries no actionable detail.
    cardExists = false;
  }
  if (!cardExists) {
    const cardYaml = `status: active\nname: ${displayName}\n`;
    await fs.writeFile(personCardPath, `---\n${cardYaml}---\n`);
    cardChanged = true;
  } else if (force) {
    cardChanged = await refreshPersonCardName(personCardPath, displayName);
  }
  const cardPath = cardChanged ? path.relative(boxRoot, personCardPath) : null;

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
      return { cardPath, metadataPath: null };
    }
  } catch (_e) {
    // File doesn't exist (or is unparseable) — fall through to write it.
  }

  await fs.mkdir(personDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
  return { cardPath, metadataPath: path.relative(boxRoot, filePath) };
}

/**
 * Refresh the `name` field of an existing person card from the connector's
 * current display name, preserving every other (agent-owned) field and the
 * markdown body. Returns whether the card actually changed.
 */
async function refreshPersonCardName(cardPath: string, name: string): Promise<boolean> {
  const content = await fs.readFile(cardPath, "utf-8");
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return false;
  const parsed: unknown = parseYaml(split.frontmatterText);
  if (!isRecord(parsed)) {
    return false;
  }
  const fields: Record<string, unknown> = { ...parsed };
  if (fields["name"] === name) return false;
  fields["name"] = name;
  await fs.writeFile(cardPath, renderFrontmatterBlock(fields, split.body));
  return true;
}
