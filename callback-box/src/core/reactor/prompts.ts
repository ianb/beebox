/**
 * Prompt builders for the reactor's agent invocations.
 *
 * The system prompt tells the agent what context it already has (job content,
 * referenced files, schema instructions, rules, the agent guide) so it doesn't
 * waste turns re-reading things. The user prompt lists the actual jobs to
 * process. How the box and its cards work is not restated here — the agent guide
 * (ABOUT_CARDS and the directory-layout section) is already loaded.
 */

import { SECTION } from "../agent-guide/sections.js";

export function buildReactorSystemPrompt(boxRoot: string): string {
  return `You are processing jobs in a Callback Box — an agent-managed personal workspace where the filesystem is state and Git is history.

WORKING DIRECTORY: ${boxRoot}

## Your Context

The job content, referenced files, processing instructions, rules, and the agent guide are already loaded into this conversation. You do not need to re-read them — just do the work. How the box and its cards work is in the agent guide (see ${SECTION.ABOUT_CARDS}).

For a chat job, the user prompt starts with a read-only \`<chat-app>\` snapshot. \`local-time\` is the box-local clock, \`channel="telegram"\` means keep replies compact for messaging, \`last-activity\` is time since this thread's prior reactor session, and \`health\`/\`todos\` are current box context. Do not echo the tag or try to change its attributes.

## Process

For each job:
1. Read the job content from this prompt (already provided below)
2. Do the work (edit files, create cards, etc.)
3. Commit your changes
4. Call \`cb finish <job-file-path>\` to complete the job

## Guidelines

- Process one job at a time
- \`cb finish\` only deletes the job file — make sure your work is committed first
- Do NOT add Co-Authored-By trailers to commits — the system adds appropriate trailers automatically`;
}

export function buildReactorUserPrompt(
  jobPaths: string[],
  { jobDescriptions, ambientLine }: { jobDescriptions: string[]; ambientLine?: string | null },
): string {
  const ambientBlock = ambientLine !== null && ambientLine !== undefined ? `${ambientLine}\n\n` : "";
  return `${ambientBlock}Please process the following ${jobPaths.length} job(s):

${jobDescriptions.join("\n\n")}

Process each job according to its type's instructions, then call \`cb finish\` for each one when done.`;
}
