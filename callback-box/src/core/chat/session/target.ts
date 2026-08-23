/**
 * Who the message is for, and who creates the chat if it does not exist yet.
 *
 * This used to be answered in four places that had nothing coordinating them —
 * the chat-send route, capture/bulk delivery, and both schedule-fire fallbacks
 * each called `registry.createNew()` on their own. Two of them can run at the
 * same time for one intended chat (a capture delivering while the composer
 * sends), and the result was two chats. This module is the single owner:
 * `registry.createNew` is reachable only from here, enforced by lint.
 *
 * The union is deliberately small. A chat whose id was coined and reserved
 * (`reserve.ts`) is just `existing` — the reservation is what makes it exist —
 * so nothing here needs a "not yet real" case.
 */

import { assertNever } from "../../../lib/invariant.js";
import { getMostActive } from "./history.js";
import type { ChatSession } from "./index.js";
import type { ChatSessionRegistry } from "./registry.js";

export type ChatTargetSpec =
  /** A chat that already exists — resumable, live, or reserved. */
  | { kind: "existing"; sessionId: string }
  /**
   * Start a chat this box has not named: the legacy `"new"` send, a Codex box
   * (whose harness assigns its own id), and the schedule-fire fallbacks. The id
   * arrives asynchronously via `session-assigned`.
   */
  | { kind: "fresh"; contextDir?: string | undefined; seedFeatures?: Record<string, string> | undefined }
  /**
   * Whatever chat the box was last active in, else a fresh one. The `/capture`
   * deep link and legacy schedules with no recorded session.
   */
  | { kind: "most-active-or-fresh"; contextDir?: string | undefined };

export interface ResolvedChatTarget {
  session: ChatSession;
  /** Null only for a `fresh` target whose harness has not named it yet. */
  sessionId: string | null;
}

export interface ChatTargetContext {
  boxRoot: string;
  registry: ChatSessionRegistry;
}

/**
 * Resolve a target to a live session. Exhaustive over `ChatTargetSpec` — a new
 * kind fails to compile here until every caller's case is written, which is the
 * property the four scattered `createNew()` calls never had.
 */
export async function resolveChatTarget(
  ctx: ChatTargetContext,
  spec: ChatTargetSpec,
): Promise<ResolvedChatTarget> {
  switch (spec.kind) {
    case "existing":
      return { session: ctx.registry.getOrCreate(spec.sessionId), sessionId: spec.sessionId };
    case "fresh":
      return {
        session: ctx.registry.createNew({
          ...(spec.contextDir !== undefined ? { contextDir: spec.contextDir } : {}),
          ...(spec.seedFeatures !== undefined ? { seedFeatures: spec.seedFeatures } : {}),
        }),
        sessionId: null,
      };
    case "most-active-or-fresh": {
      const mostActive = await getMostActive(ctx.boxRoot);
      if (mostActive === null) {
        return resolveChatTarget(ctx, {
          kind: "fresh",
          ...(spec.contextDir !== undefined ? { contextDir: spec.contextDir } : {}),
        });
      }
      return { session: ctx.registry.getOrCreate(mostActive), sessionId: mostActive };
    }
    default:
      return assertNever(spec);
  }
}
