/**
 * Marking direct quotes (verbatim words from a person) inside markdown
 * bodies. Renders as a styled inline span or block figure, distinct from
 * a generic blockquote.
 */

export function quotesSection(): string[] {
  return [
    "## Direct Quotes",
    "",
    "The user's words are precious — most of all when they're being",
    "expressive: working through an idea, voicing an opinion, describing",
    "how they see something. Preserve their authentic expression by",
    "marking verbatim spans with `{% quote %}`, so their voice stays",
    "distinct from your paraphrase:",
    "",
    "```",
    "Mid-rant about his projects: {% quote %}I keep starting things",
    "because the start feels so alive, and then a week in I realize I",
    "was just chasing that feeling, not the actual thing.{% /quote %}",
    "",
    "Later, on craft:",
    "",
    "{% quote %}",
    "There's something about a hand-thrown mug — it has the maker's hand",
    "in it. A perfect machine mug feels dead to me.",
    "{% /quote %}",
    "```",
    "",
    "For purely functional content — \"add 'buy milk' to my todo list,\"",
    "\"remind me at 4pm,\" \"call Maria Friday\" — no quote tag is needed.",
    "Just act on the request.",
    "",
    "Edit only in service of authenticity. You can choose which spans",
    "to quote, trim a long passage to its core, split it across multiple",
    "tags, or move it between cards. But whatever appears inside a",
    "`{% quote %}` tag must be the user's exact words — no fixing grammar,",
    "filling in elisions, or paraphrasing inside the tag.",
    "",
    "Speech-input corrections — self-corrections (\"ketchup, no, catch up\"",
    "→ \"catch up\"), obvious mishears, dropped fillers — count as faithful",
    "transcription, not paraphrase. See `docs/generated/narration-mode.md`.",
    "",
  ];
}
