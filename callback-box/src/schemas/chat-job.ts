/**
 * Chat job card schema — a job to process new messages in a chat thread.
 *
 * Created by messaging connectors (e.g. Telegram) when new messages
 * arrive or when a callback timer expires. The agent reads the
 * referenced thread, decides whether to respond, and appends its
 * response or acknowledgment.
 */

import { cardSchema, type CardSchema } from "../cards/index.js";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export const ChatJobSchema: CardSchema = cardSchema("chat-job", {
  description: "A system job to process new messages (or a callback timer) in a chat thread; created by messaging connectors",
  category: "system",
  searchable: false,
  fields: {
    status: z.string().default("pending"),
    source: z.string(),
    description: z.string(),
    thread: z.object({ ref: z.string() }),
  },
  instructions: `# Processing Chat Jobs

A chat job means there are new messages (or a scheduled callback) in
a chat thread.

The \`source\` field names the connector that owns the thread, so
\`cb wakeup --connector telegram\` can drain telegram-originated chat
jobs without picking up unrelated work.

## Steps

1. The job content and thread content are provided in the prompt — do
   NOT re-read them
2. Find new messages: scan backward from the end for the last
   \`<seen>\` or \`<message sender="agent">\` — everything after that
   is new
3. If there are no new messages, check the last \`<seen>\` for a
   note-to-self about what to do
4. Decide whether to respond or acknowledge:
   - **Respond**: append \`<message sender="agent">Your response</message>\`
     at the end
   - **Acknowledge**: append \`<seen />\` (optionally with
     \`callback-in\` and/or a note-to-self)
5. Commit the thread file
6. Run \`cb finish {thisJobFile}\` to complete the job

## Important

- Only append ONE element at the end of the thread
- Do NOT modify existing messages
- Do NOT fill in \`sent\` or \`id\` on agent messages — the connector
  handles delivery
- Commit the thread file before finishing the job`,
});

export interface ChatJobFields {
  type: "chat-job";
  status: string;
  source: string;
  description: string;
  thread: { ref: string };
}

export function createChatJobTemplate(options: {
  description: string;
  threadRef: string;
  source: string;
}): string {
  const fields: Record<string, unknown> = {
    status: "pending",
    source: options.source,
    description: options.description,
    thread: { ref: options.threadRef },
  };
  return `---\n${stringifyYaml(fields)}---\n`;
}
