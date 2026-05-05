/**
 * Key cb commands — the everyday surface for working with cards.
 */

export function keyCommandsSection(): string[] {
  return [
    "## Key Commands",
    "",
    "Use `cb` for all card operations. See `docs/generated/cb-commands.md` for full reference.",
    "",
    "- `cb create <path>` — Create a card from template (auto-detects type from filename)",
    "- `cb mv <src> <dest>` — Move a card, updating all references",
    "- `cb rm <path>` — Soft-delete a card to `store/trash/`",
    "- `cb validate <path>` — Validate a card against its schema",
    "- `cb answer <path>` — Answer a pending question",
    "- `cb reactor` — Process all pending jobs in `box/jobs/`",
    "- `cb finalize` — Flush outbound cards in `box/output/` (push notifications, etc.)",
    "- `cb scenario list|run` — Run scenario tests against boxes",
    "- `cb finish <job-file>` — Complete a job (deletes the job card and commits)",
    "- `cb procedure run <name-or-path>` — Run a procedure (see `docs/generated/procedures.md`)",
    "- `cb calendar [timespan]` — View upcoming calendar events (default 7d; supports `today`, `3d`, `2w`, `1m`)",
    "- `cb chat self-note \"<body>\" [--ref <path>] [--commit <hash>]` — Post an agent-authored record into the live chat session. For use by scheduled sub-agents (daily rumination, weekly research) to leave a short summary of what they did, so the boxholder sees it on next chat revisit. Not a conversational message — Claude in chat knows not to reply. Requires `CB_BOX_NAME` and `CB_SERVER_URL` in env (set automatically by the scheduler).",
    "",
  ];
}
