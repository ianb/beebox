/**
 * Chat thread card schema — archive of conversations a messaging connector
 * once appended to, at:
 *   _content/chat/<connector>/<ChatSlug>/thread.chat-thread.card
 *
 * No connector appends to these now and nothing delivers from them; the
 * schema stays so the existing cards validate. `connector` is a plain string
 * because old cards carry the retired connector's name.
 */

import { cardSchema } from "../exports/cards.js";
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

export const ChatThreadSchema = cardSchema("chat-thread", {
  brief: "A conversation with one chat",
  description: "A conversation a messaging connector once appended to. Nothing delivers from it now; it is kept as history",
  category: "system",
  searchable: false,
  fields: {
    "chat-id": z.string(),
    connector: z.string(),
    description: z.string().optional(),
    participants: z.array(ParticipantEntry).optional(),
    entries: z.array(ThreadEntry).default([]),
  },
  instructions: `# Chat Threads

Read this card as history. Do not append to it: nothing sends.`,
});
