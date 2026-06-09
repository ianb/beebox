/**
 * Gmail pull strategy — decides which message refs a sync should consider.
 *
 * Steady state uses the history API (users.history.list) from a stored
 * checkpoint: only messages added or newly labeled since the last sync are
 * candidates, so a sync never re-lists the whole mailbox. This is also what
 * makes labeling-as-routing work — labeling an old message produces a
 * labelsAdded history record regardless of the message's received date.
 *
 * Full listMessages pagination is the fallback: first sync (no checkpoint),
 * expired checkpoint (Gmail keeps history for a limited time), or a
 * user-authored `query` config (arbitrary Gmail queries can't be evaluated
 * against history records client-side, so query mode always full-lists and
 * relies on the caller's seen-id dedup).
 */

import {
  type GoogleGmailService,
  type GmailMessageRef,
  type GmailHistoryMessageStub,
} from "../services/google-gmail.js";
import { NotFoundError } from "../lib/errors.js";

export interface GmailPullConfig {
  /** Gmail search query (uses Gmail search syntax) */
  query?: string;
  /** Filter to specific labels — joined as label:foo OR label:bar if no query */
  labels?: string[];
}

export interface PullCandidates {
  refs: GmailMessageRef[];
  /** History checkpoint to persist after a successful sync (absent in query mode). */
  historyId?: string;
  /**
   * First-ever sync of the bare label:inbox default: the caller should mark
   * all refs as seen WITHOUT importing, so a fresh box doesn't pull the
   * user's entire inbox in as cards. Label/query configs never set this —
   * there the matched set is bounded by explicit user intent.
   */
  baseline: boolean;
}

export function buildGmailQuery(config: GmailPullConfig): string {
  if (config.query) return config.query;
  if (config.labels && config.labels.length > 0) {
    return config.labels.map((l) => `label:${l}`).join(" OR ");
  }
  return "label:inbox";
}

/** List every message id matching the query, paginating through results. */
async function listAllMatching(
  service: GoogleGmailService,
  query: string,
): Promise<GmailMessageRef[]> {
  const refs: GmailMessageRef[] = [];
  let pageToken: string | undefined;
  do {
    const listOpts: { q: string; pageToken?: string; maxResults: number } = {
      q: query,
      maxResults: 100,
    };
    if (pageToken) listOpts.pageToken = pageToken;
    const result = await service.listMessages(listOpts);
    refs.push(...result.messages);
    pageToken = result.nextPageToken;
  } while (pageToken);
  return refs;
}

/**
 * Resolve the label ids history candidates must carry. Bare default targets
 * INBOX; a labels config targets the ids whose names match (case-insensitive,
 * mirroring Gmail's label: query matching).
 */
function targetLabelIdsFor(
  config: GmailPullConfig,
  labelMap: Map<string, string>,
): Set<string> {
  if (!config.labels || config.labels.length === 0) return new Set(["INBOX"]);
  const wanted = new Set(config.labels.map((l) => l.toLowerCase()));
  const ids = new Set<string>();
  for (const [id, name] of labelMap) {
    if (wanted.has(name.toLowerCase())) ids.add(id);
  }
  return ids;
}

function stubMatches(opts: {
  stub: GmailHistoryMessageStub;
  addedLabelIds?: string[] | undefined;
  targetLabelIds: Set<string>;
}): boolean {
  const { stub, addedLabelIds, targetLabelIds } = opts;
  const carried = [...(stub.labelIds ?? []), ...(addedLabelIds ?? [])];
  return carried.some((id) => targetLabelIds.has(id));
}

async function listViaHistory(opts: {
  service: GoogleGmailService;
  startHistoryId: string;
  targetLabelIds: Set<string>;
}): Promise<PullCandidates> {
  const { service, startHistoryId, targetLabelIds } = opts;
  const byId = new Map<string, GmailMessageRef>();
  let historyId = startHistoryId;
  let pageToken: string | undefined;
  do {
    const listOpts: { startHistoryId: string; pageToken?: string } = {
      startHistoryId,
    };
    if (pageToken) listOpts.pageToken = pageToken;
    const page = await service.listHistory(listOpts);
    historyId = page.historyId;
    for (const record of page.history) {
      for (const added of record.messagesAdded ?? []) {
        if (stubMatches({ stub: added.message, targetLabelIds })) {
          byId.set(added.message.id, {
            id: added.message.id,
            threadId: added.message.threadId,
          });
        }
      }
      for (const change of record.labelsAdded ?? []) {
        const matches = stubMatches({
          stub: change.message,
          addedLabelIds: change.labelIds,
          targetLabelIds,
        });
        if (matches) {
          byId.set(change.message.id, {
            id: change.message.id,
            threadId: change.message.threadId,
          });
        }
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { refs: [...byId.values()], historyId, baseline: false };
}

/**
 * List the message refs this sync should consider, preferring incremental
 * history over a full re-list. The caller still dedups refs against its
 * seen-id state — candidates may include already-imported messages (e.g. a
 * message relabeled after import).
 */
export async function listCandidates(opts: {
  service: GoogleGmailService;
  config: GmailPullConfig;
  labelMap: Map<string, string>;
  startHistoryId: string | undefined;
}): Promise<PullCandidates> {
  const { service, config, labelMap, startHistoryId } = opts;

  if (config.query) {
    const refs = await listAllMatching(service, config.query);
    return { refs, baseline: false };
  }

  const targetLabelIds = targetLabelIdsFor(config, labelMap);
  if (startHistoryId) {
    try {
      return await listViaHistory({ service, startHistoryId, targetLabelIds });
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
      console.warn(
        `Gmail: history checkpoint ${startHistoryId} expired, falling back to full list`,
      );
    }
  }

  // Checkpoint BEFORE listing so anything arriving mid-list lands in the
  // next history window — overlap (deduped by seen ids), never a gap.
  const profile = await service.getProfile();
  const refs = await listAllMatching(service, buildGmailQuery(config));
  const isBareInbox = !config.labels || config.labels.length === 0;
  return {
    refs,
    historyId: profile.historyId,
    baseline: isBareInbox && !startHistoryId,
  };
}
