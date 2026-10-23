/** Incremental Gmail change discovery without materializing mailbox contents. */

import { NotFoundError } from "../../lib/errors.js";
import type {
  GmailHistoryRecord,
  GmailMessageRef,
  GoogleGmailService,
} from "../../services/google-gmail/core.js";
import type { GmailTransientState } from "./state.js";

export const GMAIL_HISTORY_REF_LIMIT = 500;
/** Gmail's maximum page size for `users.history.list`. */
const GMAIL_HISTORY_RECORD_LIMIT = 500;
/** Bounds one sync's history requests when pages repeat the same messages. */
const GMAIL_HISTORY_PAGE_LIMIT = 20;

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

  const checkpoint = opts.startHistoryId;
  const startHistoryId = opts.resume?.startHistoryId ?? checkpoint;
  let pageToken = opts.resume?.pageToken;
  let refOffset = opts.resume?.refOffset ?? 0;
  // A message both added and labelled across pages is fetched once.
  const refs = new Map<string, GmailMessageRef>();
  const resumeAt = (offset: number): GmailChanges => ({
    refs: [...refs.values()],
    historyId: checkpoint,
    historyResume: { startHistoryId, ...(pageToken === undefined ? {} : { pageToken }), refOffset: offset },
    historyExpired: false,
  });
  try {
    // A backlog drains in one sync up to the ref limit, whatever the box's sync cadence.
    for (let pages = 0; pages < GMAIL_HISTORY_PAGE_LIMIT; pages++) {
      const page = await opts.service.listHistory({
        startHistoryId,
        ...(pageToken === undefined ? {} : { pageToken }),
        maxResults: GMAIL_HISTORY_RECORD_LIMIT,
      });
      const pageRefs = refsForPage(page.history);
      const taken = pageRefs.slice(refOffset, refOffset + GMAIL_HISTORY_REF_LIMIT - refs.size);
      for (const ref of taken) refs.set(ref.id, ref);
      const nextOffset = refOffset + taken.length;
      if (nextOffset < pageRefs.length) return resumeAt(nextOffset);
      if (page.nextPageToken === undefined) {
        return { refs: [...refs.values()], historyId: page.historyId, historyResume: undefined, historyExpired: false };
      }
      pageToken = page.nextPageToken;
      refOffset = 0;
      if (refs.size >= GMAIL_HISTORY_REF_LIMIT) break;
    }
    return resumeAt(0);
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
