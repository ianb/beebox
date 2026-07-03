/**
 * Static markdown generators for box agent docs.
 *
 * Pure functions that take no box state and emit fixed reference
 * documentation: per-card-type docs and the connector list. The larger
 * cb-command reference and procedures guide live in sibling files
 * (generate-docs-cb-commands.ts, generate-docs-procedure-guide.ts).
 */

import { getTemplatesForCardType, describeTemplateArgs } from "../schemas/templates.js";

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
    description: "Two-way sync with Google Drive. Spreadsheets become `.gsheet.card` files with JSON tabs; Google Docs become `.gdoc.card` files with sibling markdown. Push detects conflicts when remote changed since the last pull.",
  },
];

/**
 * Generate a detailed doc for a single card type.
 */
export function generateCardDoc(name: string, instructions: string): string {
  const templates = getTemplatesForCardType(name);
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
      lines.push(`cb create <path>.${name}.card -t ${t.name}`);
      lines.push("```");
      lines.push("");

      lines.push(describeTemplateArgs(t.name));
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
    "They are configured per-box in `config/connectors/`.",
    "",
    "## Credentials",
    "",
    "Each service's credentials live in `config/connectors/<service>.secret.json`,",
    "owned by this box. The common shape is `{\"apiKey\": \"...\"}`; services that need",
    "more store whatever their connector expects (e.g. `telegram.secret.json` holds",
    "`{\"botToken\": \"...\", \"webhookSecret\": \"...\"}`). Google services are the exception:",
    "they use shared OAuth tokens plus the box's `googleServices` policy in `config/box.json`.",
    "",
    "Rules for handling keys:",
    "",
    "- `*.secret.*` under `config/connectors/` is gitignored — it is the ONLY place to save a key.",
    "  Never put one in a card, CLAUDE.md, or any committed file; the box repo is pushed to a remote.",
    "  After writing a secret, confirm `git status` shows nothing new staged.",
    "- To retrieve a key, read the JSON file. A missing file means the service isn't configured —",
    "  report what's missing and the exact path it belongs at rather than guessing.",
    "- A scheduled script can declare `<requires><connector>name</connector></requires>`;",
    "  the scheduler checks the secret file exists and skips the script cleanly when it doesn't.",
    "- New services follow the same pattern: pick a `<service>.secret.json` name and document the",
    "  field shape in whatever code consumes it.",
    "",
  ];

  for (const c of CONNECTORS) {
    lines.push(`## ${c.name}`);
    lines.push("");
    lines.push(c.description);
    lines.push("");

    if (c.produces.length > 0) {
      lines.push(`**Produces:** ${c.produces.map((t) => `\`${t}\``).join(", ")} (via \`cb wakeup\`)`);
    } else {
      lines.push("**Outbound only** — no cards produced.");
    }

    lines.push("");
  }

  return lines.join("\n");
}
