/**
 * In-memory fake for {@link GoogleGmailService} — the mailbox doctests and
 * field runs drive instead of the Gmail REST API.
 *
 * Split out of `google-gmail.ts` (which is at its line cap) rather than
 * re-exported from it: the no-barrels rule says import from the module that
 * defines the thing, so callers import the fake from here and the interface
 * from `google-gmail.ts`.
 *
 * History semantics are the fake's whole point beyond storage: messages passed
 * at construction PREDATE history (no records), while `addMessage()` /
 * `addLabelsToMessage()` advance the checkpoint and append a record — which is
 * what makes the connector's `historyId` round-trip testable. The persisted
 * counterpart is `field-test/fake-gmail-state.ts`.
 */

import { NotFoundError } from "../lib/errors.js";
import { messageMatchesQuery } from "./gmail-query-match.js";
import type { GoogleGmailService } from "./google-gmail.js";
import type {
  GmailMessage,
  GmailAttachmentData,
  GmailLabel,
  GmailDraft,
  GmailHistoryMessageStub,
  GmailHistoryRecord,
} from "./google-gmail-types.js";

export interface FakeGoogleGmailOptions {
  messages?: GmailMessage[];
  labels?: GmailLabel[];
  attachments?: Map<string, GmailAttachmentData>;
  /**
   * Resume a PERSISTED mailbox rather than starting a fresh one (see
   * `field-test/fake-gmail-state.ts`). Omit all three for the default
   * "constructor-seeded mail predates history, checkpoint starts at 1".
   * Supplying them keeps that property across a process boundary: `messages`
   * still predate history, and these records are what happened after.
   */
  historyId?: number;
  oldestValidHistoryId?: number;
  historyRecords?: GmailHistoryRecord[];
}

export interface FakeDraftRecord {
  draft: GmailDraft;
  /** base64url-encoded MIME — what was uploaded */
  raw: string;
}

export interface FakeGoogleGmailService extends GoogleGmailService {
  messages: GmailMessage[];
  labels: GmailLabel[];
  /** keyed by `${messageId}:${attachmentId}` */
  attachments: Map<string, GmailAttachmentData>;
  /** Drafts created via createDraft() — tests inspect this directly. */
  drafts: FakeDraftRecord[];
  /** History records accumulated by addMessage/addLabelsToMessage. */
  historyRecords: GmailHistoryRecord[];
  /** Add a message and record a messagesAdded history entry. */
  addMessage(msg: GmailMessage): void;
  /** Add labels to an existing message and record a labelsAdded entry. */
  addLabelsToMessage(change: { id: string; labelIds: string[] }): void;
  /**
   * Remove labels from an existing message (e.g. the user archives it or drops
   * a routing label). No labelsRemoved record is modeled, but the checkpoint
   * advances like a real mutation.
   */
  removeLabelsFromMessage(change: { id: string; labelIds: string[] }): void;
  /** Invalidate all stored checkpoints — listHistory will throw NotFoundError. */
  expireHistory(): void;
}

export function createFakeGoogleGmail(
  opts?: FakeGoogleGmailOptions,
): FakeGoogleGmailService {
  let draftSeq = 0;
  // Messages passed at construction predate history tracking (no records),
  // matching a mailbox whose contents existed before the first checkpoint.
  // A resumed mailbox says where its checkpoints already stood.
  let historyId = opts?.historyId ?? 1;
  let oldestValidHistoryId = opts?.oldestValidHistoryId ?? 1;
  const stubFor = (msg: GmailMessage): GmailHistoryMessageStub => {
    const stub: GmailHistoryMessageStub = { id: msg.id, threadId: msg.threadId };
    if (msg.labelIds) stub.labelIds = [...msg.labelIds];
    return stub;
  };
  const fake: FakeGoogleGmailService = {
    messages: [...(opts?.messages ?? [])],
    labels: [...(opts?.labels ?? [])],
    attachments: opts?.attachments ? new Map(opts.attachments) : new Map(),
    drafts: [],
    historyRecords: [...(opts?.historyRecords ?? [])],

    addMessage(msg) {
      fake.messages.push(msg);
      historyId += 1;
      fake.historyRecords.push({
        id: String(historyId),
        messagesAdded: [{ message: stubFor(msg) }],
      });
    },

    addLabelsToMessage(change) {
      const msg = fake.messages.find((m) => m.id === change.id);
      if (!msg) throw new NotFoundError(change.id, "Message");
      msg.labelIds = [...new Set([...(msg.labelIds ?? []), ...change.labelIds])];
      historyId += 1;
      fake.historyRecords.push({
        id: String(historyId),
        labelsAdded: [{ message: stubFor(msg), labelIds: [...change.labelIds] }],
      });
    },

    removeLabelsFromMessage(change) {
      const msg = fake.messages.find((m) => m.id === change.id);
      if (!msg) throw new NotFoundError(change.id, "Message");
      const remove = new Set(change.labelIds);
      msg.labelIds = (msg.labelIds ?? []).filter((id) => !remove.has(id));
      // No labelsRemoved record is modeled; advance the checkpoint anyway so a
      // following sync sees a moved historyId like a real mutation.
      historyId += 1;
    },

    expireHistory() {
      historyId += 1;
      oldestValidHistoryId = historyId;
      // Mutate in place — withCallLog proxies hold a reference to this array
      fake.historyRecords.length = 0;
    },

    async getProfile() {
      return { emailAddress: "fake@example.com", historyId: String(historyId) };
    },

    async listHistory(listOpts) {
      const start = Number(listOpts.startHistoryId);
      if (Number.isNaN(start) || start < oldestValidHistoryId) {
        throw new NotFoundError(listOpts.startHistoryId, "History");
      }
      return {
        history: fake.historyRecords.filter((r) => Number(r.id) > start),
        historyId: String(historyId),
      };
    },

    async listMessages(listOpts) {
      const matches = fake.messages.filter((message) =>
        messageMatchesQuery({ msg: message, query: listOpts.q, labels: fake.labels }));
      return {
        messages: matches
          .slice(0, listOpts.maxResults)
          .map((m) => ({ id: m.id, threadId: m.threadId })),
        resultSizeEstimate: matches.length,
      };
    },

    async listThreads(listOpts) {
      const matches = fake.messages.filter((message) =>
        messageMatchesQuery({ msg: message, query: listOpts.q, labels: fake.labels }));
      const threadIds = [...new Set(matches.map((message) => message.threadId))];
      return {
        threads: threadIds.slice(0, listOpts.maxResults).map((id) => ({ id })),
        resultSizeEstimate: threadIds.length,
      };
    },

    async getMessage(id) {
      const msg = fake.messages.find((m) => m.id === id);
      if (!msg) throw new NotFoundError(id, "Message");
      return msg;
    },

    async getThread(id) {
      const messages = fake.messages.filter((message) => message.threadId === id);
      if (messages.length === 0) throw new NotFoundError(id, "Thread");
      return { id, messages };
    },

    async getAttachment(messageId, attachmentId) {
      const key = `${messageId}:${attachmentId}`;
      const att = fake.attachments.get(key);
      if (!att) throw new NotFoundError(key, "Attachment");
      return att;
    },

    async listLabels() {
      return fake.labels;
    },

    async createDraft(createOpts) {
      draftSeq += 1;
      const draftId = `r-fake-${draftSeq}`;
      const messageId = `m-fake-${draftSeq}`;
      const threadId = createOpts.threadId ?? `t-fake-${draftSeq}`;
      const draft: GmailDraft = {
        id: draftId,
        message: {
          id: messageId,
          threadId,
          labelIds: ["DRAFT"],
        },
      };
      fake.drafts.push({ draft, raw: createOpts.raw });
      return draft;
    },
  };

  return fake;
}
