/**
 * File-backed fake Gmail state (`docs/plans/agent-field-tests.md`, Track 1).
 *
 * Email intake happens in CLI SUBPROCESSES (`cb wakeup` → connector sync →
 * intake → reactor), so the in-process injection
 * `createGmailConnector(boxRoot, service)` offers cannot reach it. This module
 * is the crossing: a JSON document holding the fake's **full** state, which a
 * subprocess reads to reconstruct an equivalent `FakeGoogleGmailService`.
 *
 * The history machinery is serialized EXPLICITLY rather than derived, because
 * the connector's sync is a `historyId` round-trip (`connectors/gmail.ts` —
 * `state.historyId` in, `changes.historyId` out) and the fake models a mailbox
 * where constructor-seeded messages PREDATE history (`createFakeGoogleGmail`)
 * while `addMessage()` appends a `messagesAdded` record. A cursor derived from
 * `messages.length` would silently break both properties: seeded mail would
 * appear in history, and a reloaded fake would rewind its checkpoint.
 * `historyId`, `oldestValidHistoryId` and `historyRecords` therefore travel in
 * the file, and a fake rebuilt from it continues exactly where the file says.
 *
 * The fake never writes back — a run mutates the mailbox through
 * {@link appendMessageToState} (`cb field-test inject-email`) and the connector
 * only reads.
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { writeFileAtomic } from "../lib/atomic-write.js";
import { errorMessage, errnoCode } from "../lib/error-guards.js";
import {
  createFakeGoogleGmail,
  type FakeGoogleGmailService,
} from "../services/google-gmail-fake.js";
import type {
  GmailAttachmentData,
  GmailHistoryRecord,
  GmailLabel,
  GmailMessage,
} from "../services/google-gmail-types.js";

/** Bumped only for a breaking change to the document shape. A run's state file
 *  is disposable, so there is no migration path — an old file is rejected. */
export const FAKE_GMAIL_STATE_VERSION = 1;

const headerSchema = z.strictObject({ name: z.string(), value: z.string() });

const bodySchema = z.strictObject({
  data: z.string().optional(),
  size: z.number().optional(),
  attachmentId: z.string().optional(),
});

/** Recursive: a payload's parts are payloads (the multipart MIME tree). */
const payloadSchema: z.ZodType = z.lazy(() =>
  z.strictObject({
    partId: z.string().optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(headerSchema).optional(),
    body: bodySchema.optional(),
    parts: z.array(payloadSchema).optional(),
  }),
);

const messageSchema = z.strictObject({
  id: z.string().min(1),
  threadId: z.string().min(1),
  labelIds: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  internalDate: z.string().optional(),
  payload: payloadSchema.optional(),
});

const historyStubSchema = z.strictObject({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
});

const historyRecordSchema = z.strictObject({
  id: z.string(),
  messagesAdded: z.array(z.strictObject({ message: historyStubSchema })).optional(),
  labelsAdded: z
    .array(z.strictObject({ message: historyStubSchema, labelIds: z.array(z.string()) }))
    .optional(),
});

const fakeGmailStateSchema = z.strictObject({
  version: z.literal(FAKE_GMAIL_STATE_VERSION),
  messages: z.array(messageSchema),
  labels: z.array(z.strictObject({ id: z.string(), name: z.string(), type: z.string().optional() })),
  /** Keyed `${messageId}:${attachmentId}` — the fake's Map, flattened. */
  attachments: z.record(z.string(), z.strictObject({ data: z.string(), size: z.number() })),
  historyId: z.number().int().positive(),
  oldestValidHistoryId: z.number().int().positive(),
  historyRecords: z.array(historyRecordSchema),
});

/**
 * The serialized mailbox. Typed with the Gmail domain types (not
 * `z.infer`) so it drops straight into the fake's options.
 */
export interface FakeGmailState {
  version: typeof FAKE_GMAIL_STATE_VERSION;
  messages: GmailMessage[];
  labels: GmailLabel[];
  attachments: Record<string, GmailAttachmentData>;
  historyId: number;
  oldestValidHistoryId: number;
  historyRecords: GmailHistoryRecord[];
}

/** The state file is missing, unparseable, or does not match the format. */
class FakeGmailStateError extends Error {
  constructor({ statePath, detail }: { statePath: string; detail: string }) {
    super(`Fake Gmail state ${statePath}: ${detail}`);
    this.name = "FakeGmailStateError";
  }
}

/** A message id already present in the mailbox — injecting it again would give
 *  the fake two messages answering to one `getMessage()`. */
class FakeGmailDuplicateMessageError extends Error {
  constructor(id: string) {
    super(`Fake Gmail state already contains message "${id}"`);
    this.name = "FakeGmailDuplicateMessageError";
  }
}

/**
 * Zod's inferred optionals are `T | undefined`; the Gmail domain types are
 * exact-optional (`exactOptionalPropertyTypes`). A JSON document cannot carry
 * an explicit `undefined`, so a value that parsed clean already satisfies the
 * domain shape — this helper is the single place that says so.
 */
function asFakeGmailState(parsed: z.infer<typeof fakeGmailStateSchema>): FakeGmailState {
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: see the doc comment above; JSON has no `undefined`, so the shapes are identical at runtime.
  return parsed as unknown as FakeGmailState;
}

/** A mailbox with nothing in it, at the fake's own starting checkpoint. */
export function emptyFakeGmailState(): FakeGmailState {
  return {
    version: FAKE_GMAIL_STATE_VERSION,
    messages: [],
    labels: [],
    attachments: {},
    historyId: 1,
    oldestValidHistoryId: 1,
    historyRecords: [],
  };
}

/** Read and validate a state file. Every failure — absent, unreadable, bad
 *  JSON, wrong shape — surfaces as one error naming the path. */
export async function loadFakeGmailState(statePath: string): Promise<FakeGmailState> {
  let raw: string;
  try {
    raw = await readFile(statePath, "utf-8");
  } catch (e) {
    const detail = errnoCode(e) === "ENOENT" ? "no such file" : errorMessage(e);
    throw new FakeGmailStateError({ statePath, detail });
  }
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (e) {
    throw new FakeGmailStateError({ statePath, detail: `invalid JSON — ${errorMessage(e)}` });
  }
  const result = fakeGmailStateSchema.safeParse(document);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new FakeGmailStateError({ statePath, detail: `does not match the format — ${issues}` });
  }
  return asFakeGmailState(result.data);
}

/** Write a state file, atomically — a torn write would strand a run's mailbox. */
export async function saveFakeGmailState(
  statePath: string,
  state: FakeGmailState,
): Promise<void> {
  await writeFileAtomic(statePath, { content: `${JSON.stringify(state, null, 2)}\n` });
}

/**
 * Rebuild a fake from serialized state. Messages go in as constructor-seeded
 * (predating history) and the file's own `historyRecords` are restored on top,
 * so a message injected before the reload is still visible to `listHistory`
 * from the checkpoint that preceded it.
 */
export function createFakeGmailFromState(state: FakeGmailState): FakeGoogleGmailService {
  return createFakeGoogleGmail({
    messages: state.messages.map((message) => structuredClone(message)),
    labels: state.labels.map((label) => ({ ...label })),
    attachments: new Map(Object.entries(state.attachments).map(([key, value]) => [key, { ...value }])),
    historyId: state.historyId,
    oldestValidHistoryId: state.oldestValidHistoryId,
    historyRecords: state.historyRecords.map((record) => structuredClone(record)),
  });
}

/**
 * Append one message plus its `messagesAdded` history record at a fresh
 * checkpoint — the file-level equivalent of the fake's `addMessage()`, and the
 * only way mail "arrives" in a field run.
 */
export function appendMessageToState(opts: {
  state: FakeGmailState;
  message: GmailMessage;
  /** Attachment bodies for this message, keyed by attachment id. */
  attachments?: Record<string, GmailAttachmentData>;
}): FakeGmailState {
  const { state, message } = opts;
  if (state.messages.some((existing) => existing.id === message.id)) {
    throw new FakeGmailDuplicateMessageError(message.id);
  }
  const historyId = state.historyId + 1;
  const stub: GmailHistoryRecord["messagesAdded"] = [
    {
      message: {
        id: message.id,
        threadId: message.threadId,
        ...(message.labelIds === undefined ? {} : { labelIds: [...message.labelIds] }),
      },
    },
  ];
  const attachments = { ...state.attachments };
  for (const [attachmentId, data] of Object.entries(opts.attachments ?? {})) {
    attachments[`${message.id}:${attachmentId}`] = data;
  }
  // A label the mailbox has never seen is registered here rather than left
  // dangling: `label:` rule queries resolve NAMES through `listLabels()`, so an
  // unregistered `INBOX` would make every such rule silently match nothing —
  // the exact "mail stops arriving and sync still says success" failure the
  // tier exists to catch.
  const known = new Set(state.labels.map((label) => label.id));
  const labels = [
    ...state.labels,
    ...[...new Set(message.labelIds)]
      .filter((id) => !known.has(id))
      .map((id) => ({ id, name: id, type: "system" })),
  ];
  return {
    ...state,
    messages: [...state.messages, message],
    labels,
    attachments,
    historyId,
    historyRecords: [...state.historyRecords, { id: String(historyId), messagesAdded: stub }],
  };
}
