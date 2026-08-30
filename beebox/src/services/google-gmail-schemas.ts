/**
 * Inbound zod schemas for the Gmail REST responses the real
 * {@link createGoogleGmailService} consumes (Track D.2). Narrow — only the
 * fields `google-gmail.ts` and `connectors/gmail-mime.ts` actually read — and
 * drift-tolerant: unknown keys are ignored, optionals mirror what Gmail may
 * omit. Used via `validateResponse` at each `.json<T>()` boundary.
 */

import { z } from "zod";

const gmailMessageRefSchema = z.object({
  id: z.string(),
  threadId: z.string(),
});

const gmailHeaderSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const gmailBodySchema = z.object({
  data: z.string().optional(),
  size: z.number().optional(),
  attachmentId: z.string().optional(),
});

/** Recursive: a payload's parts are payloads (multipart MIME tree). */
const gmailPayloadSchema: z.ZodType = z.lazy(() =>
  z.object({
    partId: z.string().optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(gmailHeaderSchema).optional(),
    body: gmailBodySchema.optional(),
    parts: z.array(gmailPayloadSchema).optional(),
  }),
);

export const gmailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  internalDate: z.string().optional(),
  payload: gmailPayloadSchema.optional(),
});

export const gmailThreadSchema = z.object({
  id: z.string(),
  historyId: z.string().optional(),
  messages: z.array(gmailMessageSchema),
});

export const gmailListMessagesSchema = z.object({
  messages: z.array(gmailMessageRefSchema).optional(),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().optional(),
});

export const gmailListThreadsSchema = z.object({
  threads: z.array(z.object({ id: z.string() })).optional(),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().optional(),
});

export const gmailAttachmentDataSchema = z.object({
  data: z.string(),
  size: z.number(),
});

export const gmailListLabelsSchema = z.object({
  labels: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string().optional(),
      }),
    )
    .optional(),
});

export const gmailProfileSchema = z.object({
  emailAddress: z.string(),
  historyId: z.string(),
});

const gmailHistoryStubSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
});

export const gmailListHistorySchema = z.object({
  history: z
    .array(
      z.object({
        id: z.string(),
        messagesAdded: z.array(z.object({ message: gmailHistoryStubSchema })).optional(),
        labelsAdded: z
          .array(z.object({ message: gmailHistoryStubSchema, labelIds: z.array(z.string()) }))
          .optional(),
      }),
    )
    .optional(),
  historyId: z.string(),
  nextPageToken: z.string().optional(),
});

export const gmailDraftSchema = z.object({
  id: z.string(),
  message: z.object({
    id: z.string(),
    threadId: z.string(),
    labelIds: z.array(z.string()).optional(),
  }),
});
