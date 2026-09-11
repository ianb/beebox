/**
 * Near-miss detection for secret names — in `shared/` because the add form
 * runs it as the boxholder types, and the client may import `shared/` only.
 *
 * A secret named `OpenRouter` or `openrouter.ai` is stored fine and read by
 * nothing: every consumer looks up `openrouter` exactly. Nothing today says
 * so. This turns the realistic typos — case, punctuation, a domain suffix —
 * into a suggestion. Edit distance is deliberately not used: it would offer
 * `openrouter` for `openai`, which is worse than no suggestion.
 *
 * A suggestion is advice, never a rewrite: the typed name still saves as typed.
 */

/** Case-fold and strip everything but `[a-z0-9]`. */
export function normalizeSecretName(name: string): string {
  return name.toLowerCase().replace(/[^\da-z]/g, "");
}

/**
 * The known name `typed` normalises to, when it is not already exactly that
 * name; otherwise null. Family prefixes (`telegram-bot/`) are skipped — they are
 * not names a person types.
 */
/**
 * What people append to a provider's name when guessing: the domain suffix
 * (`openrouter.ai`), or the word for the thing (`openrouter-key`). Stripped
 * once, from the end, and only when what remains is a known name — so this
 * never invents a match, it only forgives a decoration.
 */
const DECORATIONS = ["apikey", "token", "key", "com", "ai", "io"];

export function suggestSecretName(typed: string, knownNames: readonly string[]): string | null {
  const wanted = normalizeSecretName(typed);
  if (wanted === "") return null;
  const candidates = [wanted, ...DECORATIONS.filter((d) => wanted.endsWith(d) && wanted.length > d.length).map((d) => wanted.slice(0, -d.length))];
  for (const known of knownNames) {
    if (known.endsWith("/")) continue;
    if (known === typed.trim()) return null;
    if (candidates.includes(normalizeSecretName(known))) return known;
  }
  return null;
}
