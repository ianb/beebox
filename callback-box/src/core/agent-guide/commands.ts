/**
 * Key cb commands — the everyday surface for working with cards.
 */

export function keyCommandsSection(): string[] {
  return [
    "## Key Commands",
    "",
    "Use `cb` for all card operations. See `docs/generated/cb-commands.md`.",
    "",
    "- `cb create <path>` — Create a card from template (auto-detects type from filename)",
    "- `cb mv <src> <dest>` — Move a card, updating all references",
    "- `cb rm <path>` — Soft-delete a card to `store/trash/`",
    "- `cb validate <path>` — Validate a card against its schema",
    "- `cb answer <path>` — Answer a pending question",
    "- `cb reactor` — Process all pending jobs in `box/jobs/`",
    "- `cb finalize` — Flush outbound cards in `box/output/` (telegram messages, etc.)",
    "- `cb health` — Scheduled-task health: failing/overdue/blocked tasks + scheduler liveness (exit 1 when unhealthy)",
    "- `cb scenario list|run` — Run scenario tests against boxes",
    "- `cb finish <job-file>` — Complete a job (deletes the job card and commits)",
    "- `cb procedure run <name-or-path>` — Run a procedure (see `docs/generated/procedures.md`)",
    "- `cb calendar [timespan]` — View upcoming calendar events (default 7d; supports `today`, `3d`, `2w`, `1m`)",
    "- `cb chat self-note \"<body>\" [--ref <path>] [--commit <hash>]` — Post an agent-authored record into the live chat session. For use by scheduled sub-agents (daily rumination, weekly research) to leave a short summary of what they did, so the boxholder sees it on next chat revisit. Not a conversational message — Claude in chat knows not to reply. Requires `CB_BOX_NAME` and `CB_SERVER_URL` in env (set automatically by the scheduler).",
    "- `cb chat get-last-audio [--out <path>]` — Fetch the original audio recording of the user's most recent voice message from the connected chat browser tab. Writes the audio to a temp file (or `--out`) and prints the path, then `recorded-at:` and `text:` lines identifying the message. Fails when the last message was typed, the recording predates the tab's last reload, or no chat tab is open. Requires `CB_BOX_NAME` and `CB_SERVER_URL` in env.",
    "- `cb feedback \"<message>\"` — Record an observation about CLI friction, confusing options, odd file placements, or unclear conventions. Silent: writes a file to `config/feedback/` and commits it without interrupting the current task. Use this any time something feels off about the tooling — confusing flag names, unclear error messages, awkward workflows, surprising behavior. Good feedback is specific and describes what was confusing and why.",
    "",
  ];
}
