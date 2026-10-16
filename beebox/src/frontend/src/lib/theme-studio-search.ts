import { z } from "zod";

/** Draft names deliberately need no product catalog entry. */
export const themeStudioSearchSchema = z.object({
  system: z.string().default("plain"),
  systemStock: z.string().default("neutral"),
  card: z.string().default("plain"),
  cardStock: z.string().default("neutral"),
});
