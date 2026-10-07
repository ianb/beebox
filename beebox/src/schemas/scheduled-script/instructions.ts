import { section } from "../../core/agent-guide/sections.js";

/**
 * The `instructions` prose for scheduled-script cards (agent-facing prompt
 * surface). Split out of scheduled-script.tsx to keep that file under the
 * line limit.
 */

export const SCHEDULED_SCRIPT_INSTRUCTIONS = `# Scheduled Script Cards

Scheduled scripts define a command to run, or a notification to send, on a schedule. They live in \`_config/schedules/\`.

## Schedule Types (mutually exclusive)
- **cron**: Standard cron expression (e.g., \`0 6 * * *\` for 6am daily)
- **at**: ISO datetime for a one-shot future execution
- **rrule**: iCalendar RRULE for complex recurrence patterns

## Frontmatter Fields
- **not-before**: Minimum time since last run. Prevents running more often than this interval even if the schedule says otherwise. Use duration strings: \`5m\`, \`1h\`, \`4h\`, \`1d\`.
- **on-wakeup**: If \`true\`, also run opportunistically during \`bbx wakeup\`, subject to not-before.
- **once**: If \`true\`, the card is deleted after successful execution.
- **until**: ISO datetime after which this schedule expires.
- **enabled**: Set to \`false\` to disable without deleting. This is per-box state, not part of the shipped definition — a disabled schedule still receives upstream definition updates (new cron/runs/description) while staying disabled.
- **budget**: Max cumulative runtime within a window. Format: \`"LIMIT/WINDOW"\` (e.g., \`"10m/5h"\` = max 10 minutes of runtime in any 5-hour window). Scripts exceeding their budget are skipped until the window clears.
- **lock-group**: Named concurrency group. Scripts sharing a lock-group won't run concurrently — if one is already running, others in the same group are skipped.
- **timeout**: Max runtime for a single run, as a duration string (e.g. \`25m\`). Counts only awake time (machine sleep doesn't eat the budget). Default: \`10m\`. The run is killed when it exceeds this.
- **runs**: The command to execute. Runs with cwd set to box root. A card has exactly one of \`runs\` and \`notify\`.
- **notify**: Send the boxholder a notification instead of running a command: \`{title, body?, loudness?, target?, context?}\`. No agent and no shell run; the tick sends it. \`loudness\` is \`dot\`, \`quiet\`, or \`loud\` (default \`loud\` with \`requested-by: boxholder\`, else \`quiet\`). \`target\` is where a tap lands (default \`chat:new\`). \`context\` is a card path added to the body as a last line \`Context: <path>\`.
- **requested-by**: \`boxholder\` when the boxholder asked for this schedule (a reminder asked for in chat). Leave it out for schedules the box set up itself.
- **Schedule memory** (\`runs\` only): each run's environment has \`BBX_SINCE_COMMIT\` (the box HEAD at this schedule's previous run; the first run sees no changes), \`BBX_SINCE_TIME\` (the previous run's time, empty on the first run), \`BBX_CARRY_IN\` (the value the previous run left), \`BBX_CARRY_OUT\` (a file path: write up to 4 KB there to pass to the next run; leave it empty to keep the previous value), and \`BBX_SUMMARY_FILE\` (where \`bbx run-summary\` writes; see Run summaries). \`bbx changes\` lists the cards changed since \`BBX_SINCE_COMMIT\`.
- **description**: Human-readable summary of what this schedule does.
- **reason**: Why this schedule exists. Either a plain string, or \`{text?, ref?}\` to link to a related card.
- **create-after-success**: Optional array of \`{path, args?}\` entries. Create a card at \`path\` after successful execution; \`args\` are template arguments. Skipped if the target file already exists.
- **requires**: Optional \`{connectors: [name, ...]}\`. The schedule won't run if any required connector isn't configured for this box.

## Guidelines
- Set reasonable not-before values to prevent hammering external services.
- Use on-wakeup for things that should happen whenever the agent is active.
- For one-shot future tasks, combine \`at\` with \`once: true\`.

## Example: a reminder

A reminder is a scheduled-script card with \`at\`, \`once: true\`, and \`notify:\`:

\`\`\`yaml
# _config/schedules/remind-pepper-vet.scheduled-script.card
at: 2026-10-02T08:30
once: true
requested-by: boxholder
reason: Asked for in chat on 2026-09-26
notify:
  title: Call the vet about Pepper's shots
  loudness: loud
  target: chat:new
  context: _content/pets/pepper-shots.todo.card
\`\`\`

The scheduler sends it at that time and then deletes the card. Tapping it opens a new chat with the reminder and its context.

## Run summaries: say what the run did
The boxholder sees each run's summary in the dashboard's run history; a run with none shows only how it ended. A \`runs:\` command ends with \`bbx run-summary "<one-line headline>" --body "<short Markdown>"\`, written by the task about its own work (what it changed, what it skipped and why). \`--priority attention\` marks a run the boxholder should look at (failed items, a decision, something unusual), and the dashboard shows its headline without a click; leave routine runs \`normal\`. \`--notes\` holds longer detail, shown collapsed. Limits: headline 120 characters, body 1 KB, notes 4 KB. The command writes to \`$BBX_SUMMARY_FILE\`, which the scheduler sets and \`bbx procedure run\` passes on, and its agent steps are told to end with it. A later call in the same run replaces an earlier one. A summary is not a notification: when the boxholder must hear about it now, use \`bbx notify\`.

## Deferring: run until it fires
A \`runs:\` command that finds nothing to do exits 75 after writing its reason to \`$BBX_DEFER_FILE\`; \`bbx changes --or-skip\` and \`bbx judge --or-skip\` do both. The run records \`deferred\` (\`bbx health\` shows \`waiting: <reason>\`), which is neither a failure nor a success, so \`once: true\` deletes the card only after the run that got through. Exit 75 without the file is a failure. \`bbx procedure run\` exits 75 the same way when every precheck skipped. After \`no-change\` or \`no-pass\` the next run's \`BBX_SINCE_COMMIT\` moves on; after a failure, \`budget\`, \`jev-unavailable\`, or \`unconfigured\` it stays, so the same items are seen again.

## Example: a watch whose notification text is fixed

No agent: the judge gates a fixed notification.

\`\`\`yaml
# _config/schedules/watch-contractor-quote.scheduled-script.card
cron: "0 */2 * * *"
once: true
until: 2026-10-31
requested-by: boxholder
requires: { connectors: [google-drive] }
runs: >
  bbx changes --match 'drive/Quotes/**' --kind any --cat --all --or-skip
  | bbx judge _config/judgments/contractor-quote.judgment.card --min quote=0.8 --or-skip
  && bbx notify --loudness loud --target chat:new "The contractor's quote is in"
\`\`\`

\`--cat --all\` gives the judge every matching card whenever anything changed. When the notification needs wording from what was found, \`runs:\` is \`bbx procedure run <name>\` and an agent step writes it; the ${section("REACHING_THE_BOXHOLDER")} section of the agent guide has that example, and the judgment card instructions say how to write the judgment.

## Testing a schedule
- \`bbx notify --dry-run\` prints what a notification would do (the audience per channel, the presence reading, the channels tried) and sends nothing; with no \`--target\` it previews \`chat:new\`.
- \`BBX_NOTIFY_FAKE=1\` sends every notification through fake channels and logs \`sent (fake)\`.
- \`BBX_JEV_FAKE=1\` (or \`=0\`) makes \`bbx judge\` answer yes (or no) with no key; \`bbx judge --dry-run\` and \`--replay <file>\` test the judgment itself.
- \`bbx changes --since <commit>\` runs the change list outside a schedule.`;
