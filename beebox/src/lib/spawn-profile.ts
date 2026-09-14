/**
 * Which spawn profile this process was started under.
 *
 * `core/script-env.ts` stamps `BBX_SPAWN_PROFILE` onto every box-spawned
 * subprocess: `agent` for the credential-free agent profile, `tooling` for the
 * box's own `bbx` children (which carry the connector credential paths).
 *
 * Readers branch on `tooling` and nothing else. A missing or unrecognized
 * value is `unset`, which every caller must treat exactly like `agent` — a
 * spawn site that forgets the marker gets delegation or a refusal, never local
 * credential use. See `docs/plans/agent-capability-delegation.md`.
 */

export type SpawnProfile = "agent" | "tooling" | "unset";

/** The current process's spawn profile; `unset` for anything unrecognized. */
export function spawnProfile(): SpawnProfile {
  const raw = process.env.BBX_SPAWN_PROFILE;
  if (raw === "agent" || raw === "tooling") return raw;
  return "unset";
}
