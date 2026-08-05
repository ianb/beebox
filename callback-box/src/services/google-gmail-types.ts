/**
 * Raw-response shapes for the Gmail REST operations we consume. Narrow (only
 * the fields `google-gmail.ts` / `connectors/gmail-mime.ts` read) — the runtime
 * counterpart lives in `google-gmail-schemas.ts` (Track D.2). Split out of
 * `google-gmail.ts` to keep that file under the line cap; re-exported from it so
 * existing `./google-gmail.js` imports still resolve.
 */

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

export interface GmailThread {
  id: string;
  historyId?: string;
  messages: GmailMessage[];
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
  resultSizeEstimate?: number;
}

export interface ListThreadsResult {
  threads: Array<{ id: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
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

export interface GmailProfile {
  emailAddress: string;
  /** Current mailbox history checkpoint (numeric string). */
  historyId: string;
}

/** Message stub as it appears inside history records. */
export interface GmailHistoryMessageStub {
  id: string;
  threadId: string;
  labelIds?: string[];
}

export interface GmailHistoryRecord {
  id: string;
  messagesAdded?: Array<{ message: GmailHistoryMessageStub }>;
  labelsAdded?: Array<{ message: GmailHistoryMessageStub; labelIds: string[] }>;
}

export interface ListHistoryResult {
  history: GmailHistoryRecord[];
  /** Current mailbox history checkpoint — store and pass back next time. */
  historyId: string;
  nextPageToken?: string;
}
