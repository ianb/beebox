import { z } from "zod";

/** Claude Agent SDK session ids are UUIDs; keep them safe as path segments. */
export const sdkSessionIdSchema = z.string().uuid();

export function parseSdkSessionId(value: string): string {
  return sdkSessionIdSchema.parse(value);
}
