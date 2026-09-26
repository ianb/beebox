/**
 * Notification targets: where tapping a notification lands.
 *
 * A target is a string with a scheme (`chat:<sessionId>`, `chat:new`,
 * `card:<path>`, `question:<path>`, `admin:<section>`, `dashboard`), parsed once into a
 * discriminated union and rendered to a root-relative deep link per box. It is
 * never a raw URL. See docs/plans/notifications.md ("Ontology", Track A).
 */

import { resolveRefPath } from "../../shared/ref-path.js";
import { assertNever } from "../../lib/invariant.js";

export type Target =
  | { kind: "chat"; sessionId: string }
  | { kind: "chat-new" }
  | { kind: "card"; path: string }
  | { kind: "question"; path: string }
  | { kind: "admin"; section: string }
  | { kind: "dashboard" };

const SCHEMES = "chat:<sessionId>, chat:new, card:<path>, question:<path>, admin:<section>, dashboard";

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

export function parseTarget(value: string): Target {
  if (value === "dashboard") return { kind: "dashboard" };
  if (value === "chat:new") return { kind: "chat-new" };
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
      return "chat:new";
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
 * `chat:new`, whose chat page shows that notification as a banner.
 */
export function targetUrl(target: Target, opts: { boxSlug: string; notificationId: string }): string {
  const { boxSlug, notificationId } = opts;
  switch (target.kind) {
    case "chat":
      return `/${boxSlug}/chat?session=${encodeURIComponent(target.sessionId)}`;
    case "chat-new":
      return `/${boxSlug}/chat?new=1&notification=${encodeURIComponent(notificationId)}`;
    case "card":
    case "question":
      return `/${boxSlug}/browse/${target.path}`;
    case "admin":
      return `/${boxSlug}/admin#${target.section}`;
    case "dashboard":
      return `/${boxSlug}/`;
    default:
      return assertNever(target);
  }
}
