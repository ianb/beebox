/**
 * Custom serializers for t.check() in route tests.
 *
 * Import alongside tap-check.js in any test that checks Fastify inject responses.
 */

import { registerSerializer } from "agent-doctest/check";
import { isRecord } from "../../src/lib/is-record.js";

/**
 * Serialize Fastify inject() response as "statusCode\n{json body}".
 * Lets you check status + body in a single t.check() call:
 *
 *   t.check(res, `200\n{ "success": true }`);
 */
registerSerializer((v) => {
  if (!isRecord(v)) return null;
  const { statusCode, json } = v;
  if (typeof statusCode !== "number" || typeof json !== "function") return null;
  const body: unknown = json.call(v);
  return `${statusCode}\n${JSON.stringify(body, null, 2)}`;
});
