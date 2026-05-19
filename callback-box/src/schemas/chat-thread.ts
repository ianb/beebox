/**
 * Chat thread card schema — accumulating message thread for messaging connectors.
 *
 * Each chat (private or group) gets one thread file at:
 *   store/chat/<connector>/<ChatSlug>/thread.chat-thread.card
 *
 * The agent appends <message sender="agent"> or <seen /> as the last element.
 * The connector appends incoming <message> elements after the agent's last entry.
 */

import { element, escapeText, escapeAttr } from "cardworks";
import { z } from "zod";

/**
 * Brief description of the chat (e.g. "Family group chat", "DM with Alice").
 * Set by the connector from the chat title or inferred from participants.
 */
export const ChatDescription = element("description", {
  text: z.string(),
});

/**
 * A participant reference — points to a person in the people directory.
 */
export const ChatPerson = element("person", {
  attrs: {
    ref: z.string(),
  },
});

/**
 * List of known participants in this chat.
 * Updated by the connector as new senders appear.
 */
export const ChatParticipants = element("participants", {
  children: z.array(ChatPerson),
});

/**
 * A single chat message.
 *
 * - `id` — connector message ID (absent for unsent agent messages)
 * - `sender` — display name, or "agent" for bot messages
 * - `sender-id` — connector user ID (absent for agent)
 * - `time` — when a human sent the message (ISO timestamp)
 * - `sent` — when an agent message was delivered (absent = pending send)
 */
export const ChatMessage = element("message", {
  attrs: {
    id: z.string().optional(),
    sender: z.string(),
    "sender-id": z.string().optional(),
    time: z.string().datetime({ offset: true }).optional(),
    sent: z.string().datetime({ offset: true }).optional(),
  },
  text: z.string(),
});

/**
 * Agent acknowledgment — "I saw everything above, nothing to say."
 *
 * - `callback-in` — re-invoke agent after this duration (e.g. "5m", "1h")
 * - `wait-for` — structured label for what the agent is waiting on
 * - Text content — free-form instruction to the agent's future self
 */
export const ChatSeen = element("seen", {
  attrs: {
    "callback-in": z.string().optional(),
    "wait-for": z.string().optional(),
  },
  text: z.string().optional(),
});

/**
 * Chat thread card schema.
 *
 * Example:
 * ```xml
 * <chat-thread chat-id="-1001234567890" connector="telegram">
 * <description>Family Group</description>
 * <participants>
 * <person ref="people/Jane_Doe" />
 * <person ref="people/Alice" />
 * </participants>
 * <message id="1" sender="Jane Doe" sender-id="8239678071" time="2026-02-26T19:35:19Z">Hi</message>
 * <message sender="agent" sent="2026-02-26T19:36:00Z">Hey! I'm set up and listening.</message>
 * <message id="2" sender="Alice" sender-id="12345" time="2026-02-26T20:00:00Z">Can someone pick me up at 3?</message>
 * <seen callback-in="30m">Check if anyone responded about picking Alice up.</seen>
 * </chat-thread>
 * ```
 */
export const ChatThreadSchema = element("chat-thread", {
  attrs: {
    "chat-id": z.string(),
    connector: z.string(),
  },
  children: z.array(z.union([ChatDescription, ChatParticipants, ChatMessage, ChatSeen])),
  instructions: `# Processing Chat Threads

A chat thread is an accumulating conversation from a messaging connector (e.g. Telegram). Your job references a thread file — read it to see the conversation.

## Thread structure

The thread starts with metadata:
- \`<description>\` — what this chat is (e.g. "Family group chat")
- \`<participants>\` — who's in the chat, with refs to the people directory

After the metadata come the messages and acknowledgments.

## Guidelines

Check for a \`chat.guide.card\` file in the same directory as the thread file. If it exists, read it — it contains per-chat behavioral guidelines (when to respond, tone, topics to watch for). Follow those guidelines when deciding how to respond.

## Finding new messages

Scan backward from the end of the thread. The last \`<seen>\` or \`<message sender="agent">\` marks the boundary of what was previously processed. Everything after that boundary is new.

If the last element is already yours (\`<seen>\` or \`<message sender="agent">\`) and there are no new messages after it, check whether the \`<seen>\` has text content — that's a note from your previous self about what to do next (e.g. follow up on something).

## Responding

You MUST leave exactly one trailing element at the end of the thread:

- **\`<message sender="agent">Your response</message>\`** — to send a message to the chat. Do NOT fill in the \`sent\` or \`id\` attributes; the connector handles delivery.
- **\`<seen />\`** — to acknowledge without responding. Use this for casual/social messages, messages not directed at you, or when there's nothing useful to add.

### When to respond vs. acknowledge
- Respond to direct questions, requests, or when you have genuinely useful information
- Acknowledge (\`<seen />\`) casual chatter, messages between other people, or when silence is appropriate
- When in doubt, acknowledge rather than respond — unsolicited messages are annoying

### Scheduling follow-ups
- \`<seen callback-in="30m">Check if anyone answered Alice's question</seen>\` — you'll be re-invoked in 30 minutes if no new messages arrive
- The text content of \`<seen>\` is a note to your future self — write what you plan to check or do

## Important rules
- Only append ONE element at the end (one \`<message>\` or one \`<seen>\`)
- Do NOT modify or remove existing messages in the thread
- Do NOT modify \`<description>\`, \`<participants>\`, or other metadata — the connector manages those
- Do NOT fill in \`sent\` or \`id\` on agent messages — the connector stamps those after delivery
- Commit the thread file, then run \`cb finish {jobFile}\` to complete the job`,
});

export type ChatThread = z.infer<typeof ChatThreadSchema>;

/**
 * Create an empty chat thread XML string.
 */
export function createChatThreadTemplate(options: {
  chatId: string;
  connector: string;
  description?: string;
  participants?: string[];
}): string {
  const descLine = options.description
    ? `\n  <description>${escapeText(options.description)}</description>`
    : "";
  let participantsBlock = "";
  if (options.participants && options.participants.length > 0) {
    const personLines = options.participants
      .map((ref) => `    <person ref="${escapeAttr(ref)}" />`)
      .join("\n");
    participantsBlock = `\n  <participants>\n${personLines}\n  </participants>`;
  }
  return `<chat-thread chat-id="${escapeAttr(options.chatId)}" connector="${escapeAttr(options.connector)}">${descLine}${participantsBlock}
</chat-thread>
`;
}

/**
 * Create an XML string for a single <message> element (for appending).
 */
export function createMessageElement(options: {
  id?: string;
  sender: string;
  senderId?: string;
  time?: string;
  sent?: string;
  text: string;
}): string {
  const attrs: string[] = [];
  if (options.id) attrs.push(` id="${escapeAttr(options.id)}"`);
  attrs.push(` sender="${escapeAttr(options.sender)}"`);
  if (options.senderId) attrs.push(` sender-id="${escapeAttr(options.senderId)}"`);
  if (options.time) attrs.push(` time="${escapeAttr(options.time)}"`);
  if (options.sent) attrs.push(` sent="${escapeAttr(options.sent)}"`);
  return `  <message${attrs.join("")}>${escapeText(options.text)}</message>`;
}
