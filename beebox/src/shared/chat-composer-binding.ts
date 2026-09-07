import { z } from "zod";
import { parseRef, resolveRefPath } from "./ref-path.js";

const identity = z.string().trim().min(1).max(1024);
const contextDir = z.string().max(4096);
export const conversationTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("session"), sessionId: identity.refine((value) => value !== "new"), contextDir }),
  z.object({
    kind: z.literal("start"), clientConversationId: identity, contextDir,
    engine: z.enum(["claude", "codex"]), model: identity.optional(),
    seedFeatures: z.record(z.string(), z.string()).optional(),
  }),
]);
export type ConversationTarget = z.infer<typeof conversationTargetSchema>;
export const conversationSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("resolving"), requestId: identity, contextDir }),
  z.object({ kind: z.literal("ready"), target: conversationTargetSchema, label: identity }),
  z.object({ kind: z.literal("unavailable"), contextDir, reason: identity }),
]);
export type ConversationSelection = z.infer<typeof conversationSelectionSchema>;
const focusedRef = identity.refine((value) => {
  if ([...value].some((character) => (character.codePointAt(0) ?? 0) < 32)) return false;
  if (value.startsWith("//") || /^[A-Za-z][\d+.A-Za-z-]*:/.test(value)) return false;
  return resolveRefPath({ fromPath: undefined, ref: parseRef(value).path, kind: "card" }) !== null;
}, "Expected an in-box card reference");
export const attentionSnapshotSchema = z.object({
  surface: z.enum(["card", "browse", "dashboard", "landmarks", "chat", "other"]),
  focusedRef: focusedRef.optional(),
  transcript: z.enum(["visible", "hidden"]),
}).refine((value) => value.surface !== "other" || value.focusedRef === undefined,
  "Other surfaces cannot publish card context");
export type AttentionSnapshot = z.infer<typeof attentionSnapshotSchema>;
export const sendBindingSchema = z.object({
  boxSlug: identity, target: conversationTargetSchema, attention: attentionSnapshotSchema,
});
export type SendBinding = z.infer<typeof sendBindingSchema>;
export const composerBindingPublicationSchema = z.discriminatedUnion("kind", [
  z.object({
    version: z.literal(1), kind: z.literal("selection"), revision: z.number().int().nonnegative(),
    boxSlug: identity, selection: conversationSelectionSchema, attention: attentionSnapshotSchema,
  }),
  z.object({
    version: z.literal(1), kind: z.literal("assigned"), boxSlug: identity,
    clientConversationId: identity, sessionId: identity.refine((value) => value !== "new"), contextDir,
  }),
]);
export type ComposerBindingPublication = z.infer<typeof composerBindingPublicationSchema>;
