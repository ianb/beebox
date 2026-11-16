/**
 * The admitted box-work permit for the current async context, and the
 * environment that delegates it to a child. A leaf module: `git/env.ts`
 * reads it without importing the admission machinery, which runs git.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";

export const permitSchema = z.object({ directory: z.string(), id: z.string().uuid(), maintenance: z.boolean() });
export type Permit = z.infer<typeof permitSchema>;

/** `null` marks independent root work; absent inherits `BBX_BOX_WORK`. */
export const boxWorkContext = new AsyncLocalStorage<Permit | null>();

/** Only the current admitted operation can delegate, never ambient server state. */
export function boxWorkEnvironment(): Record<string, string> {
  const permit = boxWorkContext.getStore();
  // CLI actions install their validated admission here; servers do not.
  const inherited = permit === null ? undefined : process.env.BBX_BOX_WORK;
  return permit ? { BBX_BOX_WORK: JSON.stringify(permit) } : inherited ? { BBX_BOX_WORK: inherited } : {};
}
