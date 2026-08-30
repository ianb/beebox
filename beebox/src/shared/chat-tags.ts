/**
 * `<chat-app>` snapshot-tag stripping — extracted from `core/chat/features.ts`
 * to `shared/` so the frontend chat renderers can strip snapshots without a
 * value import into the backend `core/` graph (which used to drag the whole
 * chat-features module into the client bundle). `core/chat/features.ts`
 * re-imports `stripChatAppTags` from here so its own callers are unaffected.
 *
 * Pure string work (a single regex), so it stays bundler-safe and isomorphic.
 * `parseChatAppDeltas` deliberately stays in `features.ts`: it captures attrs
 * to extract feature deltas — a different, backend-only job.
 */

const CHAT_APP_TAG_RE = /<chat-app\b[^>]*?(?:\/\s*>|>[\S\s]*?<\/chat-app\s*>)\n?/gi;

/**
 * Strip every `<chat-app>` snapshot tag from a message — self-closing
 * (`<chat-app …/>`) or paired with a body, including `<card-activity>`
 * children (`<chat-app …>…</chat-app>`) — for display and stored history.
 * The single source of truth so consumers can't drift from the serializer:
 * five separate copies of this regex once leaked the paired form into
 * rendered messages (each only matched an empty body).
 */
export function stripChatAppTags(text: string): string {
  return text.replace(CHAT_APP_TAG_RE, "");
}
