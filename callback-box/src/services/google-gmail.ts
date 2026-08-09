/**
 * Google Gmail service — typed interface for the Gmail API operations we use.
 *
 * Real implementation calls the REST API with an access token from
 * GoogleAuthService. The in-memory fake lives in `google-gmail-fake.ts`.
 */

import ky, { HTTPError } from "ky";
import type { GoogleAuthService } from "./google-auth.js";
import { NotFoundError } from "../lib/errors.js";
import { validateResponse } from "./connector-response.js";
import {
  gmailListMessagesSchema,
  gmailMessageSchema,
  gmailThreadSchema,
  gmailAttachmentDataSchema,
  gmailListLabelsSchema,
  gmailProfileSchema,
  gmailListHistorySchema,
  gmailDraftSchema,
} from "./google-gmail-schemas.js";
import type {
  GmailMessageRef,
  GmailMessage,
  GmailThread,
  GmailAttachmentData,
  GmailLabel,
  GmailProfile,
  GmailDraft,
  GmailHistoryRecord,
  ListMessagesResult,
  ListThreadsResult,
  ListHistoryResult,
} from "./google-gmail-types.js";
import { listGmailThreads } from "./google-gmail-threads.js";

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

  /** List Gmail threads matching a search query without fetching contents. */
  listThreads(opts: { q?: string; maxResults?: number }): Promise<ListThreadsResult>;

  /** Fetch a full parsed message (format=full). */
  getMessage(id: string): Promise<GmailMessage>;

  /** Fetch every message in a Gmail thread (format=full). */
  getThread(id: string): Promise<GmailThread>;

  /** Fetch a single attachment's content (base64url-encoded). */
  getAttachment(messageId: string, attachmentId: string): Promise<GmailAttachmentData>;

  /** List all labels (system + user). */
  listLabels(): Promise<GmailLabel[]>;

  /** Fetch the user's profile, including the current historyId checkpoint. */
  getProfile(): Promise<GmailProfile>;

  /**
   * List mailbox changes since a previous historyId checkpoint (messageAdded
   * and labelAdded types). Throws NotFoundError when the checkpoint is too
   * old or invalid — callers establish a new checkpoint without listing mail.
   */
  listHistory(opts: {
    startHistoryId: string;
    pageToken?: string;
    maxResults?: number;
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
        .json<{ messages?: GmailMessageRef[]; nextPageToken?: string; resultSizeEstimate?: number }>();
      validateResponse(data, { schema: gmailListMessagesSchema, service: "gmail", operation: "listMessages" });
      const result: ListMessagesResult = { messages: data.messages ?? [] };
      if (data.nextPageToken) result.nextPageToken = data.nextPageToken;
      if (data.resultSizeEstimate !== undefined) result.resultSizeEstimate = data.resultSizeEstimate;
      return result;
    },

    async listThreads(opts) {
      return listGmailThreads(api, opts);
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

    async getThread(id) {
      const data = await api
        .get(`users/me/threads/${encodeURIComponent(id)}`, {
          searchParams: { format: "full" },
        })
        .json<GmailThread>();
      validateResponse(data, { schema: gmailThreadSchema, service: "gmail", operation: "getThread" });
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
      if (opts.maxResults !== undefined) searchParams.push(["maxResults", String(opts.maxResults)]);
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
