/**
 * Notification targets: where tapping a notification lands.
 *
 * A target is a string with a scheme (`chat:<sessionId>`, `chat:new`,
 * `chat:new:<place>`, `card:<path>`, `question:<path>`, `admin:<section>`,
 * `dashboard`), parsed once into a
 * discriminated union and rendered to a root-relative deep link per box. It is
 * never a raw URL. See docs/implemented-plans/notifications.md ("Ontology", Track A).
 */

import { resolveRefPath } from "../../shared/ref-path/core.js";
import { assertNever } from "../../shared/invariant.js";
import { SYSTEM_CARD_PATHS } from "../../shared/system-card-paths.js";
import { cardUrl } from "../../shared/card-url.js";
import { normalizeLandmarkDir } from "../landmark/root-dir.js";

export type Target =
  | { kind: "chat"; sessionId: string }
  /** A new chat; with `place`, its context directory is that place (a landmark directory). */
  | { kind: "chat-new"; place?: string }
  | { kind: "card"; path: string }
  | { kind: "question"; path: string }
  | { kind: "admin"; section: string }
  | { kind: "dashboard" };

const SCHEMES = "chat:<sessionId>, chat:new, chat:new:<place>, card:<path>, question:<path>, admin:<section>, dashboard";

/** Thrown by {@link parseTarget} for a string that names no valid target. */
export class InvalidTargetError extends Error {
  readonly value: string;
  constructor(value: string, reason: string) {
    super(`Invalid notification target "${value}": ${reason}. Valid targets: ${SCHEMES}`);
    this.name = "InvalidTargetError";
    this.value = value;
  }
}

/** A card path, normalized box-relative; fails closed like every other ref. */
function cardPath(value: string, rest: string): string {
  const resolved = resolveRefPath({ fromPath: undefined, ref: rest, kind: "card" });
  if (resolved === null) {
    throw new InvalidTargetError(value, "the path must name a file inside the box's underscore areas");
  }
  return resolved;
}

const CHAT_NEW_PLACE = "chat:new:";

/**
 * A place directory, normalized box-relative and fenced like a card path. The
 * root place (`_content`) is the plain `chat:new`, so it has no `place`.
 */
function chatNewPlace(value: string): Target {
  const rest = value.slice(CHAT_NEW_PLACE.length);
  if (rest === "") throw new InvalidTargetError(value, "\"chat:new:\" needs a place directory after the colon (or use chat:new)");
  if (rest.endsWith(".landmark.card")) throw new InvalidTargetError(value, "name the place's directory, not its landmark card");
  const resolved = resolveRefPath({ fromPath: undefined, ref: rest, kind: "card" });
  if (resolved === null) throw new InvalidTargetError(value, "the place must be a directory inside the box's underscore areas");
  const place = normalizeLandmarkDir(resolved);
  return place === "" ? { kind: "chat-new" } : { kind: "chat-new", place };
}

/** Longer targets are refused, so a notification log line stays one atomic append. */
const MAX_TARGET_CHARS = 1000;

export function parseTarget(value: string): Target {
  if (value.length > MAX_TARGET_CHARS) {
    const shown = `${value.slice(0, 40)}…`;
    throw new InvalidTargetError(shown, "longer than 1000 characters");
  }
  if (value === "dashboard") return { kind: "dashboard" };
  if (value === "chat:new") return { kind: "chat-new" };
  if (value.startsWith(CHAT_NEW_PLACE)) return chatNewPlace(value);
  const colon = value.indexOf(":");
  if (colon === -1) throw new InvalidTargetError(value, "no scheme");
  const scheme = value.slice(0, colon);
  const rest = value.slice(colon + 1);
  if (rest === "") throw new InvalidTargetError(value, `"${scheme}:" needs a value after the colon`);
  switch (scheme) {
    case "chat":
      if (/[\s#&/?]/.test(rest)) throw new InvalidTargetError(value, "a chat session id has no spaces or URL delimiters");
      return { kind: "chat", sessionId: rest };
    case "card":
      return { kind: "card", path: cardPath(value, rest) };
    case "question":
      return { kind: "question", path: cardPath(value, rest) };
    case "admin":
      // Admin section ids are the DOM ids in admin-sections.ts: lowercase words and hyphens.
      if (!/^[\da-z]+(-[\da-z]+)*$/.test(rest)) throw new InvalidTargetError(value, "an admin section id is lowercase words and hyphens");
      return { kind: "admin", section: rest };
    default:
      throw new InvalidTargetError(value, `unknown scheme "${scheme}"`);
  }
}

/** The canonical string form: `formatTarget(parseTarget(s))` normalizes `s`. */
export function formatTarget(target: Target): string {
  switch (target.kind) {
    case "chat":
      return `chat:${target.sessionId}`;
    case "chat-new":
      return target.place === undefined ? "chat:new" : `${CHAT_NEW_PLACE}${target.place}`;
    case "card":
      return `card:${target.path}`;
    case "question":
      return `question:${target.path}`;
    case "admin":
      return `admin:${target.section}`;
    case "dashboard":
      return "dashboard";
    default:
      return assertNever(target);
  }
}

/**
 * The root-relative deep link a tap opens. `notificationId` is carried by
 * `chat:new`, whose chat page shows that notification as a banner. A place
 * rides as `contextDir`; the chat route checks it is still a place.
 */
export function targetUrl(target: Target, opts: { boxSlug: string; notificationId: string }): string {
  const { boxSlug, notificationId } = opts;
  switch (target.kind) {
    case "chat":
      return `/${boxSlug}/chat?session=${encodeURIComponent(target.sessionId)}`;
    case "chat-new": {
      const place = target.place === undefined ? "" : `&contextDir=${encodeURIComponent(target.place)}`;
      return `/${boxSlug}/chat?new=1${place}&notification=${encodeURIComponent(notificationId)}`;
    }
    case "card":
    case "question":
      // A question opens as its stub card beside the chat, like the app-bar counter.
      return cardUrl(boxSlug, target.path);
    case "admin":
      // The Admin card's `section` view state opens the section's tab and scrolls to it.
      return `/${boxSlug}/views/${SYSTEM_CARD_PATHS.admin}?viewState=${encodeURIComponent(JSON.stringify({ section: target.section }))}`;
    case "dashboard":
      return `/${boxSlug}/`;
    default:
      return assertNever(target);
  }
}
