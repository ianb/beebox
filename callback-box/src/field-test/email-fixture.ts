/**
 * Inbound-email fixtures (`docs/plans/agent-field-tests.md`, Track 1).
 *
 * A scenario's `emails/<name>.yaml` describes one message the way a person
 * would — who it is from, what it says, what is attached — and this module
 * turns it into the Gmail API shape the fake serves and
 * `connectors/gmail-mime.ts` parses. Authors never write a MIME tree.
 *
 * ```yaml
 * # emails/dentist-reminder.yaml
 * id: dentist-reminder          # optional; defaults to the filename stem
 * threadId: t-dentist           # optional; defaults to `t-<id>`
 * from: Bright Smiles Dental <appointments@example.com>
 * to: boxholder@example.com
 * cc: partner@example.com       # optional
 * subject: Your appointment on Thursday
 * date: 2026-03-02T09:00:00Z    # optional; defaults to the box clock (CB_TIME)
 * labelIds: [INBOX]             # optional; defaults to [INBOX]
 * body: |
 *   Multi-line plain text.
 * attachments:                  # optional
 *   - filename: flyer.pdf
 *     mimeType: application/pdf
 *     path: ../assets/flyer.pdf # relative to the fixture file
 *   - filename: note.txt
 *     mimeType: text/plain
 *     data: aGVsbG8=            # standard base64, instead of `path`
 * ```
 *
 * Exactly one of `path`/`data` per attachment, and every field is validated —
 * a fixture typo must fail at injection, not as mail that quietly never
 * arrives.
 */

import * as path from "node:path";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { errorMessage } from "../lib/error-guards.js";
import { getBoxTime } from "../lib/time.js";
import type {
  GmailAttachmentData,
  GmailBody,
  GmailMessage,
  GmailPayload,
} from "../services/google-gmail-types.js";

/** Message ids become the `Message-ID` header and part of a card's name, so
 *  they stay to what both accept — no spaces, no angle brackets, no slashes. */
const ID_PATTERN = /^[\w.-]+$/;

/** Strict base64: `Buffer.from(x, "base64")` silently skips anything it does
 *  not recognize, which would hand a scenario author corrupt attachment bytes
 *  and no error. */
const BASE64_PATTERN = /^(?:[\d+/A-Za-z]{4})*(?:[\d+/A-Za-z]{2}==|[\d+/A-Za-z]{3}=)?$/;

const AttachmentSchema = z
  .strictObject({
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    path: z.string().min(1).optional(),
    data: z.string().regex(BASE64_PATTERN, "`data` must be standard base64").optional(),
  })
  .refine(
    (value) => (value.path === undefined) !== (value.data === undefined),
    "give exactly one of `path` (a file beside the fixture) or `data` (base64)",
  );

const EmailFixtureSchema = z.strictObject({
  id: z.string().regex(ID_PATTERN, "letters, digits, `.`, `_` or `-` only").optional(),
  threadId: z.string().min(1).optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  cc: z.string().min(1).optional(),
  subject: z.string().min(1),
  date: z.iso.datetime({ offset: true }).optional(),
  labelIds: z.array(z.string().min(1)).optional(),
  body: z.string(),
  attachments: z.array(AttachmentSchema).optional(),
});

/** The fixture file is unreadable, unparseable, or does not match the format. */
class EmailFixtureError extends Error {
  constructor({ fixturePath, detail }: { fixturePath: string; detail: string }) {
    super(`Email fixture ${fixturePath}: ${detail}`);
    this.name = "EmailFixtureError";
  }
}

export interface LoadedEmailFixture {
  message: GmailMessage;
  /** Attachment bodies keyed by attachment id (not yet message-qualified). */
  attachments: Record<string, GmailAttachmentData>;
}

function textBody(body: string): GmailBody {
  const encoded = Buffer.from(body, "utf-8");
  return { data: encoded.toString("base64url"), size: encoded.byteLength };
}

async function attachmentBytes(opts: {
  fixturePath: string;
  attachment: z.infer<typeof AttachmentSchema>;
}): Promise<Buffer> {
  const { fixturePath, attachment } = opts;
  if (attachment.data !== undefined) return Buffer.from(attachment.data, "base64");
  // `path` — the schema's refine guarantees one of the two is present.
  const resolved = path.resolve(path.dirname(fixturePath), String(attachment.path));
  try {
    return await readFile(resolved);
  } catch (e) {
    throw new EmailFixtureError({
      fixturePath,
      detail: `cannot read attachment ${attachment.filename} at ${resolved} (${errorMessage(e)})`,
    });
  }
}

async function readFixtureFile(fixturePath: string): Promise<z.infer<typeof EmailFixtureSchema>> {
  let text: string;
  try {
    text = await readFile(fixturePath, "utf-8");
  } catch (e) {
    throw new EmailFixtureError({ fixturePath, detail: `cannot read it (${errorMessage(e)})` });
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (e) {
    throw new EmailFixtureError({ fixturePath, detail: `not valid YAML (${errorMessage(e)})` });
  }
  const result = EmailFixtureSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new EmailFixtureError({ fixturePath, detail: `does not match the format — ${issues}` });
  }
  return result.data;
}

export interface LoadEmailFixtureOptions {
  /**
   * What "now" means for a fixture with no `date:`. The harness passes the
   * run's SIMULATED clock, which its own process does not share — a message
   * that arrives on today's real date during a run set in August is mail the
   * box will sort under the wrong day. Defaults to the box clock.
   */
  now?: Date | undefined;
}

/**
 * Read a fixture and build the Gmail message it describes, reading any
 * attachment files relative to the fixture itself.
 */
export async function loadEmailFixture(
  fixturePath: string,
  options?: LoadEmailFixtureOptions,
): Promise<LoadedEmailFixture> {
  const fixture = await readFixtureFile(fixturePath);
  const id = fixture.id ?? path.basename(fixturePath).replace(/\.ya?ml$/, "");
  if (!ID_PATTERN.test(id)) {
    throw new EmailFixtureError({
      fixturePath,
      detail: `the filename makes an unusable message id "${id}" — rename the fixture, or set \`id:\` (letters, digits, \`.\`, \`_\` or \`-\` only)`,
    });
  }
  const threadId = fixture.threadId ?? `t-${id}`;
  const date =
    fixture.date === undefined ? (options?.now ?? getBoxTime()) : new Date(fixture.date);

  const headers = [
    { name: "Message-ID", value: `<${id}@example.com>` },
    { name: "From", value: fixture.from },
    { name: "To", value: fixture.to },
    ...(fixture.cc === undefined ? [] : [{ name: "Cc", value: fixture.cc }]),
    { name: "Subject", value: fixture.subject },
    { name: "Date", value: date.toUTCString() },
  ];

  const attachments: Record<string, GmailAttachmentData> = {};
  const attachmentParts: GmailPayload[] = [];
  const declared = fixture.attachments ?? [];
  for (const [index, attachment] of declared.entries()) {
    const bytes = await attachmentBytes({ fixturePath, attachment });
    const attachmentId = `att-${index + 1}`;
    attachments[attachmentId] = {
      data: bytes.toString("base64url"),
      size: bytes.byteLength,
    };
    attachmentParts.push({
      partId: String(index + 1),
      mimeType: attachment.mimeType,
      filename: attachment.filename,
      body: { attachmentId, size: bytes.byteLength },
    });
  }

  const body = textBody(fixture.body);
  const payload: GmailPayload = attachmentParts.length === 0
    ? { mimeType: "text/plain", headers, body }
    : {
        mimeType: "multipart/mixed",
        headers,
        parts: [{ partId: "0", mimeType: "text/plain", body }, ...attachmentParts],
      };

  return {
    message: {
      id,
      threadId,
      labelIds: fixture.labelIds ?? ["INBOX"],
      snippet: fixture.body.replace(/\s+/g, " ").trim().slice(0, 100),
      internalDate: String(date.getTime()),
      payload,
    },
    attachments,
  };
}
