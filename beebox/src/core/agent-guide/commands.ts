/**
 * Key bbx commands — the everyday `bbx` surface, grouped by how the agent
 * encounters each: commands to reach for, the job/procedure lifecycle, and
 * system-run commands the agent doesn't invoke. Card operations (create / mv /
 * rm) live in ABOUT_CARDS and are only pointed at from here.
 */

import { BOX_PACKAGE_DOCS } from "../docs-gen/shared.js";
import { SECTION, xref } from "./sections.js";

export function keyCommandsSection(): string {
  return `## Key Commands

Card operations — \`bbx create\` / \`bbx mv\` / \`bbx rm\` — live in ${xref(SECTION.ABOUT_CARDS)}.
This is the rest of the everyday \`bbx\` surface; the full reference is
\`${BOX_PACKAGE_DOCS}/bbx-commands.md\`.

**Reach for these:**

- When something feels off about Bee Box tooling — a confusing flag, unclear
  error, awkward workflow, or surprising behavior — use the \`agent-feedback\`
  skill. Record your observation and written context as a \`.doc.card\` in
  \`_config/feedback/\` and commit it with your task. A \`.feedback.card\`
  means the boxholder's response to something the box surfaced.
- \`bbx force-wakeup [--connector <name>]\` — runs a real wakeup on the server
  right now, either the whole cycle or just one connector, and reports what each
  connector created, updated, or skipped and why. Reach for it after mounting a
  Drive folder or changing connector configuration, and whenever the boxholder
  asks "did it sync?" — it is the only way to get that answer now rather than at
  the next scheduled cycle.
- \`bbx search "<query>"\` — full-text search over the box's cards; prefer it over
  \`grep\` for finding cards by content (details in the box-search section).
- \`bbx calendar [timespan]\` — upcoming calendar events (default 7d; also
  \`today\`, \`3d\`, \`2w\`, \`1m\`).
- \`bbx session\` — read a past session's transcript (chats, wakeups, job runs):
  \`--list\` to find recent sessions, \`--latest\` or \`<id>\` to view (\`--dialogue-only\` for just
  the conversation, \`--tool-report\` for tool usage, \`--since 2d\` for a
  window). To *search* a large transcript, spawn a subagent (Task tool) to
  read it and report back the relevant part instead of pulling the whole
  transcript into your own context.
- \`bbx procedure run <name-or-path>\` — run a procedure. Procedures are how
  one-shot structured work gets done (see \`${BOX_PACKAGE_DOCS}/procedures.md\`).
- \`bbx chat …\` — a family of commands for the live chat session:
  \`bbx chat self-note "<body>" [--ref <path>] [--commit <hash>]\` posts an
  agent-authored record a scheduled sub-agent leaves for the boxholder (not a
  conversational reply — chat knows not to answer it);
  \`bbx chat screenshot\` gets a real screenshot of what the user is looking at
  *right now* in the box UI (prints an image path to Read) — reach for it on
  visual/layout questions ("does this look right", debugging a custom view's
  appearance), as opposed to \`bbx chat whats-changed\` for *content* or just
  reading a card/view's source; it asks the user's browser, so it may come
  back declined or unavailable (the command's one-line output tells you
  which). Others include \`bbx chat whats-changed\` and \`bbx chat retranscribe\`.
  See the full reference.
  (This is the *live chat session* only — to leave yourself a note while
  processing a \`chat-thread\` card, put it in the \`text:\` of the \`kind: seen\`
  entry you append, not \`self-note\`.)

**Job / procedure lifecycle** (only while processing a job in a reactor or
procedure run):

- \`bbx finish <job-file>\` — the required closing step: deletes the job card and
  commits your work.

**System-run — you don't invoke these** (the wakeup cycle and scheduler do; they
appear here so you recognize them in \`git log\` and health output):

- \`bbx engine wakeup\` — the cycle itself (connectors, jobs, scripts, push). It
  lives under \`bbx engine\` because it only works with the server's credentials:
  run from your shell it would sync nothing and report that as "nothing new".
  \`bbx force-wakeup\` above is your way to trigger a real one.
- \`bbx reactor\` — process pending jobs in \`_bookkeeping/jobs/\`.
- \`bbx finalize\` — flush outbound cards in \`_bookkeeping/output/\`.

\`bbx health\` is not in that list — it is yours to run: scheduled-task health
(failing / overdue / blocked / inconclusive tasks + scheduler liveness).
\`inconclusive\` means the last run did its work but its check never reached a
verdict — unknown, not broken; do not redo the work on that basis.

Anything under \`bbx engine\` is an operator or machine command — starting
servers, editing the machine's box list, authorizing Google. You will not need
them, and several refuse an agent session outright. If you find yourself
reaching for one, that is a thing to ask the boxholder for.
`;
}
