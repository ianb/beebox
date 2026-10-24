/**
 * Which command modules a `bbx` invocation needs, read from its argv alone.
 *
 * A run loads only the verb it names; `--version` loads none. Anything this
 * cannot place with certainty — no verb, a help request, an option before the
 * verb, a token that names no command — loads every command, which is what
 * every run did before. That keeps Commander's help output and its
 * unknown-command error (with its "did you mean" suggestion) unchanged; it
 * only costs those runs their speed.
 */

export type VerbSelection =
  | { readonly kind: "verb"; readonly key: string }
  | { readonly kind: "all" }
  | { readonly kind: "none" };

/** A verb's registry key: its name in camelCase (`agent-context` → `agentContext`). */
export function verbRegistryKey(verb: string): string {
  return verb.replace(/-([\da-z])/g, (_match, letter: string) => letter.toUpperCase());
}

const ALL: VerbSelection = { kind: "all" };

/** Registry keys of the verbs on each surface: `bbx <verb>` and `bbx engine <verb>`. */
export interface SurfaceKeys {
  readonly agent: ReadonlySet<string>;
  readonly engine: ReadonlySet<string>;
}

/**
 * `args` is argv after `node` and the script, after the legacy handoff
 * rewrite (`legacy-argv.ts`). A verb is selected only on the surface it is
 * classified for (`surface-data.ts`): `bbx serve` or `bbx engine ls` loads
 * everything, so Commander reports the unknown command as it always has.
 */
export function selectVerb(args: readonly string[], surfaces: SurfaceKeys): VerbSelection {
  const [first, second] = args;
  if (first === undefined || first === "help") return ALL;
  if (first === "-V" || first === "--version") return { kind: "none" };
  if (first.startsWith("-")) return ALL;
  // `bbx engine <verb>`: the engine namespace is a parent, not a command module.
  const [verb, keys] = first === "engine" ? [second, surfaces.engine] : [first, surfaces.agent];
  if (verb === undefined || verb === "help" || verb.startsWith("-")) return ALL;
  const key = verbRegistryKey(verb);
  return keys.has(key) ? { kind: "verb", key } : ALL;
}

/** The registry keys of each surface's verbs, from the surface table's entries. */
export function surfaceKeys(entries: ReadonlyArray<{ readonly name: string; readonly audience: "agent" | "engine" }>): SurfaceKeys {
  const keysFor = (audience: "agent" | "engine"): Set<string> =>
    new Set(entries.filter((entry) => entry.audience === audience).map((entry) => verbRegistryKey(entry.name)));
  return { agent: keysFor("agent"), engine: keysFor("engine") };
}
