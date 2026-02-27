/**
 * Chat job card schema — a job to process new messages in a chat thread.
 *
 * Created by messaging connectors (e.g. Telegram) when new messages arrive
 * or when a callback timer expires. The agent reads the referenced thread,
 * decides whether to respond, and appends its response or acknowledgment.
 */

import { element, escapeText, escapeAttr } from "cardworks";
import { z } from "zod";

/**
 * Child element for job description.
 */
export const ChatJobDescription = element("description", {
  text: z.string(),
});

/**
 * Reference to the chat thread file to process.
 */
export const ChatJobThread = element("thread", {
  attrs: {
    ref: z.string(),
  },
});

/**
 * Chat job card schema.
 *
 * Example:
 * ```xml
 * <chat-job status="pending" created="2026-02-26T20:00:00Z">
 *   <description>New messages in Family Group</description>
 *   <thread ref="store/chat/telegram/Family_Group/thread.chat-thread.card" />
 * </chat-job>
 * ```
 */
export const ChatJobSchema = element("chat-job", {
  attrs: {
    status: z.string().default("pending"),
    created: z.string().datetime({ offset: true }),
  },
  children: z.array(z.union([ChatJobDescription, ChatJobThread])),
  instructions: `# Processing Chat Jobs

A chat job means there are new messages (or a scheduled callback) in a chat thread.

## Steps

1. Read this job card to find the thread reference (\`<thread ref="...">\`)
2. Read the referenced chat thread file
3. Find new messages: scan backward from the end for the last \`<seen>\` or \`<message sender="agent">\` — everything after that is new
4. If there are no new messages, check the last \`<seen>\` for a note-to-self about what to do
5. Decide whether to respond or acknowledge:
   - **Respond**: append \`<message sender="agent">Your response</message>\` at the end
   - **Acknowledge**: append \`<seen />\` (optionally with \`callback-in\` and/or a note-to-self)
6. Commit the thread file
7. Run \`cb finish <this-job-file>\` to complete the job

## Important

- Read the thread BEFORE responding — understand context
- Only append ONE element at the end of the thread
- Do NOT modify existing messages
- Do NOT fill in \`sent\` or \`id\` on agent messages — the connector handles delivery
- Commit the thread file before finishing the job`,
});

export type ChatJob = z.infer<typeof ChatJobSchema>;

/**
 * Template for creating a chat job card.
 */
export function createChatJobTemplate(options: {
  created?: string;
  description: string;
  threadRef: string;
}): string {
  const created = options.created ?? new Date().toISOString();
  return `<chat-job status="pending" created="${escapeAttr(created)}">
  <description>${escapeText(options.description)}</description>
  <thread ref="${escapeAttr(options.threadRef)}" />
</chat-job>
`;
}
