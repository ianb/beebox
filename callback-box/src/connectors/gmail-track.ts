/** Explicitly track one Gmail thread as a synchronized email-thread card. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { withCardLock } from "../lib/card-lock.js";
import { withFileLock } from "../lib/file-lock.js";
import { stageAndCommitPaths } from "../lib/git.js";
import type { GoogleGmailService } from "../services/google-gmail.js";
import { parseGmailMessage, type FetchedMessage } from "./gmail-mime.js";
import { writeThreadCards } from "./gmail-threads.js";
import { findTrackedGmailThreads } from "./gmail-tracking.js";

export interface TrackGmailThreadResult {
  cardPath: string;
  created: string[];
  updated: string[];
}

export class EmptyGmailThreadError extends Error {
  readonly threadId: string;

  constructor(threadId: string) {
    super(`Gmail thread has no messages: ${threadId}`);
    this.name = "EmptyGmailThreadError";
    this.threadId = threadId;
  }
}

export async function gmailLabelMap(service: GoogleGmailService): Promise<Map<string, string>> {
  const labels = await service.listLabels();
  return new Map(labels.map((label) => [label.id, label.name]));
}

export async function fetchGmailThreadMessages(opts: {
  service: GoogleGmailService;
  threadId: string;
  labelMap?: Map<string, string>;
}): Promise<FetchedMessage[]> {
  const thread = await opts.service.getThread(opts.threadId);
  const labelMap = opts.labelMap ?? await gmailLabelMap(opts.service);
  if (thread.messages.length === 0) throw new EmptyGmailThreadError(opts.threadId);
  const messages: FetchedMessage[] = [];
  for (const raw of thread.messages) {
    const parsed = await parseGmailMessage(raw, { service: opts.service, labelMap });
    if (parsed !== null) messages.push(parsed);
  }
  if (messages.length === 0) throw new EmptyGmailThreadError(opts.threadId);
  return messages;
}

async function trackUnderLock(opts: {
  boxRoot: string;
  service: GoogleGmailService;
  threadId: string;
  trackedBy: string;
}): Promise<TrackGmailThreadResult> {
  const messages = await fetchGmailThreadMessages({ service: opts.service, threadId: opts.threadId });
  const written = await writeThreadCards({ boxRoot: opts.boxRoot, messages });
  const changed = [...written.created, ...written.updated];
  if (changed.length > 0) {
    await stageAndCommitPaths(opts.boxRoot, {
      paths: changed,
      message: `Track Gmail thread: ${messages[0]?.subject ?? opts.threadId}`,
      trailers: { "Tracked-By": opts.trackedBy },
    });
  }
  const tracked = await findTrackedGmailThreads(opts.boxRoot);
  const card = tracked.get(opts.threadId);
  if (card === undefined) throw new EmptyGmailThreadError(opts.threadId);
  return { cardPath: card.relPath, created: written.created, updated: written.updated };
}

/** Fetch, materialize, and commit one Gmail thread. Safe to call repeatedly. */
export async function trackGmailThread(opts: {
  boxRoot: string;
  service: GoogleGmailService;
  threadId: string;
  trackedBy: string;
}): Promise<TrackGmailThreadResult> {
  const lockPath = path.join(opts.boxRoot, ".callback-box/gmail-track.lock");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  return withCardLock(lockPath, () => withFileLock({
    lockPath,
    metadata: { purpose: "gmail-track", threadId: opts.threadId },
    waitMs: 10_000,
  }, () => trackUnderLock(opts)));
}
