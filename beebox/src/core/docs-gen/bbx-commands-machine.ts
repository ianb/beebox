/**
 * Machine-level command sections of the `bbx` command reference doc
 * (bbx-commands.md): `bbx secrets`. Moved from the agent guide's SECRETS
 * section, which keeps the rules and points here. Assembled by
 * generateBbxCommands().
 */

/** The `bbx secrets` section. */
export function bbxCommandsMachine(): string[] {
  return [
    "## bbx secrets",
    "",
    "The agent-facing `bbx secrets` verbs. Where credentials live, and why never in the box, is in the agent guide's SECRETS section.",
    "",
    "```",
    "bbx secrets declare <name> --note \"<what it is and where to get it>\" --use \"<why you need it>\"",
    "bbx secrets describe <name> --add-use \"<reason>\"",
    "bbx secrets status <box>",
    "```",
    "",
    "`bbx secrets status <this box>` shows what this box has and what it is still waiting on (your own box only — the machine's other boxes are the boxholder's business).",
    "",
    "- **Building something new on a key that is already granted?** Say so: `bbx secrets describe <name> --add-use \"the umbrella reminder trick\"`. Reasons are additive — one key usually serves several tricks — and this is the list the boxholder reads when deciding whether a key still earns its keep. You may add a reason; removing one is theirs.",
    "",
  ];
}
