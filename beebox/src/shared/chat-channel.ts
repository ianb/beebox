/**
 * The `channel` vocabulary — where the user is sending a chat message from,
 * surfaced to the agent as the read-only `<chat-app channel>` snapshot
 * attribute so it can shape its answer for the surface.
 *
 * Closed on purpose (`docs/plans/agent-points-at-ui.md`, Track 5): the agent
 * reasons about the answer's *shape* from this value, and `ios-native` means
 * something structural — the composer, mic and capture are native chrome, not
 * elements of the web page. Lives in `shared/` so the frontend (which decides
 * the value) and the route layer (which validates it) name the same union.
 */
export const CHAT_CHANNELS = ["web-desktop", "web-mobile", "ios-native"] as const;

export type ChatChannel = (typeof CHAT_CHANNELS)[number];

/** Channels that can appear in agent context; Telegram is not client-declarable. */
export type AgentChatChannel = ChatChannel | "telegram";
