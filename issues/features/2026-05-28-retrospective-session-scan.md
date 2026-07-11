---
title: "retrospective session scan"
needs: [design]
area: monorepo
---

Closely related to the doc-usage miner: instead of mining transcripts for *what was read*, mine them for *what the user had to correct, what Claude had to ask, what kept going wrong*. The current setup is reactive — `CLAUDE.md` says "when you get corrected, update CLAUDE.md," but that depends on the agent noticing in the moment and on the user remembering to push back. A weekly retrospective sweep would catch the patterns that slip through.

Signal sources in JSONL:

- **User corrections** — "no", "don't", "actually", "wrong", "stop". Many are one-off conversational noise; the same correction appearing across three sessions is a real gap.
- **Repeated tool errors** — same `bash` command fails the same way across sessions → either a missing convention to document or a broken tool to fix (not document around).
- **Clarifying questions Claude asks** — when the agent has to ask "which X?" repeatedly, the answer belongs in a doc. Strong signal because the agent itself is reporting the gap.
- **Long read-cascades for simple questions** — Claude reads 7 files to answer "where does X live?" → missing index entry.
- **Mid-task pivots / apologies** — "ah, it's actually structured differently" → the structure was non-obvious, deserves a one-liner.

Existing overlap: the `fewer-permission-prompts` skill already does the permissions slice (mines repeated Bash/MCP calls and proposes allowlist entries). This would be the docs-and-conventions slice.

The hard part is signal-to-noise. Regex on "no" is useless. Better approach: per session, feed the last ~30 turns to a small classifier prompt — "did the user correct or teach Claude something not in CLAUDE.md? Return a list, or 'nothing'." Cheap, high-signal, and the candidate list goes into a weekly digest the boxholder skims. Not an auto-applier — humans review and accept, like dependabot PRs for documentation. The Claude Code auto-memory system does something analogous for personal preferences across all projects; this'd be the project-scoped equivalent writing to `CLAUDE.md` / `.claude/rules/`.

Open questions:
- **Cost vs. value.** Per-session LLM cost vs. how often the digest actually contains something actionable. Mitigated by running only on sessions over some length and only on new sessions since last run.
- **Where the digest goes.** A markdown file the user reviews? An auto-opened PR with proposed edits? A new card type in the boxholder's own box ("agent learnings")?
- **Coupling with doc-usage data.** A retrospective that says "Claude kept reading docs/X.md without finding the answer" is more actionable than either signal alone — the two miners probably want to share a session-walker.
