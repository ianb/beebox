/**
 * Custom serializers for t.check() in route tests.
 *
 * Import alongside tap-check.js in any test that checks Fastify inject responses.
 */

import { registerSerializer } from "agent-doctest/check";

/**
 * Serialize Fastify inject() response as "statusCode\n{json body}".
 * Lets you check status + body in a single t.check() call:
 *
 *   t.check(res, `200\n{ "success": true }`);
 */
registerSerializer((v) => {
  if (
    v && typeof v === "object"
    && "statusCode" in v
    && "json" in v
    && typeof (v as Record<string, unknown>).json === "function"
  ) {
    const r = v as { statusCode: number; json: () => unknown };
    const body = r.json();
    const json = JSON.stringify(body, null, 2);
    return `${r.statusCode}\n${json}`;
  }
  return null;
});
