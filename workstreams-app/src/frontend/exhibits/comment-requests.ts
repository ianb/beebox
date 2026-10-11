// The comment panel's decisions, kept pure so they can be checked without a
// browser (`docs/implemented-plans/exhibit-comments.md`, Track 3). The panel itself is a
// few event listeners around these.

import type { SelectionAnchor } from "../lib/selection-anchor.js";

export type CommentOrigin = "typed" | "voice";

/** What POST /api/<scope>/comments accepts. Optional fields are absent, never `undefined`. */
export interface CommentRequest {
  body: string;
  origin: CommentOrigin;
  quoted?: string;
  section?: string;
  fragment?: string;
}

export function commentRequest(input: {
  anchor: SelectionAnchor | null;
  body: string;
  origin: CommentOrigin;
}): CommentRequest {
  const { anchor } = input;
  return {
    body: input.body.trim(),
    origin: input.origin,
    ...(anchor?.quoted === undefined ? {} : { quoted: anchor.quoted }),
    ...(anchor?.section === undefined ? {} : { section: anchor.section }),
    ...(anchor?.fragment === undefined ? {} : { fragment: anchor.fragment }),
  };
}

function stringField(body: unknown, key: string): string | undefined {
  if (typeof body !== "object" || body === null || !(key in body)) return undefined;
  const value: unknown = Reflect.get(body, key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * One sentence for a failed response. The exhibits API answers a refusal with
 * `{ message, detail }` (the detail is the CLI's own words) or `{ error }`;
 * anything else is reported by status so the failure is never blank.
 */
export function responseProblem(input: { status: number; body: unknown }): string {
  const detail = stringField(input.body, "detail");
  const message = stringField(input.body, "message");
  if (message !== undefined && detail !== undefined) return `${message} ${detail}`;
  if (detail !== undefined) return detail;
  if (message !== undefined) return message;
  const error = stringField(input.body, "error");
  if (error !== undefined) return error;
  return `The exhibits server answered HTTP ${String(input.status)}.`;
}

/** A second take adds to what is there rather than discarding a correction already made. */
export function appendTranscript(current: string, text: string): string {
  const addition = text.trim();
  if (addition === "") return current;
  return current.trim() === "" ? addition : `${current.trimEnd()} ${addition}`;
}

/** What the panel says after a save: where it went, and how it is read. */
export function savedMessage(workstream: string): string {
  return `Saved for ${workstream}. The agent reads it with bin/comments list --workstream ${workstream} at its next pickup.`;
}
