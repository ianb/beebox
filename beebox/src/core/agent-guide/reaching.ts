/**
 * Reaching the boxholder: the mechanics of notifying, reminding, and watching
 * (`bbx notify`, `notify:` schedule cards, schedule memory, `bbx changes`,
 * `bbx judge`). The policy of when and how loud is the root briefing's
 * "Reaching me" section; a box whose briefing predates that section gets the
 * default text here. See docs/notifications.md.
 */

import { REACHING_ME_DEFAULT, REACHING_ME_HEADING } from "../../schemas/briefing.js";
import { SECTION } from "./sections.js";

/** The default briefing section as a blockquote, so its heading does not split this section. */
const quotedDefault = REACHING_ME_DEFAULT.split("\n")
  .map((line) => (line === "" ? ">" : `> ${line === REACHING_ME_HEADING ? "**Reaching me.**" : line}`))
  .join("\n");

export function reachingSection(): string {
  return `## ${SECTION.REACHING_THE_BOXHOLDER}

The root briefing's "Reaching me" section owns when and how loud. When the root briefing has none, apply this default, and propose adding the section, in the boxholder's words, at the next retro:

${quotedDefault}

Before you promise a reminder or a watch, run \`bbx notify --check\`. If nothing can reach the person, say so instead of promising.

**Now: \`bbx notify\`.** \`--loudness\` is \`dot\` (badge only), \`quiet\` (muted; held back while they are in the app), or \`loud\` (sound). \`--target\` is where a tap lands: \`chat:<sessionId>\`, \`chat:new\`, \`card:<path>\`, \`question:<path>\`, \`dashboard\`. \`--tag <key>\` makes a later notification replace this one. A failure the person must fix, after they left the chat it came from:

\`\`\`sh
bbx notify "I couldn't read the receipt you photographed" --loudness quiet \\
  --target chat:<that sessionId> --body "The total is cut off. Can you retake it?"
\`\`\`

In a chat turn, \`<callout loudness="quiet">\` does this for the turn's outcome. Do not notify about health (a failing sync, expired auth): the dashboard shows it, and the scheduler itself sends a loud notice when it blocks a schedule the person asked for.

**At a time: a schedule card with \`notify:\`.** Not \`<schedule>\`, which only returns to one chat within hours, and not a \`runs:\` that shells out to \`bbx notify\`. No agent runs; the scheduler sends it and deletes the card:

\`\`\`yaml
# _config/schedules/remind-vet.scheduled-script.card
at: 2026-10-06T09:00
once: true
requested-by: boxholder   # they asked; a blocked run then tells them
notify: { title: Call the vet about Pepper's shots, loudness: loud }
\`\`\`

**When something happens: a schedule that checks what changed, then judges, then runs an agent.** Each \`runs:\` sees \`BBX_SINCE_COMMIT\` (the box HEAD at this schedule's last run) and \`BBX_CARRY_IN\` / \`BBX_CARRY_OUT\` (one value, up to 4 KB, passed to the next run: what you already told them). \`bbx changes --match <glob> --cat --or-skip\` prints the cards changed since then. \`bbx judge <judgment card> --min <q>=<p> --or-skip --echo\` asks Jev, a small cheap model, the card's questions about stdin. Check what changed before you judge, and judge before you run an agent: \`--or-skip\` exits 75 and the run records \`deferred\`, so a quiet day costs nothing and \`once: true\` deletes the card only after the run that got through. "Tell me when the school emails about the field trip":

\`\`\`yaml
# _config/schedules/watch-field-trip.scheduled-script.card
on-wakeup: true
once: true
until: 2026-11-01
requested-by: boxholder
requires: { connectors: [gmail] }
runs: bbx procedure run watch-field-trip
\`\`\`
\`\`\`yaml
# _config/procedures/watch-field-trip.procedure.card
name: watch-field-trip
steps:
  - id: look
    precheck:
      pass-output: true
      shells:
        - |
          bbx changes --match '_content/inbox/**/*.email.card' --cat --or-skip \\
            | bbx judge _config/judgments/field-trip.judgment.card --min trip=0.8 --or-skip --echo
    run:
      agents:
        - prompt: Find the email about the trip below and tell the boxholder what matters, with bbx notify --loudness loud --target card:<its path>. If none is really about it, do nothing.
\`\`\`

The judgment card (\`_config/judgments/field-trip.judgment.card\`) is the prompt: one crisp question per decision, criteria that name what does NOT count, and state that carries the full text. When the notification text is fixed, skip the agent: \`runs:\` is \`bbx changes … | bbx judge … && bbx notify …\`. The scheduled-script and judgment card instructions have the full examples and how to test them.`;
}
