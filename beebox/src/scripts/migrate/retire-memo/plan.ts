/**
 * `retire-memo-2026-10` decision: every `*.memo.card` becomes a `*.doc.card`
 * with the same directory and basename (docs/implemented-plans/retire-memo.md, Track D).
 *
 * Pure: the runner reads the box and hands over every text file and the list of
 * all file paths; this module returns the writes, recording moves and deletes.
 * Any memo it cannot convert without losing data is a failure, and the runner
 * then writes nothing.
 *
 * Per memo:
 * - Title: `title:`; else a leading `# Heading` (removed from the body); else
 *   the first non-empty line of the body or transcription, markdown markers
 *   stripped, cut at 80 characters; else the humanised filename.
 * - `status`, `type` and `created` go. A recording keeps `created` as its audio
 *   card's `via.at`.
 * - `source` becomes `via: {channel}`. `context.url` (with `title` as `label`)
 *   becomes `sources`; a title with no URL and the clipped text go into a
 *   `## Clipping` section, the shape quick capture writes.
 * - A recording (an audio file in the attach scope, or a same-basename sibling
 *   such as `Note.m4a`) gets `<stem>.audio.card` in the doc's attach scope and
 *   moves to `<stem>.attach/<file>`. The transcript and transcription error move
 *   onto that card; the doc body links the card.
 * - A transcription with no recording becomes the body, or a `## Transcript`
 *   section. Its language, time, and an error with no recording to retry are
 *   dropped and reported (boxholder, 2026-10-16).
 *
 * References: the doc keeps the memo's directory and basename, so every
 * mention of `<base>.memo.card` in another card or `.md` file becomes
 * `<base>.doc.card` by exact filename replacement, whatever form the mention
 * takes. A recording in an attach scope keeps its `<base>.attach/` prefix;
 * mentions of `<base>.attach/<file>` gain the new folder. A sibling recording
 * is rare (an old pre-action layout); a remaining mention of its filename is a
 * failure.
 *
 * Retry: the runner writes audio cards, then moves recordings, then docs, then
 * referrers, then deletes memos. A rerun sees the memo again and accepts each
 * piece already in place when it matches what this plan would write.
 */

import * as path from "node:path";
import { renderFrontmatterBlock, splitCardContent } from "../../../cards/frontmatter.js";
import { cardBasename } from "../../../shared/attach-path.js";
import { isRecord } from "../../../shared/is-record.js";
import { truncateTitle } from "../../../core/file-summary.js";
import { findRecordings, frontmatter, type Recording } from "./recordings.js";

/** Global card fields (`src/cards/schema.ts` GLOBAL_CARD_FIELDS); kept as they are. */
const GLOBAL_FIELDS = ["title", "contains", "contains-evidence", "todos", "symbol", "prominence", "theme"];
const MEMO_FIELDS = new Set(["type", "status", "created", "source", "context", "share-id", "transcription", "transcription-error", ...GLOBAL_FIELDS]);
const CONTEXT_FIELDS = new Set(["url", "title", "text"]);
const TRANSCRIPTION_FIELDS = new Set(["text", "language", "transcribed-at"]);
const ERROR_FIELDS = new Set(["permanent", "code", "attempted-at", "message"]);

export interface PlanInput {
  /** Every text file the runner read (`*.card`, `*.md`), by box-relative path. Memos included. */
  texts: ReadonlyMap<string, string>;
  /** Box-relative paths of every file in the box, symlinks included. */
  files: ReadonlySet<string>;
}

export type WriteKind = "audio" | "doc" | "referrer";

export interface PlannedWrite {
  kind: WriteKind;
  path: string;
  after: string;
}

export interface RetireMemoPlan {
  writes: PlannedWrite[];
  /** Recording moves, applied after the audio cards and before the docs. */
  moves: Array<{ from: string; to: string }>;
  deletes: string[];
  /** One line per value dropped beyond `status`/`created`/`type`. */
  dropped: string[];
  failures: string[];
}

const join = (dir: string, name: string): string => (dir === "." || dir === "" ? name : `${dir}/${name}`);
const escapeRegex = (text: string): string => text.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);

/** Text that mentions `name` as a whole path segment ends, not inside a longer filename. */
function mentionPattern(names: string[]): RegExp | null {
  if (names.length === 0) return null;
  // eslint-disable-next-line security/detect-non-literal-regexp -- every name is escaped by escapeRegex; only the boundary lookarounds are fixed text.
  return new RegExp(String.raw`(?<![\w.-])(${names.map(escapeRegex).join("|")})(?![\w.-])`, "g");
}

function unknownKeys(value: unknown, allowed: Set<string>): string[] {
  return isRecord(value) ? Object.keys(value).filter((key) => !allowed.has(key)) : [];
}

/** Plain text of one line of markdown, for a title. */
function plainLine(line: string): string {
  return line
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[*+-]\s+|\d+[).]\s+|- \[[ x]]\s+)/i, "")
    .replaceAll(/!?\[([^\]]*)]\([^)]*\)/g, "$1")
    .replaceAll(/[*_`~]+/g, "")
    .replaceAll(/{%[^%]*%}/g, "")
    .trim();
}

/** The first paragraph as one line of plain text: a hard-wrapped sentence stays whole. */
function firstParagraph(text: string): string | null {
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const plain = plainLine(line);
    if (plain === "" && lines.length > 0) break;
    if (plain !== "") lines.push(plain);
  }
  return lines.length === 0 ? null : lines.join(" ");
}

/** Text compared by its words alone, so a re-wrapped or link-marked copy still matches. */
function words(text: string): string {
  return text.split("\n").map(plainLine).join(" ").replaceAll(/\s+/g, " ").trim();
}

/** How a recording arrived: a voice capture was recorded on a microphone; anything else keeps its channel. */
export function recordingChannel(source: string | undefined): string {
  return source === undefined || source === "voice" || source === "apple-voice-recording" ? "microphone" : source;
}

/**
 * Filename title as the migration first wrote it: the stem up to the first dot.
 * Kept apart from the shared `titleFromFilename` so a retried run still matches
 * the files an earlier run wrote byte for byte.
 */
function memoTitleFromFilename(filePath: string): string {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dot = base.indexOf(".");
  const stem = dot === -1 ? base : base.slice(0, dot);
  return stem.replaceAll("_", " ").replaceAll("-", " ");
}

/** Title and the body with a leading heading removed when that heading became the title. */
function titleFor(args: { memoPath: string; fields: Record<string, unknown>; body: string; transcript: string | undefined }): { title: string; body: string } {
  const { fields, body } = args;
  if (typeof fields["title"] === "string" && fields["title"].trim() !== "") return { title: fields["title"], body };
  const lines = body.split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  const heading = first === -1 ? null : /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[first] ?? "");
  if (heading?.[1] !== undefined) {
    const title = plainLine(heading[1]);
    if (title !== "") {
      const rest = lines.slice(first + 1);
      while (rest.length > 0 && rest[0]?.trim() === "") rest.shift();
      return { title: truncateTitle(title, 80), body: rest.join("\n") };
    }
  }
  const line = firstParagraph(body) ?? (args.transcript === undefined ? null : firstParagraph(args.transcript));
  if (line !== null) return { title: truncateTitle(line, 80), body };
  return { title: memoTitleFromFilename(args.memoPath), body };
}

function appendSection(body: string, section: string): string {
  const trimmed = body.replace(/\s+$/, "");
  return trimmed === "" ? section : `${trimmed}\n\n${section}`;
}

/** The `## Clipping` section quick capture writes (`core/quick-capture/source.ts`). */
function clippingSection(text: string | undefined, title: string | undefined): string {
  const from = title === undefined ? "" : `Clipped from “${title}”${text === undefined ? "." : ":"}\n`;
  const quoted = text === undefined ? "" : text.replace(/\s+$/, "").split("\n").map((line) => (line === "" ? ">" : `> ${line}`)).join("\n") + "\n";
  return `## Clipping\n\n${from}${from !== "" && quoted !== "" ? "\n" : ""}${quoted}`;
}

interface MemoResult {
  writes: PlannedWrite[];
  moves: Array<{ from: string; to: string }>;
  dropped: string[];
  failures: string[];
  recording: Recording | undefined;
  /** A doc already at the target (an interrupted run), with what this plan would write there. */
  existingDoc: { path: string; planned: string } | undefined;
}

/** The memo's fields, read once with their expected shapes. */
interface MemoFields {
  raw: Record<string, unknown>;
  source: string | undefined;
  url: string | undefined;
  contextTitle: string | undefined;
  clipped: string | undefined;
  transcription: Record<string, unknown> | undefined;
  transcript: string | undefined;
  error: Record<string, unknown> | undefined;
  created: string | undefined;
}

const nonEmpty = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

function readMemoFields(raw: Record<string, unknown>): { fields: MemoFields } | { unknown: string[] } {
  const unknown = [
    ...Object.keys(raw).filter((key) => !MEMO_FIELDS.has(key)),
    ...unknownKeys(raw["context"], CONTEXT_FIELDS).map((key) => `context.${key}`),
    ...unknownKeys(raw["transcription"], TRANSCRIPTION_FIELDS).map((key) => `transcription.${key}`),
    ...unknownKeys(raw["transcription-error"], ERROR_FIELDS).map((key) => `transcription-error.${key}`),
  ];
  if (unknown.length > 0) return { unknown };
  const context = isRecord(raw["context"]) ? raw["context"] : undefined;
  const transcription = isRecord(raw["transcription"]) ? raw["transcription"] : undefined;
  return { fields: {
    raw,
    source: nonEmpty(raw["source"]),
    url: nonEmpty(context?.["url"]),
    contextTitle: nonEmpty(context?.["title"]),
    clipped: nonEmpty(context?.["text"]),
    transcription,
    transcript: typeof transcription?.["text"] === "string" ? transcription["text"] : undefined,
    error: isRecord(raw["transcription-error"]) ? raw["transcription-error"] : undefined,
    created: typeof raw["created"] === "string" ? raw["created"] : undefined,
  } };
}

/** The audio card for a recording, and the doc body linking it. A string is a failure. */
function planRecording(args: { recording: Recording; fields: MemoFields; body: string; input: PlanInput; result: MemoResult }): string | { body: string } {
  const { recording, fields, input, result } = args;
  if (fields.created === undefined) return "has a recording but no `created` time for its audio card's via.at";
  const via = { channel: recordingChannel(fields.source), at: fields.created };
  const audio: Record<string, unknown> = { filename: { ref: `attach/${recording.name}`, via } };
  if (fields.transcript !== undefined) audio["transcript"] = fields.transcript;
  if (fields.error !== undefined) audio["transcription-error"] = fields.error;
  const audioText = renderFrontmatterBlock(audio);
  const existing = input.texts.get(recording.card);
  if (existing === undefined) result.writes.push({ kind: "audio", path: recording.card, after: audioText });
  else if (existing !== audioText) return `${recording.card} already exists with different content`;
  // Also for a recording an interrupted run moved: the helper then repairs its annex link.
  result.moves.push({ from: recording.from, to: recording.to });
  const cardLink = `attach/${recording.stem}.audio.card`;
  // eslint-disable-next-line security/detect-non-literal-regexp -- bodyRef is escaped by escapeRegex; the link delimiters are fixed text.
  const linked = new RegExp(String.raw`(\]\(<?|ref=")(?:\./)?${escapeRegex(recording.bodyRef)}(?=>?\)|")`, "g");
  let body = args.body.replaceAll(linked, `$1${cardLink}`);
  if (!body.includes(cardLink)) body = appendSection(body, `[Recorded audio](${cardLink})\n`);
  return { body };
}

/** Body text for a transcription with no recording: the body itself, or a section. */
function bodyWithTranscript(body: string, transcript: string | undefined): string {
  if (transcript === undefined || transcript.trim() === "") return body;
  if (body.trim() === "") return `${transcript.trim()}\n`;
  return words(body).includes(words(transcript)) ? body : appendSection(body, `## Transcript\n\n${transcript.trim()}\n`);
}

function docFields(title: string, fields: MemoFields): Record<string, unknown> {
  const doc: Record<string, unknown> = { title };
  for (const key of GLOBAL_FIELDS) {
    if (key !== "title" && fields.raw[key] !== undefined) doc[key] = fields.raw[key];
  }
  if (fields.raw["share-id"] !== undefined) doc["share-id"] = fields.raw["share-id"];
  if (fields.source !== undefined) doc["via"] = { channel: fields.source };
  if (fields.url !== undefined) doc["sources"] = [{ href: fields.url, ...(fields.contextTitle === undefined ? {} : { label: fields.contextTitle }) }];
  return doc;
}

function planMemo(memoPath: string, input: PlanInput): MemoResult {
  const result: MemoResult = { writes: [], moves: [], dropped: [], failures: [], recording: undefined, existingDoc: undefined };
  const fail = (message: string): MemoResult => ({ ...result, failures: [`${memoPath}: ${message}`] });
  const text = input.texts.get(memoPath) ?? "";
  const raw = frontmatter(text);
  if (raw === null) return fail("frontmatter is missing or not a YAML mapping");
  const read = readMemoFields(raw);
  if ("unknown" in read) return fail(`fields this migration does not map: ${read.unknown.join(", ")}`);
  const fields = read.fields;

  const recordings = findRecordings(memoPath, input);
  if (recordings.failures.length > 0) return { ...result, failures: recordings.failures };
  const recording = recordings.found[0];

  for (const key of ["language", "transcribed-at"]) {
    if (fields.transcription?.[key] !== undefined) result.dropped.push(`${memoPath}: transcription.${key} = ${String(fields.transcription[key])}`);
  }
  const titled = titleFor({ memoPath, fields: raw, body: splitCardContent(text).body, transcript: fields.transcript });
  let body = titled.body;
  if (recording === undefined) {
    body = bodyWithTranscript(body, fields.transcript);
    if (fields.error !== undefined) result.dropped.push(`${memoPath}: transcription-error with no recording = ${JSON.stringify(fields.error)}`);
  } else {
    const planned = planRecording({ recording, fields, body, input, result });
    if (typeof planned === "string") return fail(planned);
    body = planned.body;
    result.recording = recording;
  }
  const clipTitle = fields.url === undefined ? fields.contextTitle : undefined;
  if (fields.clipped !== undefined || clipTitle !== undefined) body = appendSection(body, clippingSection(fields.clipped, clipTitle));
  if (body !== "" && !body.endsWith("\n")) body += "\n";

  const docPath = join(path.posix.dirname(memoPath), `${cardBasename(memoPath)}.doc.card`);
  const docText = renderFrontmatterBlock(docFields(titled.title, fields), body);
  if (input.texts.has(docPath)) result.existingDoc = { path: docPath, planned: docText };
  else result.writes.push({ kind: "doc", path: docPath, after: docText });
  return result;
}

interface MentionRewriter {
  pattern: RegExp | null;
  replacements: Map<string, string>;
}

/** Exact-filename replacements: `<base>.memo.card` and `<base>.attach/<recording>`. */
function mentionRewriter(memoPaths: string[], recordings: Recording[]): MentionRewriter {
  const replacements = new Map<string, string>();
  for (const memo of memoPaths) replacements.set(`${cardBasename(memo)}.memo.card`, `${cardBasename(memo)}.doc.card`);
  for (const r of recordings) {
    if (r.sibling) continue;
    const scope = path.posix.basename(path.posix.dirname(r.from));
    replacements.set(`${scope}/${r.name}`, `${scope}/${r.stem}.attach/${r.name}`);
  }
  return { pattern: mentionPattern([...replacements.keys()]), replacements };
}

function rewriteMentions(text: string, rewriter: MentionRewriter): string {
  if (rewriter.pattern === null) return text;
  return text.replaceAll(rewriter.pattern, (match: string) => rewriter.replacements.get(match) ?? match);
}

export function planRetireMemo(input: PlanInput): RetireMemoPlan {
  const plan: RetireMemoPlan = { writes: [], moves: [], deletes: [], dropped: [], failures: [] };
  const memoPaths = [...input.texts.keys()].filter((p) => p.endsWith(".memo.card")).toSorted();
  const recordings: Recording[] = [];
  const existingDocs: Array<{ path: string; planned: string }> = [];
  for (const memoPath of memoPaths) {
    const result = planMemo(memoPath, input);
    plan.failures.push(...result.failures);
    if (result.failures.length > 0) continue;
    plan.writes.push(...result.writes);
    plan.moves.push(...result.moves);
    plan.dropped.push(...result.dropped);
    plan.deletes.push(memoPath);
    if (result.recording !== undefined) recordings.push(result.recording);
    if (result.existingDoc !== undefined) existingDocs.push(result.existingDoc);
  }
  if (plan.failures.length > 0) return plan;

  const rewriter = mentionRewriter(memoPaths, recordings);
  // A doc an interrupted run wrote already has its links rewritten; compare it rewritten too.
  for (const doc of existingDocs) {
    if (rewriteMentions(input.texts.get(doc.path) ?? "", rewriter) !== rewriteMentions(doc.planned, rewriter)) {
      plan.failures.push(`${doc.path.replace(/\.doc\.card$/, ".memo.card")}: ${doc.path} already exists with different content`);
    }
  }
  const siblings = mentionPattern(recordings.filter((r) => r.sibling && !r.moved).map((r) => r.name));
  const recordingCards = new Set(recordings.map((r) => r.card));
  const check = (file: string, text: string): void => {
    if (recordingCards.has(file)) return;
    if (siblings !== null && text.match(siblings) !== null) plan.failures.push(`${file}: mentions a recording that moves into an attach scope; update it by hand first`);
  };
  // New docs first: a memo that links another memo links its doc.
  for (const write of plan.writes) {
    write.after = rewriteMentions(write.after, rewriter);
    if (write.kind === "doc") check(write.path, write.after);
  }
  const planned = new Set(plan.writes.map((w) => w.path));
  for (const [file, text] of input.texts) {
    if (file.endsWith(".memo.card") || planned.has(file)) continue;
    const after = rewriteMentions(text, rewriter);
    check(file, after);
    if (after !== text) plan.writes.push({ kind: "referrer", path: file, after });
  }
  return plan;
}
