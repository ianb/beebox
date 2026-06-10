/**
 * Chat thread card schema — accumulating message thread for messaging connectors.
 *
 * Each chat (private or group) gets one thread file at:
 *   store/chat/<connector>/<ChatSlug>/thread.chat-thread.card
 *
 * The connector appends incoming messages; the agent appends one trailing
 * message (its reply) or seen-marker (acknowledge without replying).
 */

import { cardSchema, type CardSchema } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

const ParticipantEntry = z.object({
  ref: z.string(),
});

const MessageEntry = z.object({
  kind: z.literal("message"),
  id: z.string().optional(),
  sender: z.string(),
  "sender-id": z.string().optional(),
  time: z.string().datetime({ offset: true }).optional(),
  sent: z.string().datetime({ offset: true }).optional(),
  text: z.string(),
});

const SeenEntry = z.object({
  kind: z.literal("seen"),
  "callback-in": z.string().optional(),
  "wait-for": z.string().optional(),
  text: z.string().optional(),
});

const ThreadEntry = z.discriminatedUnion("kind", [MessageEntry, SeenEntry]);

export const ChatThreadSchema: CardSchema = cardSchema("chat-thread", {
  searchable: false,
  fields: {
    "chat-id": z.string(),
    connector: z.string(),
    description: z.string().optional(),
    participants: z.array(ParticipantEntry).optional(),
    entries: z.array(ThreadEntry).default([]),
  },
  instructions: `# Processing Chat Threads

A chat thread is an accumulating conversation from a messaging connector (e.g. Telegram). Your job references a thread file — read it to see the conversation.

## Thread structure (YAML frontmatter)

Top-level fields:
- \`chat-id:\` and \`connector:\` — identify the chat
- \`description:\` — what this chat is (e.g. "Family group chat")
- \`participants:\` — array of \`{ref: people/...}\` linking to people cards
- \`entries:\` — chronological array of messages and seen-markers

Each entry has a \`kind\` discriminator:
- \`kind: message\` with fields \`sender\`, \`sender-id?\`, \`time?\`, \`sent?\`, \`id?\`, \`text\`
- \`kind: seen\` with fields \`callback-in?\`, \`wait-for?\`, \`text?\`

## Guidelines

Check for a \`chat.guide.card\` file in the same directory as the thread file. If it exists, read it — it contains per-chat behavioral guidelines (when to respond, tone, topics to watch for). Follow those guidelines when deciding how to respond.

## Finding new messages

Scan backward from the end of the \`entries:\` array. The last \`kind: seen\` or \`kind: message\` with \`sender: agent\` marks the boundary of what was previously processed. Everything after that boundary is new.

If the last entry is already yours (\`seen\` or agent message) and there are no new messages after it, check whether the seen entry has a \`text:\` — that's a note from your previous self about what to do next.

## Responding

You MUST leave exactly one trailing entry at the end of \`entries:\`:

- A message entry with \`kind: message, sender: agent, text: "Your response"\` — to send a message. Do NOT set \`sent\` or \`id\`; the connector handles delivery.
- A seen entry with \`kind: seen\` — to acknowledge without responding. Use this for casual/social messages, messages not directed at you, or when there's nothing useful to add.

### When to respond vs. acknowledge
- Respond to direct questions, requests, or when you have genuinely useful information
- Acknowledge (\`kind: seen\`) casual chatter, messages between other people, or when silence is appropriate
- When in doubt, acknowledge rather than respond — unsolicited messages are annoying

### Scheduling follow-ups
- \`{kind: seen, callback-in: 30m, text: "Check if anyone answered Alice's question"}\` — you'll be re-invoked in 30 minutes if no new messages arrive
- The \`text\` of a seen entry is a note to your future self — write what you plan to check or do

## Important rules
- Only append ONE entry to the end of \`entries:\` (one message or one seen)
- Do NOT modify or remove existing entries in the thread
- Do NOT modify \`description\`, \`participants\`, or other metadata — the connector manages those
- Do NOT set \`sent\` or \`id\` on agent messages — the connector stamps those after delivery
- Commit the thread file, then run \`cb finish {jobFile}\` to complete the job`,
});

export type ChatThreadMessage = z.infer<typeof MessageEntry>;
export type ChatThreadSeen = z.infer<typeof SeenEntry>;
export type ChatThreadEntry = z.infer<typeof ThreadEntry>;

export interface ChatThreadFields {
  type: "chat-thread";
  "chat-id": string;
  connector: string;
  description?: string;
  participants?: Array<{ ref: string }>;
  entries: ChatThreadEntry[];
}

/**
 * Create an empty chat thread YAML string.
 */
export function createChatThreadTemplate(options: {
  chatId: string;
  connector: string;
  description?: string;
  participants?: string[];
}): string {
  const fields: Record<string, unknown> = {
    "chat-id": options.chatId,
    connector: options.connector,
  };
  if (options.description !== undefined) fields["description"] = options.description;
  if (options.participants !== undefined && options.participants.length > 0) {
    fields["participants"] = options.participants.map((ref) => ({ ref }));
  }
  fields["entries"] = [];
  return `---\n${stringifyYaml(fields)}---\n`;
}

/**
 * Build a message entry object (for appending to entries[]).
 */
export function createMessageEntry(options: {
  id?: string;
  sender: string;
  senderId?: string;
  time?: string;
  sent?: string;
  text: string;
}): ChatThreadMessage {
  const out: ChatThreadMessage = {
    kind: "message",
    sender: options.sender,
    text: options.text,
  };
  if (options.id !== undefined) out.id = options.id;
  if (options.senderId !== undefined) out["sender-id"] = options.senderId;
  if (options.time !== undefined) out.time = options.time;
  if (options.sent !== undefined) out.sent = options.sent;
  return out;
}
