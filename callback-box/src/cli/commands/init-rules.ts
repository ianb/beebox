/**
 * cb init-rules - Generate .claude/rules/ files from card schemas
 * and connector-specific file rules.
 *
 * Each card type with instructions gets a rule file that auto-loads
 * when an agent reads or edits a matching card file.
 *
 * Connector rules provide instructions for non-card files (e.g. .ics).
 */

import { Command } from "commander";
import { resolve, join } from "node:path";
import { mkdir, writeFile, readdir, unlink } from "node:fs/promises";
import { schemas, loadBoxSchemas } from "../../schemas/registry.js";

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
    paths: ["store/calendar/**/*.ics"],
    instructions: `# Calendar Event Files (.ics)

These are Google Calendar events synced via \`cb wakeup\`. Each file is a single VEVENT in iCalendar format.

## Key properties

Standard iCalendar: SUMMARY, DESCRIPTION, LOCATION, DTSTART, DTEND, STATUS, TRANSP (OPAQUE=busy, TRANSPARENT=free).

Custom properties track the source calendar:
- \`X-CB-CALENDAR-ID\` — the Google Calendar ID this event belongs to
- \`X-CB-CALENDAR-NAME\` — display name of the calendar
- \`X-CB-CALENDAR-ROLE\` — access role: \`owner\`, \`writer\`, or \`reader\`

## Editability

- **owner/writer calendars**: You can edit the event fields (summary, description, location, times, transparency). Modified .ics files are pushed back to Google Calendar on the next \`cb wakeup\`.
- **reader calendars**: These are subscribed/read-only calendars (e.g. school calendars). Do NOT edit these files — changes cannot be synced back.
- **Events organized by others on your own calendar**: You can generally only change your own attendee response (PARTSTAT), not the event details.

## Filename format

\`{YYYY-MM-DD}_{shortId}.ics\` — the date is the event start date, shortId is derived from the Google event ID.

## Querying

Use \`cb calendar today\`, \`cb calendar upcoming\`, or \`cb calendar <timespan>\` (e.g. \`cb calendar 2w\`) to query events from the CLI. These read from the local .ics files — no API calls needed.`,
  },
];

/**
 * Generate rules files from schema instructions and connector rules.
 *
 * Exported so `cb init` can call it directly.
 */
export async function generateRules(boxRoot: string): Promise<string[]> {
  const rulesDir = join(boxRoot, ".claude", "rules");
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
  } catch {
    // Directory may not exist yet, that's fine
  }

  const generated: string[] = [];

  // Load box-local schemas alongside built-in ones
  const boxSchemas = await loadBoxSchemas(boxRoot);
  const allSchemas = [...schemas, ...boxSchemas];

  // Schema-driven card rules
  for (const schema of allSchemas) {
    if (!schema.instructions) continue;

    const glob = `**/*.${schema.tagName}.card`;
    const filename = `card-${schema.tagName}.md`;
    const content = `---
paths:
  - "${glob}"
---

${schema.instructions.trim()}
`;

    await writeFile(join(rulesDir, filename), content);
    generated.push(filename);
  }

  // Connector rules for non-card files
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

export const initRulesCommand = new Command("init-rules")
  .description("Generate .claude/rules/ files from card schemas")
  .argument("[path]", "Box root path", ".")
  .action(async (targetPath: string) => {
    try {
      const boxRoot = resolve(targetPath);
      const generated = await generateRules(boxRoot);

      if (generated.length === 0) {
        console.log("No schemas with instructions found.");
      } else {
        console.log(`Generated ${generated.length} rule files in .claude/rules/:`);
        for (const file of generated) {
          console.log(`  ${file}`);
        }
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });
