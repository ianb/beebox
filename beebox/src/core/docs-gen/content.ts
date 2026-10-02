/**
 * Static markdown generators for box agent docs.
 *
 * Pure functions that take no box state and emit fixed reference
 * documentation: per-card-type docs and the connector list. The larger
 * bbx-command reference and procedures guide live in sibling files
 * (generate-docs-bbx-commands.ts, generate-docs-procedure-guide.ts).
 */

import { describeTemplate } from "../../templates-describe.js";
import type { TemplateDefinition } from "../../templates-registry.js";

/**
 * Static connector metadata. Connectors register at runtime with a boxRoot,
 * but their capabilities are fixed at build time — so we declare them here.
 */
interface ConnectorInfo {
  name: string;
  produces: string[];
  description: string;
}

const CONNECTORS: ConnectorInfo[] = [
  {
    name: "gmail",
    produces: ["email-thread", "email-message"],
    description: "Pulls emails from Gmail via IMAP. Creates thread directories with message cards and body text files.",
  },
  {
    name: "google-drive",
    produces: ["gsheet", "gdoc"],
    description: [
      "Two-way sync with Google Drive. Spreadsheets become `.gsheet.card` files with JSON tabs;",
      "Google Docs become `.gdoc.card` files with sibling markdown. Push detects conflicts when",
      "remote changed since the last pull.",
      "",
      "The `bbx drive` verbs (`inspect`, `mount`, `link`, `add`, `list`) work from your shell even",
      "though you hold no Google credential: the server holds it and does that half for you. If",
      "Drive is not enabled, you may set `googleServices.drive: true` in `_config/box.json` when",
      "the boxholder asks for Drive. After mounting, run `bbx force-wakeup --connector google-drive`",
      "to confirm the first sync.",
    ].join("\n"),
  },
  {
    name: "google-calendar",
    produces: [],
    description: [
      "Two-way sync between Google Calendar and `.ics` files in `_content/calendar/`. Viewing,",
      "creating, editing, and deleting events is the `calendar` skill (`.claude/skills/calendar/`);",
      "the file format, editability by calendar role, and filename form are the",
      "`connector-calendar` rule, which loads when an `.ics` file is in play. Sync state lives in",
      "`_bookkeeping/connectors/`.",
    ].join("\n"),
  },
  {
    name: "telegram",
    produces: ["telegram-message"],
    description: [
      "Messages the boxholder sends the box's Telegram bot arrive as cards under",
      "`_content/chat/telegram/`; replies go back through the same chat. There is nothing to",
      "author by hand: a Telegram conversation is a chat like any other.",
    ].join("\n"),
  },
];

export interface CardDocInput {
  /** The card type. */
  name: string;
  /** The schema's `instructions` (with any appendix already applied). */
  instructions: string;
  /** Templates that create this type. The caller chooses the set — built-in
   *  only for the package docs, the box's effective set for a box-local type. */
  templates: TemplateDefinition[];
}

/**
 * Generate a detailed doc for a single card type.
 */
export function generateCardDoc({ name, instructions, templates }: CardDocInput): string {
  const lines: string[] = [
    `# ${name} Card`,
    "",
    instructions.trim(),
    "",
  ];

  if (templates.length > 0) {
    lines.push("## Templates");
    lines.push("");

    for (const t of templates) {
      lines.push(`### ${t.name}`);
      lines.push("");
      lines.push(t.description);
      lines.push("");
      lines.push("```bash");
      lines.push(`bbx create <path>.${name}.card -t ${t.name}`);
      lines.push("```");
      lines.push("");

      lines.push(describeTemplate(t));
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Generate the connectors reference doc.
 */
export function generateConnectorsDocs(): string {
  const lines: string[] = [
    "# Connectors",
    "",
    "Connectors bridge external services to the box filesystem.",
    "They are configured per-box in `_config/connectors/`.",
    "",
    "## Credentials",
    "",
    "Credentials do NOT live in this box. How keys are stored, requested, and used from code you",
    "write is in the agent guide's \"API keys & secrets\" section; this section adds only what is",
    "specific to connectors.",
    "",
    "- Google services use shared OAuth tokens plus the box's `googleServices`",
    "  policy in `_config/box.json`.",
    "- **To use a granted key from code you write** that runs outside the server (a scheduled",
    "  script, a procedure step), resolve it by name at call time over the loopback API; it needs",
    "  a grant at `agent` access, and the value lives in a local variable for the length of the",
    "  outbound call and is never stored:",
    "",
    "  ```bash",
    "  curl -sS -X POST \"$BBX_SERVER_URL/$BBX_BOX_NAME/api/secrets/resolve\" \\",
    "    -H \"Authorization: Bearer $BBX_AGENT_TOKEN\" -H \"Content-Type: application/json\" \\",
    "    -d '{\"name\":\"<secret-name>\",\"purpose\":\"<short-label>\"}'",
    "  # -> {\"value\":\"…\",\"suspect\":false}",
    "  ```",
    "",
    "  A trick declares its secrets in `secrets.json` instead and receives them in its",
    "  environment; see `tricks.md`.",
    "- Built-in connectors (Telegram, Gmail, transcription, …) resolve their own credentials",
    "  inside the server process. You never see or need those values.",
    "- A scheduled script that needs a connector says so in its `requires` field; see",
    "  `card-scheduled-script.md`.",
    "- A retired `_config/connectors/<service>.secret.json` file is read by nothing; `bbx health`",
    "  flags any that survive. If you find one, report it for deletion — do not create new ones,",
    "  and do not read one to \"retrieve\" a key.",
    "",
  ];

  for (const c of CONNECTORS) {
    lines.push(`## ${c.name}`);
    lines.push("");
    lines.push(c.description);
    lines.push("");

    if (c.produces.length > 0) {
      lines.push(`**Produces:** ${c.produces.map((t) => `\`${t}\``).join(", ")} (via the wakeup cycle)`);
    } else {
      lines.push("**Outbound only** — no cards produced.");
    }

    lines.push("");
  }

  return lines.join("\n");
}
