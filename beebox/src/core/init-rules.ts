/**
 * Generate `.claude/rules/` files from card schemas and connector-specific
 * file rules. Each card type with `instructions` gets a rule file that
 * auto-loads when an agent reads or edits a matching card file. Connector
 * rules cover non-card files (e.g. `.ics`).
 *
 * Called from `syncTemplatesFromSource` (inside `generateDocs`). Not a
 * standalone CLI command — `bbx init` or `bbx docs refresh` regenerates a box's
 * rules.
 */

import { join } from "node:path";
import { mkdir, writeFile, readdir, unlink } from "node:fs/promises";
import { cardSchemas, loadBoxSchemas } from "../schemas/registry.js";
import { getBoxShape } from "../lib/box-shape.js";
import { errnoCode } from "../lib/error-guards.js";

export interface ConnectorRule {
  /** Rule filename without .md extension, e.g. "connector-calendar" */
  name: string;
  /** Glob patterns for paths: frontmatter */
  paths: string[];
  /** Instructions content */
  instructions: string;
}

/**
 * Static connector rules for non-card file types.
 */
export const connectorRules: ConnectorRule[] = [
  {
    name: "connector-calendar",
    paths: ["_content/calendar/**/*.ics"],
    instructions: `# Calendar Event Files (.ics)

These are Google Calendar events synced via \`bbx wakeup\`. Each file is a single VEVENT in iCalendar format.

## Key properties

Standard iCalendar: SUMMARY, DESCRIPTION, LOCATION, DTSTART, DTEND, STATUS, TRANSP (OPAQUE=busy, TRANSPARENT=free).

Custom properties track the source calendar:
- \`X-BBX-CALENDAR-ID\` — the Google Calendar ID this event belongs to
- \`X-BBX-CALENDAR-NAME\` — display name of the calendar
- \`X-BBX-CALENDAR-ROLE\` — access role: \`owner\`, \`writer\`, or \`reader\`

## Editability

- **owner/writer calendars**: You can edit the event fields (summary, description, location, times, transparency). Modified .ics files are pushed back to Google Calendar on the next \`bbx wakeup\`.
- **reader calendars**: These are subscribed/read-only calendars (e.g. school calendars). Do NOT edit these files — changes cannot be synced back.
- **Events organized by others on your own calendar**: You can generally only change your own attendee response (PARTSTAT), not the event details.

## Filename format

\`{YYYY-MM-DD}_{shortId}.ics\` — the date is the event start date, shortId is derived from the Google event ID.

## Querying

Use \`bbx calendar today\`, \`bbx calendar upcoming\`, or \`bbx calendar <timespan>\` (e.g. \`bbx calendar 2w\`) to query events from the CLI. These read from the local .ics files — no API calls needed.`,
  },
];

/**
 * Generate rules files from schema instructions and connector rules.
 *
 * `.claude/` lives at the box root — see "Where Claude Code runs" in
 * `docs/implemented-plans/boxes-as-packages-v2.md`.
 *
 * Called by `syncTemplatesFromSource`, inside `generateDocs`.
 */
export async function generateRules(boxRoot: string): Promise<string[]> {
  const shape = await getBoxShape(boxRoot);
  const rulesDir = join(shape.boxRoot, ".claude", "rules");
  await mkdir(rulesDir, { recursive: true });

  // Clean up old generated rules (card-* and connector-*)
  try {
    const existing = await readdir(rulesDir);
    for (const file of existing) {
      if (
        (file.startsWith("card-") || file.startsWith("connector-")) &&
        file.endsWith(".md")
      ) {
        await unlink(join(rulesDir, file));
      }
    }
  } catch (e) {
    // Directory may not exist yet, that's fine — nothing to clean up.
    if (errnoCode(e) !== "ENOENT") {
      console.debug("Skipping old-rule cleanup (rules dir not readable):", e);
    }
  }

  const generated: string[] = [];

  // Load box-local schemas alongside built-in ones. Each card type (built-in
  // or box-local) gets a path-conditional rule keyed off its filename glob so
  // the agent loads the right instructions when it reads or edits a matching
  // `.<type>.card` file.
  const boxSchemas = await loadBoxSchemas(boxRoot);
  const cardRuleSources: Array<{ name: string; instructions: string | undefined }> = [
    ...cardSchemas.map((s) => ({ name: s.type, instructions: s.instructions })),
    ...boxSchemas.cardSchemas.map((s) => ({ name: s.type, instructions: s.instructions })),
  ];

  for (const { name, instructions } of cardRuleSources) {
    if (instructions === undefined) continue;

    const glob = `**/*.${name}.card`;
    const filename = `card-${name}.md`;
    const content = `---
paths:
  - "${glob}"
---

${instructions.trim()}
`;

    await writeFile(join(rulesDir, filename), content);
    generated.push(filename);
  }

  // Connector rules for non-card files. Their paths are box-root anchored
  // (not `**/`-prefixed).
  for (const rule of connectorRules) {
    const filename = `${rule.name}.md`;
    const pathsYaml = rule.paths.map((p) => `  - "${p}"`).join("\n");
    const content = `---
paths:
${pathsYaml}
---

${rule.instructions.trim()}
`;

    await writeFile(join(rulesDir, filename), content);
    generated.push(filename);
  }

  return generated;
}
