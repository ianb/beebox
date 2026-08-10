/**
 * How the chat history dropdown orders its rows.
 *
 * The rule is prominence, not scoping: chats bound to the landmark you're
 * chatting in come first under its name, everything else follows under "Other
 * chats". Nothing is ever filtered out — a chat in another landmark stays one
 * scroll away.
 *
 * Pure so the affordance is testable without a router/DOM
 * (test/frontend/session-list-grouping.doctest.md).
 */

import type { ChatSessionInfo } from "../../api";

export type SessionListLayout =
  | {
      kind: "flat";
      sessions: ChatSessionInfo[];
      /** Tag each row with its landmark (only worth it when they differ). */
      showLandmark: boolean;
    }
  | {
      kind: "grouped";
      /** Heading for the current landmark's group. */
      hereLabel: string;
      here: ChatSessionInfo[];
      /** Every other chat in the box; rows are always landmark-tagged. */
      elsewhere: ChatSessionInfo[];
    };

/** True when the rows come from more than one landmark. */
function spansLandmarks(sessions: ChatSessionInfo[]): boolean {
  return new Set(sessions.map((s) => s.contextDir)).size > 1;
}

/**
 * Split a session list into what the menu renders. `contextDir` is the
 * landmark the current chat is bound to, or null when it has none yet (a brand
 * new chat before its session id lands).
 *
 * Falls back to one flat list when there's no landmark to promote or nothing
 * bound to it — an empty "this landmark" heading would be chrome with no
 * content, and a single group heading over the whole list says nothing.
 */
export function layoutSessionList(args: {
  sessions: ChatSessionInfo[];
  contextDir: string | null;
}): SessionListLayout {
  const { sessions, contextDir } = args;
  const flat = (): SessionListLayout => ({
    kind: "flat",
    sessions,
    showLandmark: spansLandmarks(sessions),
  });

  if (contextDir === null) return flat();
  const here = sessions.filter((s) => s.contextDir === contextDir);
  if (here.length === 0) return flat();

  const elsewhere = sessions.filter((s) => s.contextDir !== contextDir);
  if (elsewhere.length === 0) return flat();

  return {
    kind: "grouped",
    // Every row in `here` shares a contextDir, so they agree on the label.
    hereLabel: here[0]?.landmarkLabel ?? "This landmark",
    here,
    elsewhere,
  };
}
