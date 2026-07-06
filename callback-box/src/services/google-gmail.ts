/**
 * Google Gmail service — typed interface for the Gmail API operations we use.
 *
 * Real implementation calls the REST API with an access token from GoogleAuthService.
 * Fake maintains in-memory messages and labels.
 */

import ky, { HTTPError } from "ky";
import type { GoogleAuthService } from "./google-auth.js";
import { NotFoundError } from "../lib/errors.js";
import { messageMatchesQuery } from "./gmail-query-match.js";
import { validateResponse } from "./connector-response.js";
import {
  gmailListMessagesSchema,
  gmailMessageSchema,
  gmailAttachmentDataSchema,
  gmailListLabelsSchema,
  gmailProfileSchema,
  gmailListHistorySchema,
  gmailDraftSchema,
} from "./google-gmail-schemas.js";
import type {
  GmailMessageRef,
  GmailMessage,
  GmailAttachmentData,
  GmailLabel,
  GmailProfile,
  GmailDraft,
  GmailHistoryMessageStub,
  GmailHistoryRecord,
  ListMessagesResult,
  ListHistoryResult,
} from "./google-gmail-types.js";

// Raw-response types live in google-gmail-types.ts; re-export so existing
// `./google-gmail.js` type imports keep resolving.
export type * from "./google-gmail-types.js";

// ─── Service interface ───────────────────────────────────────────────────────

export interface GoogleGmailService {
  /** List message refs (id + threadId) matching a Gmail search query. */
  listMessages(opts: {
    q?: string;
    pageToken?: string;
    maxResults?: number;
  }): Promise<ListMessagesResult>;

  /** Fetch a full parsed message (format=full). */
  getMessage(id: string): Promise<GmailMessage>;

  /** Fetch a single attachment's content (base64url-encoded). */
  getAttachment(messageId: string, attachmentId: string): Promise<GmailAttachmentData>;

  /** List all labels (system + user). */
  listLabels(): Promise<GmailLabel[]>;

  /** Fetch the user's profile, including the current historyId checkpoint. */
  getProfile(): Promise<GmailProfile>;

  /**
   * List mailbox changes since a previous historyId checkpoint (messageAdded
   * and labelAdded types). Throws NotFoundError when the checkpoint is too
   * old or invalid — callers fall back to a full listMessages sync.
   */
  listHistory(opts: {
    startHistoryId: string;
    pageToken?: string;
  }): Promise<ListHistoryResult>;

  /**
   * Create a Gmail draft from a base64url-encoded RFC 2822 message.
   * Pass `threadId` to attach the draft to an existing thread (for replies).
   */
  createDraft(opts: { raw: string; threadId?: string }): Promise<GmailDraft>;
}

// ─── Real implementation ─────────────────────────────────────────────────────

export function createGoogleGmailService(auth: GoogleAuthService): GoogleGmailService {
  const api = ky.create({
    prefixUrl: "https://gmail.googleapis.com/gmail/v1",
    retry: 2,
    hooks: {
      beforeRequest: [
        async (request) => {
          const token = await auth.getAccessToken();
          request.headers.set("Authorization", `Bearer ${token}`);
        },
      ],
    },
  });

  return {
    async listMessages(opts) {
      const searchParams: Record<string, string> = {};
      if (opts.q) searchParams["q"] = opts.q;
      if (opts.pageToken) searchParams["pageToken"] = opts.pageToken;
      if (opts.maxResults !== undefined) {
        searchParams["maxResults"] = String(opts.maxResults);
      }
      const data = await api
        .get("users/me/messages", { searchParams })
        .json<{ messages?: GmailMessageRef[]; nextPageToken?: string }>();
      validateResponse(data, { schema: gmailListMessagesSchema, service: "gmail", operation: "listMessages" });
      const result: ListMessagesResult = { messages: data.messages ?? [] };
      if (data.nextPageToken) result.nextPageToken = data.nextPageToken;
      return result;
    },

    async getMessage(id) {
      const data = await api
        .get(`users/me/messages/${encodeURIComponent(id)}`, {
          searchParams: { format: "full" },
        })
        .json<GmailMessage>();
      validateResponse(data, { schema: gmailMessageSchema, service: "gmail", operation: "getMessage" });
      return data;
    },

    async getAttachment(messageId, attachmentId) {
      const data = await api
        .get(
          `users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
        )
        .json<GmailAttachmentData>();
      validateResponse(data, { schema: gmailAttachmentDataSchema, service: "gmail", operation: "getAttachment" });
      return data;
    },

    async listLabels() {
      const data = await api
        .get("users/me/labels")
        .json<{ labels?: GmailLabel[] }>();
      validateResponse(data, { schema: gmailListLabelsSchema, service: "gmail", operation: "listLabels" });
      return data.labels ?? [];
    },

    async getProfile() {
      const data = await api.get("users/me/profile").json<GmailProfile>();
      validateResponse(data, { schema: gmailProfileSchema, service: "gmail", operation: "getProfile" });
      return data;
    },

    async listHistory(opts) {
      const searchParams: Array<[string, string]> = [
        ["startHistoryId", opts.startHistoryId],
        ["historyTypes", "messageAdded"],
        ["historyTypes", "labelAdded"],
      ];
      if (opts.pageToken) searchParams.push(["pageToken", opts.pageToken]);
      try {
        const data = await api
          .get("users/me/history", { searchParams })
          .json<{
            history?: GmailHistoryRecord[];
            historyId: string;
            nextPageToken?: string;
          }>();
        validateResponse(data, { schema: gmailListHistorySchema, service: "gmail", operation: "listHistory" });
        const result: ListHistoryResult = {
          history: data.history ?? [],
          historyId: data.historyId,
        };
        if (data.nextPageToken) result.nextPageToken = data.nextPageToken;
        return result;
      } catch (e) {
        // Gmail returns 404 when startHistoryId is expired or invalid
        if (e instanceof HTTPError && e.response.status === 404) {
          throw new NotFoundError(opts.startHistoryId, "History");
        }
        throw e;
      }
    },

    async createDraft(opts) {
      const message: { raw: string; threadId?: string } = { raw: opts.raw };
      if (opts.threadId) message.threadId = opts.threadId;
      const data = await api
        .post("users/me/drafts", { json: { message } })
        .json<GmailDraft>();
      validateResponse(data, { schema: gmailDraftSchema, service: "gmail", operation: "createDraft" });
      return data;
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakeGoogleGmailOptions {
  messages?: GmailMessage[];
  labels?: GmailLabel[];
  attachments?: Map<string, GmailAttachmentData>;
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
   * a routing label). No history record is modeled — reconciliation diffs the
   * full match set rather than consuming a labelsRemoved signal — but the
   * checkpoint advances like a real mutation.
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
  let historyId = 1;
  let oldestValidHistoryId = 1;
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
    historyRecords: [],

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
      return {
        messages: fake.messages
          .filter((m) => messageMatchesQuery({ msg: m, query: listOpts.q, labels: fake.labels }))
          .map((m) => ({ id: m.id, threadId: m.threadId })),
      };
    },

    async getMessage(id) {
      const msg = fake.messages.find((m) => m.id === id);
      if (!msg) throw new NotFoundError(id, "Message");
      return msg;
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
