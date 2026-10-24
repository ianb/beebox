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

/**
 * `args` is argv after `node` and the script, after the legacy handoff
 * rewrite (`legacy-argv.ts`). `keys` are the registry's keys.
 */
export function selectVerb(args: readonly string[], keys: ReadonlySet<string>): VerbSelection {
  const [first, second] = args;
  if (first === undefined || first === "help") return ALL;
  if (first === "-V" || first === "--version") return { kind: "none" };
  if (first.startsWith("-")) return ALL;
  // `bbx engine <verb>`: the engine namespace is a parent, not a command module.
  const verb = first === "engine" ? second : first;
  if (verb === undefined || verb === "help" || verb.startsWith("-")) return ALL;
  const key = verbRegistryKey(verb);
  return keys.has(key) ? { kind: "verb", key } : ALL;
}
