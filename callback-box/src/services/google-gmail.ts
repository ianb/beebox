/**
 * Google Gmail service — typed interface for the Gmail API operations we use.
 *
 * Real implementation calls the REST API with an access token from GoogleAuthService.
 * Fake maintains in-memory messages and labels.
 */

import ky from "ky";
import type { GoogleAuthService } from "./google-auth.js";
import { NotFoundError } from "../lib/errors.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GmailMessageRef {
  id: string;
  threadId: string;
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailBody {
  data?: string;
  size?: number;
  attachmentId?: string;
}

export interface GmailPayload {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailPayload[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  /** Epoch ms as a string (Gmail API quirk) */
  internalDate?: string;
  payload?: GmailPayload;
}

export interface GmailAttachmentData {
  /** base64url-encoded attachment bytes */
  data: string;
  size: number;
}

export interface GmailLabel {
  id: string;
  name: string;
  /** "system" for built-ins like INBOX, "user" for user-created labels */
  type?: string;
}

export interface ListMessagesResult {
  messages: GmailMessageRef[];
  nextPageToken?: string;
}

export interface GmailDraft {
  /** API draft id (e.g. "r-1234567890"); used to update or delete. */
  id: string;
  message: {
    id: string;
    threadId: string;
    labelIds?: string[];
  };
}

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
      const result: ListMessagesResult = { messages: data.messages ?? [] };
      if (data.nextPageToken) result.nextPageToken = data.nextPageToken;
      return result;
    },

    async getMessage(id) {
      return api
        .get(`users/me/messages/${encodeURIComponent(id)}`, {
          searchParams: { format: "full" },
        })
        .json<GmailMessage>();
    },

    async getAttachment(messageId, attachmentId) {
      return api
        .get(
          `users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
        )
        .json<GmailAttachmentData>();
    },

    async listLabels() {
      const data = await api
        .get("users/me/labels")
        .json<{ labels?: GmailLabel[] }>();
      return data.labels ?? [];
    },

    async createDraft(opts) {
      const message: { raw: string; threadId?: string } = { raw: opts.raw };
      if (opts.threadId) message.threadId = opts.threadId;
      return api
        .post("users/me/drafts", { json: { message } })
        .json<GmailDraft>();
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
}

export function createFakeGoogleGmail(
  opts?: FakeGoogleGmailOptions,
): FakeGoogleGmailService {
  let draftSeq = 0;
  const fake: FakeGoogleGmailService = {
    messages: [...(opts?.messages ?? [])],
    labels: [...(opts?.labels ?? [])],
    attachments: opts?.attachments ? new Map(opts.attachments) : new Map(),
    drafts: [],

    async listMessages(_opts) {
      return {
        messages: fake.messages.map((m) => ({ id: m.id, threadId: m.threadId })),
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
