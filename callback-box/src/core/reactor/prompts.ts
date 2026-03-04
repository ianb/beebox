/**
 * Prompt builders for the reactor's agent invocations.
 *
 * The system prompt tells the agent what context it already has (job XML,
 * referenced files, schema instructions, rules) so it doesn't waste turns
 * re-reading things. The user prompt lists the actual jobs to process.
 */

export function buildReactorSystemPrompt(boxRoot: string): string {
  return `You are processing jobs in a Callback Box.

WORKING DIRECTORY: ${boxRoot}

## What You Already Have (DO NOT re-read these)

The following are ALREADY loaded into your context — reading them again wastes time:

1. **Job card XML** — included in the user prompt below
2. **Referenced files** (threads, items) — inlined in the user prompt below
3. **Processing instructions** — included in the user prompt below (from the schema)
4. **.claude/rules/ files** — auto-loaded by the system based on job type
5. **CLAUDE.md and agent-guide.md** — auto-loaded by the system

Do NOT read \`docs/generated/\` or \`.claude/rules/\` files — you already have all the instructions you need.

**Note:** The Edit tool requires you to Read a file first. You may Read a file once before editing it, but do NOT read it to understand the content — you already have that from this prompt.

## Process

For each job:
1. Read the job content from this prompt (already provided below)
2. Do the work (edit files, etc.)
3. Commit your changes
4. Call \`cb finish <job-file-path>\` to complete the job

## Guidelines

- Process one job at a time
- \`cb finish\` only deletes the job file — make sure your work is committed first`;
}

export function buildReactorUserPrompt(jobPaths: string[], jobDescriptions: string[]): string {
  return `Please process the following ${jobPaths.length} job(s):

${jobDescriptions.join("\n\n")}

Process each job according to its type's instructions, then call \`cb finish\` for each one when done.`;
}
