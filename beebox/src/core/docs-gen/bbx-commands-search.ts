/**
 * The `## bbx search` section of the `bbx` command reference doc
 * (bbx-commands.md): query style, examples, filters, and the result format.
 * Moved verbatim from the agent guide's SEARCHING section, which keeps the
 * rule and points here. Assembled by generateBbxCommands().
 */

/** The `bbx search` section. */
export function bbxCommandsSearch(): string[] {
  return [
    "## bbx search",
    "",
    "Full-text search over the box's cards, its standalone `.md` files (kind `markdown`), and the engine's reference docs (kind `engine-doc`), ranked by relevance.",
    "",
    "```",
    "bbx search \"<query>\" [--kind <type>...] [--path <prefix>] [--limit <n>] [--mode <text|hybrid>] [--json] [--rebuild]",
    "```",
    "",
    "**Query style:** when the box has an embeddings key configured, search ranks by",
    "*meaning* as well as words (each card's `contains:` sentence is matched",
    "semantically, fused with keyword ranking). So for vague recall, describe the",
    "card in one sentence — shaped like the `contains:` line you hope exists — and",
    "include any exact tokens you remember (names, numbers, IDs): the sentence",
    "carries the semantic match, the rare tokens nail the keyword match. Both in one",
    "query is the optimum, not a compromise. For an exact-identifier hunt the bare",
    "token alone works. Without an embeddings key, ranking is keyword-only: lead",
    "with distinctive words. Either way it's relevance-ranked — quoting a phrase",
    "does not do exact-match.",
    "",
    "Examples:",
    "",
    "- `bbx search \"the letter about the pension from the insurance company\"` — vague",
    "  recall: describe it; meaning-ranked even though no word may match exactly",
    "- `bbx search \"dentist appointment moved to a new date\" --kind email-message` —",
    "  a summary-shaped sentence, emails only",
    "- `bbx search \"Priya phone\" --path _content/people` — exact tokens + a path filter",
    "- `bbx search \"10494\" --mode text` — an exact identifier; `--mode text` forces",
    "  keyword-only ranking (offline, deterministic)",
    "",
    "**Filters:** `--kind <type>` (repeatable), `--path <prefix>` (box-relative, so `_content/…`), `--limit N`",
    "(default 10); `--mode <text|hybrid>` (omitted = automatic: semantic+keyword",
    "when available); `--json` for the structured envelope.",
    "",
    "**A result** shows the card's path (with a `#fragment` locator when the match is",
    "inside the card) and title, then the card's `contains:` sentence and a matched",
    "excerpt — so you see both *which* card and *where* in it. A truncated run reports",
    "\"N of total.\"",
    "",
  ];
}
