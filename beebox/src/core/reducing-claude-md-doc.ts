/**
 * Generate the "reducing an oversized CLAUDE.md" reference doc for agents.
 *
 * Emitted into the package docs as reducing-claude-md.md (docs-gen/package-docs.ts).
 * The `claude-md-size` lint warning (src/core/claude-md-lint.ts) points here so
 * an agent that trips it has concrete strategies to fix it, not just "it's big."
 *
 * Content is synthesized from Anthropic's Claude Code best-practices guidance
 * (https://code.claude.com/docs/en/best-practices, "Write an effective
 * CLAUDE.md") and HumanLayer's "Writing a good CLAUDE.md"
 * (https://www.humanlayer.dev/blog/writing-a-good-claude-md), adapted to a
 * box's surfaces (nested CLAUDE.md, .claude/rules/ globs, skills, docs/).
 */

export function generateReducingClaudeMdDoc(): string {
  return `# Reducing an oversized CLAUDE.md

A box \`CLAUDE.md\` loads into the assistant's context on **every single turn**,
before it knows what the task is. Every line competes with the actual work for
attention. This is not just a memory cost: past a few thousand tokens, models
reliably start *dropping* instructions — so a bloated CLAUDE.md makes the agent
follow your rules *less*, not more. If the agent keeps ignoring a rule you wrote
down, the file being too long is a likely cause: the rule is getting lost in the
noise.

So the goal isn't a smaller file for its own sake — it's that the instructions
that survive actually get followed. Below are the strategies, roughly in the
order worth trying.

## The one test to apply to every line

> **"If I deleted this line, would the agent start making a mistake it doesn't
> make now?"**

If the answer is no, cut it. Most oversized CLAUDE.md files are mostly lines
that fail this test: things the agent already does correctly without being told,
restated conventions, reassurance, and explanation written for a human reader
who isn't there. CLAUDE.md is instructions for an agent, not documentation for a
person — it doesn't need an intro, a rationale for every rule, or a polished
narrative. State the rule and move on.

## Keep the strong rules strong

Not every rule is equal, and the file should show it. Most of a CLAUDE.md is
ordinary statements the agent follows without fuss. A few are *load-bearing*: the
agent's natural default is wrong, and getting it wrong is costly. Those must
stand out — and they only stand out if you protect their signal.

- **Emphasis is a budget, not decoration.** Every \`IMPORTANT\` / \`NEVER\` /
  \`MUST\` you spend devalues the rest. A file where ten rules shout has no
  loudest rule. Reserve the strong markers for the few you'd be genuinely upset
  to see violated; leave everything else a plain statement.
- **Concision *is* emphasis.** A load-bearing rule buried in 300 lines is weak no
  matter how it's formatted. The surest way to make your few critical rules
  unmissable is to cut the neutral bulk around them — every line you delete makes
  the survivors louder. Keeping the file tight and keeping the strong rules
  strong are the same move, not two.
- **Mark the rule, not the paragraph.** Emphasize the few words that carry the
  rule, not a whole block — a bolded paragraph is just noise with extra steps.
- **Order by importance.** The rule that matters most goes first in its section,
  not buried mid-list. Lead with what the agent must not get wrong.

## 1. Cut what the agent already knows or can see

The biggest wins are usually deletions, not relocations:

- **Self-evident practices.** "Write clean code", "be careful", "use good
  names" — the agent does this already. Delete.
- **Things discoverable from the box itself.** If a fact is visible by reading a
  card, a schema, or a directory, the agent will find it when relevant. You don't
  need to mirror it into context every turn.
- **Task-specific detail that isn't universal.** CLAUDE.md is loaded for *every*
  turn, so it should hold only what applies broadly. Knowledge that matters only
  while doing one kind of task (a specific procedure, one card type, a seasonal
  workflow) belongs on a lazier surface (see strategy 4), not in the always-on
  file.

## 2. Consolidate duplication and overlap

Re-read the whole file looking for the same instruction stated in two places, or
two rules that are really one. Oversized files accumulate near-duplicates as
they're edited over time — a rule added at the top in one session and again in a
section months later. Merge them into a single, sharper statement. One clear
rule is followed more reliably than the same idea scattered across three
paragraphs.

## 3. Tighten the language that remains

Once the content is right, the wording is usually still 2–3× longer than it
needs to be. Compress aggressively:

- Drop hedges, throat-clearing, and meta-commentary ("It's worth noting that…",
  "Generally you should try to…"). Say the thing.
- Prefer a terse rule over a paragraph explaining the rule. The agent doesn't
  need the *why* for most rules — and if it does, one short clause beats a
  paragraph.
- Use lists and short lines over prose. A bullet is scanned; a paragraph is
  waded through.
- Reserve emphasis for the few rules that genuinely need it (see "Keep the
  strong rules strong" above) — if everything is emphasized, nothing is.

## 4. Move separable detail onto a lazier surface

Anything that's only *sometimes* relevant should live where the agent loads it
*on demand* — not in the always-on file. Replace the moved section with a
one-line pointer that says where it went and what's there, so the agent knows to
read it when the topic comes up. This is "progressive disclosure": tell the
agent how to find the detail, instead of pre-loading all of it.

Where to move things, from lightest to heaviest:

- **A sibling doc in the same directory.** For a big self-contained block — a
  debugging runbook, a setup procedure, a deep explanation — move it to a
  \`SOMETHING.md\` next to the CLAUDE.md (e.g. \`DEBUG_PROCESS.md\`) and leave a
  pointer: \`For the debugging runbook, see DEBUG_PROCESS.md.\` Describe what's in
  it in the pointer so the agent can decide whether to open it.
- **A nested \`CLAUDE.md\`.** Detail that only matters when working inside a
  subdirectory goes in a \`CLAUDE.md\` there. The agent pulls it in only when it
  touches that directory.
- **A \`.claude/rules/\` glob.** Rules that apply to a specific file type or path
  pattern can live in \`.claude/rules/\` and attach only when matching files are in
  play.
- **A skill.** A whole repeatable workflow (multi-step, with its own context)
  is better as a skill the agent invokes when needed than as standing prose.

## 5. Let an example carry the documentation

Often the clearest way to specify something *is* a small concrete example, and
the example replaces the prose that would otherwise describe it. Instead of three
sentences describing the shape of a card, a naming convention, or a command's
output, show one correct instance and let it speak. A single well-chosen example
is shorter than its description and less ambiguous — the agent pattern-matches off
it. (Where the example is real and lives in the box, point at it by path rather
than pasting a copy that will drift out of date.)

## 6. Prefer pointers to copies

Don't paste content that lives somewhere else and changes on its own — command
output, file contents, a schema, a list that grows. It goes stale, and stale
instructions are worse than none. Point to the source ("run \`bbx …\`",
"see <path>") so the agent reads the current version when it needs it.

## After trimming

Re-run \`bbx validate\` (or just save the file — the validation hook re-checks it)
to confirm the warning clears. Treat CLAUDE.md like code you maintain: prune it
whenever you notice the agent ignoring a rule, not only when the linter nags.
`;
}
