/**
 * The `<call>` delivered user message (docs/implemented-plans/chat-calls.md, Track G): the
 * folded transcript of a transcribed call between people in a chat. The
 * registry in `delivered-user-message.ts` dispatches to this codec.
 *
 *   <call people="Priya, Tomas" duration="12:04" started="2026-…Z" partial="…" skew="…">
 *   [0:03] Priya: …
 *   </call>
 *
 * The body escapes `&`, `<` and `>`, so text typed or said during the call can
 * never open or close a tag.
 */

import { decodeXmlAttr, escapeXmlAttr } from "./self-note.js";

export interface CallUserMessage {
  kind: "call";
  /** Everyone who was on the call, comma-separated. */
  people: string;
  /** `m:ss` from the call's start to its end. */
  duration: string;
  /** ISO, real wall clock. */
  started: string;
  /** A sentence naming whose audio could not be transcribed, or null. */
  partial: string | null;
  /** A sentence naming whose clock was off by more than a second, or null. */
  skew: string | null;
  /** One line per utterance or event, in time order. */
  transcript: string;
}

const PEOPLE_RE = /\bpeople="([^"]*)"/i;
const DURATION_RE = /\bduration="([^"]*)"/i;
const STARTED_RE = /\bstarted="([^"]*)"/i;
const PARTIAL_RE = /\bpartial="([^"]*)"/i;
const SKEW_RE = /\bskew="([^"]*)"/i;

function attr(attrs: string, re: RegExp): string | null {
  const raw = re.exec(attrs)?.at(1);
  return raw === undefined ? null : decodeXmlAttr(raw);
}

function escapeBody(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function decodeBody(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export function parseCall(attrs: string, body: string): CallUserMessage | null {
  const people = attr(attrs, PEOPLE_RE);
  const started = attr(attrs, STARTED_RE);
  if (people === null || started === null) return null;
  return {
    kind: "call",
    people,
    duration: attr(attrs, DURATION_RE) ?? "0:00",
    started,
    partial: attr(attrs, PARTIAL_RE),
    skew: attr(attrs, SKEW_RE),
    transcript: decodeBody(body.trim()),
  };
}

export function serializeCall(message: CallUserMessage): string {
  const attrs = [
    `people="${escapeXmlAttr(message.people)}"`,
    `duration="${escapeXmlAttr(message.duration)}"`,
    `started="${escapeXmlAttr(message.started)}"`,
  ];
  if (message.partial !== null) attrs.push(`partial="${escapeXmlAttr(message.partial)}"`);
  if (message.skew !== null) attrs.push(`skew="${escapeXmlAttr(message.skew)}"`);
  return `<call ${attrs.join(" ")}>\n${escapeBody(message.transcript.trim())}\n</call>`;
}
