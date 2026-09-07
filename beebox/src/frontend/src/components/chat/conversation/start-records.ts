import { z } from "zod";
import { conversationTargetSchema } from "../../../../../shared/chat-composer-binding.js";

const ROUTING_ERRORS = {
  box: "Return to the original box before sending this message",
  controller: "Conversation controller unavailable",
  recovery: "Find the started conversation in Chats, then restore this unsent follow-up",
  waiting: "Waiting for conversation assignment",
  storage: "Conversation startup records need recovery",
};
export class ConversationRoutingError extends Error {
  constructor({ kind }: { kind: keyof typeof ROUTING_ERRORS }) {
    super(ROUTING_ERRORS[kind]); this.name = "ConversationRoutingError";
  }
}

const recordSchema = z.object({
  target: conversationTargetSchema.refine((target) => target.kind === "start"),
  firstEmissionId: z.string().min(1),
  state: z.enum(["prepared", "attempted", "accepted", "assigned"]),
  sessionId: z.string().min(1).optional(),
}).refine((record) => record.state !== "assigned" || record.sessionId !== undefined);
export type StartRecord = z.infer<typeof recordSchema>;
export type RoutingStorage = Pick<Storage, "getItem" | "setItem">;

/** Metadata only. Native keeps the content of its own unreceipted emissions. */
export class StartRecords {
  private records = new Map<string, StartRecord>();
  private readonly key: string;
  constructor(private readonly storage: RoutingStorage, boxSlug: string) {
    this.key = `bbx-conversation-starts:${boxSlug}`;
    const raw = storage.getItem(this.key);
    if (raw === null) return;
    let decoded: unknown;
    try { decoded = JSON.parse(raw); }
    catch (_error) { throw new ConversationRoutingError({ kind: "storage" }); }
    const parsed = z.array(z.tuple([z.string().min(1), recordSchema])).safeParse(decoded);
    if (!parsed.success || parsed.data.some(([id, record]) =>
      record.target.clientConversationId !== id)) {
      throw new ConversationRoutingError({ kind: "storage" });
    }
    this.records = new Map(parsed.data);
  }
  get(id: string): StartRecord | undefined { return this.records.get(id); }
  put(id: string, value: StartRecord): void {
    const next = new Map(this.records);
    next.set(id, value);
    this.storage.setItem(this.key, JSON.stringify([...next]));
    this.records = next;
  }
}
