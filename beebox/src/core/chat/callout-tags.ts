/**
 * `<callout>` tags at turn end: the chat's way to reach a person who has left.
 *
 * `parseCalloutTags` reads `<callout context="…" loudness="dot|quiet|loud">body</callout>`
 * out of a completed turn (a sibling of `schedule-tags.ts`). `notifyTurnCallouts`
 * turns a turn's callouts into one notification intent: the first callout
 * titles and carries it, the loudest `loudness` any callout asked for sets its
 * loudness (else `dot`), and it targets the chat session, tagged with the
 * session id so a later turn replaces it rather than stacking. A callout
 * without a `context` or a body is not a callout, as in the frontend's
 * `parseCallouts`. While a web session is present the callout is on screen,
 * so a `quiet` or `loud` one is not pushed (`onScreen`); a `dot` still badges
 * the phone. See docs/plans/notifications.md (Track E).
 */

import { parseAttrs } from "../../shared/parse-attrs.js";
import { LOUDNESS, type Loudness } from "../notification/intent.js";
import { livePresence } from "../notification/presence.js";
import { notifyBoxholder, type NotifyResult, type NotifyServices } from "../notify-boxholder.js";

export interface ParsedCalloutTag {
  context: string;
  loudness: Loudness | null;
  body: string;
}

const LOUDNESS_VALUES: ReadonlySet<string> = new Set(LOUDNESS);

function isLoudness(value: string): value is Loudness {
  return LOUDNESS_VALUES.has(value);
}

/**
 * Parse callout tags from an assistant response, in order. An unknown
 * `loudness` is ignored with a warning; a callout with no `context` or an
 * empty body is dropped (logged at debug), as the frontend drops it.
 */
export function parseCalloutTags(text: string): ParsedCalloutTag[] {
  const results: ParsedCalloutTag[] = [];
  for (const match of text.matchAll(/<callout\b([^>]*)>([\S\s]*?)<\/callout\s*>/gi)) {
    const attrs = parseAttrs(match[1] ?? "");
    const context = attrs["context"]?.trim() ?? "";
    const body = (match[2] ?? "").trim();
    if (context.length === 0 || body.length === 0) {
      console.debug(`[callouts] ignoring a <callout> with no ${context.length === 0 ? "context" : "body"}`);
      continue;
    }
    const raw = attrs["loudness"];
    let loudness: Loudness | null = null;
    if (raw !== undefined) {
      if (isLoudness(raw)) loudness = raw;
      else console.warn(`[callouts] ignoring unknown loudness "${raw}" on a <callout>`);
    }
    results.push({ context, loudness, body });
  }
  return results;
}

const MAX_TITLE_CHARS = 80;

function titleFor(callout: ParsedCalloutTag): string {
  const title = callout.context;
  return title.length > MAX_TITLE_CHARS ? `${title.slice(0, MAX_TITLE_CHARS - 1)}…` : title;
}

function loudest(callouts: readonly ParsedCalloutTag[]): Loudness {
  const rank = (l: Loudness): number => LOUDNESS.indexOf(l);
  return callouts.reduce<Loudness>((max, c) => (c.loudness !== null && rank(c.loudness) > rank(max) ? c.loudness : max), "dot");
}

/**
 * Send one notification for a completed turn's callouts. Returns null when the
 * turn has none.
 */
export async function notifyTurnCallouts(
  boxRoot: string,
  opts: { text: string; sessionId: string; services?: NotifyServices | undefined },
): Promise<NotifyResult | null> {
  const callouts = parseCalloutTags(opts.text);
  const first = callouts[0];
  if (first === undefined) return null;
  const presence = await livePresence(boxRoot);
  return notifyBoxholder(boxRoot, {
    intent: {
      title: titleFor(first),
      body: first.body,
      target: { kind: "chat", sessionId: opts.sessionId },
      loudness: loudest(callouts),
      tag: opts.sessionId,
      source: `chat:${opts.sessionId}`,
    },
    services: opts.services,
    onScreen: presence.activeWeb > 0,
  });
}
