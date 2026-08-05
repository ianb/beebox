/** Incremental Gmail change discovery without materializing mailbox contents. */

import { NotFoundError } from "../lib/errors.js";
import type { GmailMessageRef, GoogleGmailService } from "../services/google-gmail.js";

export interface GmailChanges {
  refs: GmailMessageRef[];
  historyId: string;
  /** An expired cursor cannot reconstruct missed rule matches. */
  historyExpired: boolean;
}

function addRef(byId: Map<string, GmailMessageRef>, ref: GmailMessageRef): void {
  byId.set(ref.id, { id: ref.id, threadId: ref.threadId });
}

/**
 * Return messages added or newly labelled since the prior checkpoint. The
 * first call establishes a checkpoint and intentionally returns no mail.
 */
export async function discoverGmailChanges(opts: {
  service: GoogleGmailService;
  startHistoryId: string | undefined;
}): Promise<GmailChanges> {
  if (opts.startHistoryId === undefined) {
    const profile = await opts.service.getProfile();
    return { refs: [], historyId: profile.historyId, historyExpired: false };
  }

  const byId = new Map<string, GmailMessageRef>();
  let historyId = opts.startHistoryId;
  let pageToken: string | undefined;
  try {
    do {
      const request = pageToken === undefined
        ? { startHistoryId: opts.startHistoryId }
        : { startHistoryId: opts.startHistoryId, pageToken };
      const page = await opts.service.listHistory(request);
      historyId = page.historyId;
      for (const record of page.history) {
        for (const added of record.messagesAdded ?? []) addRef(byId, added.message);
        for (const labelled of record.labelsAdded ?? []) addRef(byId, labelled.message);
      }
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    const profile = await opts.service.getProfile();
    return { refs: [], historyId: profile.historyId, historyExpired: true };
  }
  return { refs: [...byId.values()], historyId, historyExpired: false };
}
