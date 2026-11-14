/**
 * The `<trigger>` delivered user message (docs/implemented-plans/activity-triggers.md,
 * Track E): a trigger the agent armed fired. The person has already seen
 * `<text>` under the trigger's label; `<note>` is for the agent. The
 * registry in `delivered-user-message.ts` dispatches to this codec.
 *
 *   <trigger label="Water check" file="src/triggers/water.ts" fire="1" entries="11" done="1">
 *   <text>That's water.</text>
 *   <note>Correct on the first attempt.</note>
 *   </trigger>
 *
 * The children escape `&`, `<` and `>`, so a trigger's text can never open
 * or close a tag.
 */

import { decodeXmlAttr, escapeXmlAttr } from "./self-note.js";

export interface TriggerUserMessage {
  kind: "trigger";
  /** The trigger's label, as the status line showed it. */
  label: string;
  /** Box-relative path of the trigger file. */
  file: string;
  /** Which fire of this activation this is, from 1. */
  fire: number;
  /** How many new entries the evaluation was given. */
  entries: number;
  /** The activation ended with this fire. */
  done: boolean;
  /** What the person saw. */
  text: string;
  /** For the agent; null when the trigger gave none. */
  note: string | null;
}

const LABEL_RE = /\blabel="([^"]*)"/i;
const FILE_RE = /\bfile="([^"]*)"/i;
const FIRE_RE = /\bfire="([^"]*)"/i;
const ENTRIES_RE = /\bentries="([^"]*)"/i;
const DONE_RE = /\bdone="([^"]*)"/i;
const TEXT_RE = /<text>([\S\s]*?)<\/text>/i;
const NOTE_RE = /<note>([\S\s]*?)<\/note>/i;

function attr(attrs: string, re: RegExp): string | null {
  const raw = re.exec(attrs)?.at(1);
  return raw === undefined ? null : decodeXmlAttr(raw);
}

function intAttr(attrs: string, re: RegExp): number {
  const raw = attr(attrs, re);
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function escapeBody(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function decodeBody(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export function parseTrigger(attrs: string, body: string): TriggerUserMessage | null {
  const label = attr(attrs, LABEL_RE);
  const file = attr(attrs, FILE_RE);
  const text = TEXT_RE.exec(body)?.at(1);
  if (label === null || file === null || text === undefined) return null;
  const note = NOTE_RE.exec(body)?.at(1);
  return {
    kind: "trigger",
    label,
    file,
    fire: intAttr(attrs, FIRE_RE),
    entries: intAttr(attrs, ENTRIES_RE),
    done: attr(attrs, DONE_RE) === "1",
    text: decodeBody(text.trim()),
    note: note === undefined ? null : decodeBody(note.trim()),
  };
}

export function serializeTrigger(message: TriggerUserMessage): string {
  const attrs = [
    `label="${escapeXmlAttr(message.label)}"`,
    `file="${escapeXmlAttr(message.file)}"`,
    `fire="${String(message.fire)}"`,
    `entries="${String(message.entries)}"`,
  ];
  if (message.done) attrs.push("done=\"1\"");
  const children = [`<text>${escapeBody(message.text.trim())}</text>`];
  if (message.note !== null && message.note.trim() !== "") children.push(`<note>${escapeBody(message.note.trim())}</note>`);
  return `<trigger ${attrs.join(" ")}>\n${children.join("\n")}\n</trigger>`;
}
