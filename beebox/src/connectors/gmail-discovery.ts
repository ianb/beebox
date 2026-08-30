/** Incremental Gmail change discovery without materializing mailbox contents. */

import { NotFoundError } from "../lib/errors.js";
import type {
  GmailHistoryRecord,
  GmailMessageRef,
  GoogleGmailService,
} from "../services/google-gmail.js";
import type { GmailTransientState } from "./gmail-state.js";

export const GMAIL_HISTORY_REF_LIMIT = 500;
const GMAIL_HISTORY_RECORD_LIMIT = 100;

export interface GmailChanges {
  refs: GmailMessageRef[];
  historyId: string;
  historyResume: GmailTransientState["historyResume"];
  /** An expired cursor cannot reconstruct missed rule matches. */
  historyExpired: boolean;
}

function refsForPage(history: GmailHistoryRecord[]): GmailMessageRef[] {
  const refs = new Map<string, GmailMessageRef>();
  for (const record of history) {
    for (const added of record.messagesAdded ?? []) refs.set(added.message.id, added.message);
    for (const labelled of record.labelsAdded ?? []) {
      refs.set(labelled.message.id, labelled.message);
    }
  }
  return [...refs.values()];
}

/**
 * Return messages added or newly labelled since the prior checkpoint. The
 * first call establishes a checkpoint and intentionally returns no mail.
 */
export async function discoverGmailChanges(opts: {
  service: GoogleGmailService;
  startHistoryId: string | undefined;
  resume?: GmailTransientState["historyResume"];
}): Promise<GmailChanges> {
  if (opts.startHistoryId === undefined) {
    const profile = await opts.service.getProfile();
    return {
      refs: [],
      historyId: profile.historyId,
      historyResume: undefined,
      historyExpired: false,
    };
  }

  const startHistoryId = opts.resume?.startHistoryId ?? opts.startHistoryId;
  const pageToken = opts.resume?.pageToken;
  const refOffset = opts.resume?.refOffset ?? 0;
  try {
    const page = await opts.service.listHistory({
      startHistoryId,
      ...(pageToken === undefined ? {} : { pageToken }),
      maxResults: GMAIL_HISTORY_RECORD_LIMIT,
    });
    const pageRefs = refsForPage(page.history);
    const refs = pageRefs.slice(refOffset, refOffset + GMAIL_HISTORY_REF_LIMIT);
    const nextOffset = refOffset + refs.length;
    if (nextOffset < pageRefs.length) {
      return {
        refs,
        historyId: opts.startHistoryId,
        historyResume: {
          startHistoryId,
          ...(pageToken === undefined ? {} : { pageToken }),
          refOffset: nextOffset,
        },
        historyExpired: false,
      };
    }
    if (page.nextPageToken !== undefined) {
      return {
        refs,
        historyId: opts.startHistoryId,
        historyResume: { startHistoryId, pageToken: page.nextPageToken, refOffset: 0 },
        historyExpired: false,
      };
    }
    return {
      refs,
      historyId: page.historyId,
      historyResume: undefined,
      historyExpired: false,
    };
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    const profile = await opts.service.getProfile();
    return {
      refs: [],
      historyId: profile.historyId,
      historyResume: undefined,
      historyExpired: true,
    };
  }
}
