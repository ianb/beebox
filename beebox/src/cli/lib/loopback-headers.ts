/**
 * Headers for a CLI command's loopback call to its own box's server: the
 * agent bearer the box auth wall accepts from the box's own agents, and the
 * box-work lease the command holds. Shared by the `bbx chat` commands and
 * `bbx browser`.
 */

import { resolveAgentToken } from "../../core/agent/token.js";

/**
 * Request headers for loopback calls to the live server: JSON content type
 * plus the per-box agent bearer when available (required to pass the auth
 * wall in production; harmless when auth is disabled in dev).
 */
export function loopbackHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.BBX_BOX_WORK) headers["x-bbx-box-work"] = process.env.BBX_BOX_WORK;
  const token = resolveAgentToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}
