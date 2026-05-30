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
    produces: ["sheet", "gdoc"],
    description: "Two-way sync with Google Drive. Spreadsheets become `.sheet.card` files with JSON tabs; Google Docs become `.gdoc.card` files with sibling markdown. Push detects conflicts when remote changed since the last pull.",
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
