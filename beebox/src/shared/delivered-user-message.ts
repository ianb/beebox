/**
 * Shared codec for first-class user messages delivered by the server.
 *
 * Capture and bulk-upload messages are persisted as pseudo-XML because the
 * agent consumes that vocabulary directly. The transcript UI needs the inverse
 * operation. Keeping both directions behind one closed kind registry makes a
 * new supported kind fail typechecking until it has a parser.
 */

import { assertNever, invariant } from "../lib/invariant.js";
import { humanBytes } from "../lib/human-bytes.js";
import { stripChatAppTags } from "./chat-tags.js";

export interface CaptureUserMessage {
  kind: "capture";
  /** Box-relative path of the capture-session card. */
  doc: string;
  images: number;
  /** Canonical wire duration, including `0:00` when no audio is present. */
  audio: string;
  summary: string;
  partial: boolean;
  transcriptionFailed: boolean;
}

export interface UploadUserMessage {
  kind: "upload";
  /** Box-relative path of the upload-batch card. */
  doc: string;
  files: number;
  bytes: string;
  failed: number;
  /** The boxholder's introduction, before the generated summary. */
  note: string;
  summary: string;
}

interface DeliveredUserMessageByKind {
  capture: CaptureUserMessage;
  upload: UploadUserMessage;
}

export type DeliveredUserMessageKind = keyof DeliveredUserMessageByKind;
export type DeliveredUserMessage = DeliveredUserMessageByKind[DeliveredUserMessageKind];
export type DeliveredUserMessagePart =
  | { kind: "text"; text: string }
  | DeliveredUserMessage;

interface DeliveredMessageCodec<K extends DeliveredUserMessageKind> {
  parse: (attrs: string, body: string) => DeliveredUserMessageByKind[K] | null;
}

const DOC_RE = /\bdoc="([^"]*)"/i;
const IMAGES_RE = /\bimages="([^"]*)"/i;
const AUDIO_RE = /\baudio="([^"]*)"/i;
const PARTIAL_RE = /\bpartial="([^"]*)"/i;
const TRANSCRIPTION_FAILED_RE = /\btranscription-failed="([^"]*)"/i;
const FILES_RE = /\bfiles="([^"]*)"/i;
const BYTES_RE = /\bbytes="([^"]*)"/i;
const FAILED_RE = /\bfailed="([^"]*)"/i;

function readStringAttr(attrs: string, re: RegExp): string | null {
  return re.exec(attrs)?.at(1) ?? null;
}

function readIntAttr(attrs: string, re: RegExp): number {
  const raw = readStringAttr(attrs, re);
  if (raw === null) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseCapture(attrs: string, body: string): CaptureUserMessage | null {
  const doc = readStringAttr(attrs, DOC_RE);
  if (doc === null || doc === "") return null;
  return {
    kind: "capture",
    doc,
    images: readIntAttr(attrs, IMAGES_RE),
    audio: readStringAttr(attrs, AUDIO_RE) ?? "0:00",
    summary: body.trim(),
    partial: readStringAttr(attrs, PARTIAL_RE) === "1",
    transcriptionFailed: readStringAttr(attrs, TRANSCRIPTION_FAILED_RE) === "1",
  };
}

function parseUpload(attrs: string, body: string): UploadUserMessage | null {
  const doc = readStringAttr(attrs, DOC_RE);
  if (doc === null || doc === "") return null;
  const trimmedBody = body.trim();
  const split = trimmedBody.lastIndexOf("\n\n");
  return {
    kind: "upload",
    doc,
    files: readIntAttr(attrs, FILES_RE),
    bytes: readStringAttr(attrs, BYTES_RE) ?? "",
    failed: readIntAttr(attrs, FAILED_RE),
    note: split === -1 ? "" : trimmedBody.slice(0, split).trim(),
    summary: split === -1 ? trimmedBody : trimmedBody.slice(split + 2).trim(),
  };
}

const DELIVERED_MESSAGE_CODECS = {
  capture: { parse: parseCapture },
  upload: { parse: parseUpload },
} satisfies { [K in DeliveredUserMessageKind]: DeliveredMessageCodec<K> };

const DELIVERED_BLOCK_RE = /<([a-z][a-z-]*)\b([^>]*)>([\S\s]*?)<\/\1>/gi;
const STANDALONE_OPEN_RE = /(?:^|\n)[\t ]*<([a-z][a-z-]*)\b/gi;

function isDeliveredMessageKind(value: string): value is DeliveredUserMessageKind {
  return Object.hasOwn(DELIVERED_MESSAGE_CODECS, value);
}

/** Runtime mirror of the type-enforced codec keys, for behavioral coverage. */
export const DELIVERED_USER_MESSAGE_KINDS = Object.freeze(
  Object.keys(DELIVERED_MESSAGE_CODECS).filter(isDeliveredMessageKind),
);

function parseDeliveredBlock(opts: {
  kind: DeliveredUserMessageKind;
  attrs: string;
  body: string;
}): DeliveredUserMessage | null {
  switch (opts.kind) {
    case "capture":
      return DELIVERED_MESSAGE_CODECS.capture.parse(opts.attrs, opts.body);
    case "upload":
      return DELIVERED_MESSAGE_CODECS.upload.parse(opts.attrs, opts.body);
    default:
      return assertNever(opts.kind);
  }
}

function occupiesOwnLineBlock(text: string, range: { start: number; end: number }): boolean {
  const lineStart = text.lastIndexOf("\n", range.start - 1) + 1;
  if (text.slice(lineStart, range.start).trim() !== "") return false;
  const nextNewline = text.indexOf("\n", range.end);
  const lineEnd = nextNewline === -1 ? text.length : nextNewline;
  return text.slice(range.end, lineEnd).trim() === "";
}

function containsDeliveredOpening(body: string): boolean {
  STANDALONE_OPEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STANDALONE_OPEN_RE.exec(body)) !== null) {
    const kind = match.at(1)?.toLowerCase();
    if (kind !== undefined && isDeliveredMessageKind(kind)) return true;
  }
  return false;
}

/**
 * Parse ordered delivered-message and text parts from persisted transcript
 * text. Display-only `<chat-app>` snapshots are removed first. Invalid,
 * unknown, or same-line prose tags remain text; a bad block never prevents a
 * later valid block from parsing.
 */
export function parseDeliveredUserMessageParts(text: string): DeliveredUserMessagePart[] {
  const visibleText = stripChatAppTags(text);
  const parts: DeliveredUserMessagePart[] = [];
  let textStart = 0;
  DELIVERED_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DELIVERED_BLOCK_RE.exec(visibleText)) !== null) {
    const fullMatch = match.at(0);
    const rawKind = match.at(1)?.toLowerCase();
    const attrs = match.at(2);
    const body = match.at(3);
    invariant(fullMatch !== undefined, "delivered-message regex always returns the full match");
    if (rawKind === undefined || attrs === undefined || body === undefined) {
      DELIVERED_BLOCK_RE.lastIndex = match.index + 1;
      continue;
    }
    const end = match.index + fullMatch.length;
    if (
      !isDeliveredMessageKind(rawKind) ||
      !occupiesOwnLineBlock(visibleText, { start: match.index, end }) ||
      containsDeliveredOpening(body)
    ) {
      DELIVERED_BLOCK_RE.lastIndex = match.index + 1;
      continue;
    }
    const parsed = parseDeliveredBlock({ kind: rawKind, attrs, body });
    if (parsed === null) {
      DELIVERED_BLOCK_RE.lastIndex = match.index + 1;
      continue;
    }
    if (match.index > textStart) {
      parts.push({ kind: "text", text: visibleText.slice(textStart, match.index) });
    }
    parts.push(parsed);
    textStart = end;
  }
  if (textStart < visibleText.length) {
    parts.push({ kind: "text", text: visibleText.slice(textStart) });
  }
  return parts;
}

function validateDocPath(message: DeliveredUserMessage): void {
  invariant(
    !/[\n\r">]/.test(message.doc),
    `Delivered message doc path contains a tag delimiter: ${JSON.stringify(message.doc)}`,
  );
}

/** Serialize one canonical delivered message into the agent-facing wire form. */
export function serializeDeliveredUserMessage(message: DeliveredUserMessage): string {
  validateDocPath(message);
  switch (message.kind) {
    case "capture": {
      const attrs = [
        `doc="${message.doc}"`,
        `images="${String(message.images)}"`,
        `audio="${message.audio}"`,
      ];
      if (message.partial) attrs.push("partial=\"1\"");
      if (message.transcriptionFailed) attrs.push("transcription-failed=\"1\"");
      return `<${message.kind} ${attrs.join(" ")}>\n${message.summary.trim()}\n</${message.kind}>`;
    }
    case "upload": {
      const attrs = [
        `doc="${message.doc}"`,
        `files="${String(message.files)}"`,
        `bytes="${message.bytes}"`,
      ];
      if (message.failed > 0) attrs.push(`failed="${String(message.failed)}"`);
      const note = message.note.trim();
      const summary = message.summary.trim();
      const body = note === "" ? summary : `${note}\n\n${summary}`;
      return `<${message.kind} ${attrs.join(" ")}>\n${body}\n</${message.kind}>`;
    }
    default:
      return assertNever(message);
  }
}

function formatAudioDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Existing capture-domain builder, now delegated to the shared serializer. */
export function buildCaptureWrapper(opts: {
  docPath: string;
  imageCount: number;
  audioSeconds: number;
  summary: string;
  partial?: boolean;
  transcriptionFailed?: boolean;
}): string {
  return serializeDeliveredUserMessage({
    kind: "capture",
    doc: opts.docPath,
    images: opts.imageCount,
    audio: formatAudioDuration(opts.audioSeconds),
    summary: opts.summary,
    partial: opts.partial === true,
    transcriptionFailed: opts.transcriptionFailed === true,
  });
}

/** Existing bulk-domain builder, now delegated to the shared serializer. */
export function buildUploadWrapper(opts: {
  docPath: string;
  fileCount: number;
  totalBytes: number;
  failedCount: number;
  summary: string;
  note?: string | undefined;
}): string {
  return serializeDeliveredUserMessage({
    kind: "upload",
    doc: opts.docPath,
    files: opts.fileCount,
    bytes: humanBytes(opts.totalBytes),
    failed: opts.failedCount,
    note: opts.note ?? "",
    summary: opts.summary,
  });
}
