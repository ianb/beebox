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

- \`bbx feedback "<message>"\` — record anything that feels off about the tooling:
  a confusing flag, an unclear error message, an awkward workflow, a surprising
  behavior. It's **silent** — writes a file to \`_config/feedback/\` and commits it
  without interrupting your task — so reach for it reflexively the moment
  something is off. Good feedback is specific about *what* was confusing and
  *why*.
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

- \`bbx reactor\` — process pending jobs in \`_bookkeeping/jobs/\`.
- \`bbx finalize\` — flush outbound cards in \`_bookkeeping/output/\`.
- \`bbx health\` — scheduled-task health (failing / overdue / blocked /
  inconclusive tasks + scheduler liveness). \`inconclusive\` means the last run
  did its work but its check never reached a verdict — unknown, not broken; do
  not redo the work on that basis.
`;
}
