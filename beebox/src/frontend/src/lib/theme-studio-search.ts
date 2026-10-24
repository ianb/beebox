import { z } from "zod";

/** Draft names deliberately need no product catalog entry. */
export const themeStudioSearchSchema = z.object({
  system: z.string().default("plain"),
  systemStock: z.string().default("neutral"),
  card: z.string().default("plain"),
  cardStock: z.string().default("neutral"),
  /** `0` leaves out the floating controls (theme-check, the screen preview). The router reads `0` as a number. */
  controls: z.coerce.string().optional(),
  /** A `SCREENS` name: preview the studio at that screen's size. */
  screen: z.string().optional(),
});
