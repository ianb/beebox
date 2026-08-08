import { z } from "zod";

export const shareDestination = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inbox") }),
  z.object({ kind: z.literal("landmark"), dir: z.string() }),
]);

export const shareDestinationsOutput = z.object({
  chats: z.array(z.object({
    sessionId: z.string(),
    label: z.string(),
    lastActivity: z.string().datetime(),
    landmark: z.object({
      dir: z.string(),
      label: z.string(),
      symbol: z.string().nullable(),
    }),
  })).max(2),
  saves: z.array(z.object({
    destination: shareDestination,
    label: z.string(),
    symbol: z.string().nullable(),
  })),
});

const sharedFields = {
  shareId: z.string().uuid(),
  title: z.string().optional(),
  capturedAt: z.string().datetime(),
  destination: shareDestination,
};

export const saveTextualInput = z.discriminatedUnion("kind", [
  z.object({ ...sharedFields, kind: z.literal("url"), url: z.string().url() }),
  z.object({ ...sharedFields, kind: z.literal("text"), text: z.string().min(1) }),
]);

export const saveTextualOutput = z.object({ created: z.array(z.string()).length(1) });

