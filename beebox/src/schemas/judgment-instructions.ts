/**
 * The `instructions` prose for judgment cards (agent-facing prompt surface).
 * The writing guidance comes from a trial against two real boxes (2026-09-26);
 * see docs/implemented-plans/notifications.md (Track D and Track F).
 */

export const JUDGMENT_INSTRUCTIONS = `# Judgment Cards

A judgment card is a prompt for Jev, a small, cheap judging model. \`bbx judge <card>\` sends the card plus one state from stdin and prints an answer per question. The card holds no state: the state arrives at run time. By convention judgment cards live in \`_config/judgments/\`.

## Fields
- **questions**: named questions, each \`{type, instructions?, criteria}\`. The \`type\` decides the \`criteria\` shape:
  - \`noul\` (yes/no, answered as a probability): \`{true: <what yes means>, false: <what no means>}\`.
  - \`choice\` (one of several): a map of option name to description, at least two options.
  - \`score\` (an ordered scale): a list of level descriptions, lowest first, at least two. Levels are numbered from 0.
- **situation**: optional \`{ref: <card path>}\` whose text tells Jev whose box this is. Without it, \`bbx judge\` uses the purpose statement of the root briefing (\`_content/briefing.briefing.card\`).
- **model**: optional Jev model id; leave it out to use the pinned default.
- **Body**: the instructions every question gets, after the situation. Say what the state is.

## Writing a judgment
- One question per thing decided.
- Say what the state is, and name what does NOT count. With loose criteria a quarterly statement scored 54% as a renewal notice; with explicit negatives, 12%.
- The state must carry the body. A subject and a snippet alone put every answer near 50%, which reads as uncertainty, not as no. Include identity fields (\`to:\`, \`from:\`) in email state. \`bbx judge\` warns when a state is under 300 characters.
- Code computes numbers and dates before the call. Raw due dates gave 79% and the wrong bill; precomputed days gave 93% and the right one.
- Prefer a Choice with a counter-category and a "cannot tell" option over a bare yes/no. Per item, {expects a reply, needs none, cannot tell} was right on every email at 90%+ where a yes/no batch gave 55%, and "cannot tell" shows the thin-state case that a yes/no hides as 50%.
- Batch only when the whole says something the items do not ("is anything here worth an agent's look?"): a salient condition scores 90%+ and a negative control near 10%, but a subtle condition among many items muddles toward 50%. Ask a crisp gate question and let an agent read. Judge per item (\`--per-line\`) when each item is its own question.
- A Choice over the items ("which email is it?") is a pointer for an agent, not a decision.
- Score is fooled by dates in marketing text, and needs negatives too.
- Give Jev the situation: knowing whose box it is lets it apply rules like "the recipient's own messages are not requests of him".

## Example: one gate question over everything new (noul)

\`\`\`yaml
# _config/judgments/field-trip.judgment.card
questions:
  trip:
    type: noul
    criteria:
      true: "At least one of these emails is from the school about the spring field trip: dates, permission form, or payment."
      false: "None is; a newsletter that mentions the school, or a receipt, does not count."
---
You are looking at the email cards that arrived in a family inbox since
the last check, concatenated. Judge only what the emails say.
\`\`\`

Run from a procedure precheck with \`pass-output: true\`, so an agent writes the notification only when the judge says yes:

\`\`\`sh
bbx changes --match '_content/inbox/**/*.email-message.card' --cat --or-skip \\
  | bbx judge _config/judgments/field-trip.judgment.card --min trip=0.8 --or-skip --echo
\`\`\`

## Example: a Choice with a counter-category, per item

\`\`\`yaml
# _config/judgments/needs-reply.judgment.card
questions:
  reply:
    type: choice
    instructions: Decide from the whole email, including who sent it and to whom.
    criteria:
      expects: "The sender asks the recipient a question or for an action, and is waiting on an answer."
      none: "Nothing is asked of the recipient: a notice, a receipt, a newsletter, or the recipient's own message."
      unclear: "Cannot tell from what is here; the text is cut off or too short."
---
The state is one email card: frontmatter (from, to, subject, date) and body.
\`\`\`

\`\`\`sh
bbx changes --match '_content/inbox/**/*.email-message.card' --or-skip \\
  | bbx judge _config/judgments/needs-reply.judgment.card --per-line --cards --min reply.expects=0.8 --select --or-skip
\`\`\`

## \`bbx judge\`
- State: all of stdin is one state; \`--per-line\` makes each line a state; \`--cards\` reads each line as a card path (body capped at 4,000 characters, then an email's \`body-file\` text, capped the same). A \`--cards\` batch over \`--max-batch\` (default 20) items is refused: use \`--per-line\`. \`--replay <file>\` reads the state from a file.
- Output: one JSON line per state, \`{input, answers}\`. \`--select\` prints only the inputs that passed; \`--echo\` prints stdin unchanged when anything passed.
- Decision: \`--min name=p\` (a noul's probability, or \`name.option=p\` for a choice or score option), \`--choice name=option\`, and \`--decide '{"name": {"min": p, "max": p, "is": option}}'\`, all combined with AND. With no condition every state passes.
- \`--or-skip\`: when nothing passed, write the reason \`no-pass\` to \`$BBX_DEFER_FILE\` and exit 75, so a schedule records \`deferred\` and \`once\` does not fire.
- Exit 75 also when the box has no OpenRouter key (\`unconfigured\`), Jev fails (\`jev-unavailable\`), or the box used its daily Jev budget (\`budget\`); those keep the schedule's change cursor, so the items are seen again next run.
- Every call is logged to \`.beebox/jev-debug.log\`.

## Testing a judgment
- \`--dry-run\` prints which situation was used and the exact request, and sends nothing.
- \`--replay <file>\` runs the card against a saved state, for tuning against a kept example.
- \`BBX_JEV_FAKE=1\` answers every question with a fixed confident yes (noul 1, the first choice option, the top score level) and \`BBX_JEV_FAKE=0\` with a confident no (noul 0, the last option, the lowest level); it needs no key, and its calls count toward the budget and the log like real ones.`;
