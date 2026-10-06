/** The machine-owned endpoint published by a live `bbx serve` process. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../lib/atomic-write.js";

const ENDPOINT_FILE = "serve-endpoint.json";
const endpointSchema = z.strictObject({ pid: z.number().int().positive(), publicUrl: z.string().url() });

export interface ServeEndpoint {
  pid: number;
  publicUrl: string;
}

export function serveEndpointPath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", ENDPOINT_FILE);
}

export async function writeServeEndpoint(boxRoot: string, endpoint: ServeEndpoint): Promise<void> {
  await writeFileAtomic(serveEndpointPath(boxRoot), { content: `${JSON.stringify(endpoint)}\n` });
}

export async function readServeEndpoint(boxRoot: string): Promise<ServeEndpoint | undefined> {
  try {
    const parsed = endpointSchema.safeParse(JSON.parse(await fs.readFile(serveEndpointPath(boxRoot), "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch (error) {
    // Missing or malformed machine state means no endpoint is available; do
    // not turn it into a guessed URL. Other filesystem errors need to remain
    // visible to the caller rather than silently changing the source cascade.
    if (isAbsentEndpoint(error) || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export async function removeServeEndpoint(boxRoot: string): Promise<void> {
  try {
    await fs.unlink(serveEndpointPath(boxRoot));
  } catch (error) {
    // Clean shutdown is idempotent when the descriptor was never written.
    if (isAbsentEndpoint(error)) return;
    throw error;
  }
}

function isAbsentEndpoint(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
