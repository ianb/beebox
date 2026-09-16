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
  } catch (_error) {
    return undefined;
  }
}

export async function removeServeEndpoint(boxRoot: string): Promise<void> {
  await fs.unlink(serveEndpointPath(boxRoot)).catch(() => {});
}
