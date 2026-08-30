/**
 * Chat job card schema — a job to process new messages in a chat thread.
 *
 * Created by messaging connectors (e.g. Telegram) when new messages
 * arrive or when a callback timer expires. The agent reads the
 * referenced thread, decides whether to respond, and appends its
 * response or acknowledgment.
 */

import { cardSchema, cardRef, renderFrontmatterBlock, type InferCardFields } from "../cards/index.js";
import { z } from "zod";

export const ChatJobSchema = cardSchema("chat-job", {
  description: "A system job to process new messages (or a callback timer) in a chat thread; created by messaging connectors",
  category: "system",
  searchable: false,
  fields: {
    status: z.string().default("pending"),
    source: z.string(),
    description: z.string(),
    thread: cardRef(),
  },
  instructions: `# Processing Chat Jobs

A chat job means there are new messages (or a scheduled callback) in
a chat thread.

The \`source\` field names the connector that owns the thread, so
\`bbx wakeup --connector telegram\` can drain telegram-originated chat
jobs without picking up unrelated work.

## Steps

1. The job content and thread content are provided in the prompt — do
   NOT re-read them
2. Find new messages: scan backward from the end of the thread's
   \`entries:\` array for the last \`kind: seen\` or
   \`kind: message, sender: agent\` — everything after that is new
3. If there are no new messages, check the last \`kind: seen\` entry's
   \`text:\` for a note-to-self about what to do
4. Decide whether to respond or acknowledge:
   - **Respond**: append an entry \`{kind: message, sender: agent,
     text: "Your response"}\`
   - **Acknowledge**: append an entry \`{kind: seen}\` (optionally with
     \`callback-in\` and/or a note-to-self \`text:\`)
5. Commit the thread file
6. Run \`bbx finish {thisJobFile}\` to complete the job

## Important

- Only append ONE entry at the end of \`entries:\`
- Do NOT modify existing entries
- Do NOT fill in \`sent\` or \`id\` on agent messages — the connector
  handles delivery
- Commit the thread file before finishing the job`,
});

export type ChatJobFields = InferCardFields<typeof ChatJobSchema>;

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
  return renderFrontmatterBlock(fields);
}
