/**
 * Talking to Z.ai's usage endpoint, and finding the key.
 *
 * Split from the parser so the parse is testable without a network, matching
 * how `quota-requests.ts` sits beside `quota-parse.ts`.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { glmQuotaResponse, type GlmQuotaResponse } from "./quota-glm.js";

const QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit";

/** The endpoint answered, but not with a success status. */
class GlmQuotaHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Z.ai quota request failed");
    this.name = "GlmQuotaHttpError";
    this.status = status;
  }
  static for(status: number): GlmQuotaHttpError {
    return new GlmQuotaHttpError(status);
  }
}

/**
 * `GLM_API_KEY` from `beebox/.env` — the same file the dev router reads `BOXES=`
 * from, so a credential has one home rather than two. `null` when there is no
 * key, which is how a machine with no coding plan stays quiet.
 */
export async function readGlmKey(envPath?: string): Promise<string | null> {
  const file = envPath ?? path.join(process.cwd(), "..", "beebox", ".env");
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (_e) {
    // No env file at all — a checkout without one has no key either.
    return null;
  }
  const line = text.split("\n").find((entry) => entry.startsWith("GLM_API_KEY="));
  if (line === undefined) return null;
  const value = line.slice("GLM_API_KEY=".length).trim().replace(/^"|"$/gu, "");
  return value === "" ? null : value;
}

export async function requestGlmQuota(key: string, timeoutMs: number): Promise<GlmQuotaResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(QUOTA_URL, {
      // No `Bearer` prefix: Z.ai takes the key raw, and sending the prefix
      // fails as unauthenticated.
      headers: { Authorization: key, "Accept-Language": "en-US,en", "Content-Type": "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw GlmQuotaHttpError.for(response.status);
    return glmQuotaResponse.parse(await response.json());
  } finally {
    clearTimeout(timer);
  }
}
