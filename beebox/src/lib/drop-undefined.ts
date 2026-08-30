/**
 * Drop keys whose value is `undefined` from an env-style record, narrowing the
 * value type from `string | undefined` to `string`. Shared by agent process
 * spawning (`core/agent-json`) and the Claude chat service, which kept
 * identical private copies.
 */
export function dropUndefined(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
