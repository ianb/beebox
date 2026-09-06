/**
 * Static markdown generators for box agent docs.
 *
 * Pure functions that take no box state and emit fixed reference
 * documentation: per-card-type docs and the connector list. The larger
 * bbx-command reference and procedures guide live in sibling files
 * (generate-docs-bbx-commands.ts, generate-docs-procedure-guide.ts).
 */

import { describeTemplate, type TemplateDefinition } from "../../schemas/templates.js";

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
    "Credentials do NOT live in this box. They live in one machine-level store outside every",
    "box's directory, and this box holds a *grant* to the ones the boxholder decided it may use.",
    "You cannot read that store, add to it, or grant anything — those are the boxholder's",
    "decisions, made from the admin page or the `bbx secrets` CLI. Google services are separate",
    "again: shared OAuth tokens plus the box's `googleServices` policy in `_config/box.json`.",
    "",
    "Rules for handling keys:",
    "",
    "- **Never write a key into this box.** Not a card, not CLAUDE.md, not a config or `.env`",
    "  file, not a script, not a log line, not a chat message. There is exactly one copy of each",
    "  key and rotation is supposed to touch only that copy. A key in the tree also gets pushed",
    "  to the box's git remote.",
    "- **To get a key configured**, ask the boxholder to add and grant it — they can do it from",
    "  the admin page's Secrets section. Say which name you need and what for; do not offer to",
    "  save it for them, and never accept one pasted into chat.",
    "- **To USE a key from code you write** (a trick, a scheduled script, a procedure step),",
    "  resolve it by name at call time over the loopback API — see the agent guide's secrets",
    "  section for the exact request. It needs a grant at `agent` access. Hold the value in a",
    "  local variable for the length of the outbound call and never store it anywhere.",
    "- Built-in connectors (Telegram, Gmail, transcription, …) resolve their own credentials",
    "  inside the server process. You never see or need those values.",
    "- A scheduled script can declare `<requires><connector>name</connector></requires>`; the",
    "  scheduler checks whether the box has a granted credential for that connector and skips",
    "  the script cleanly when it doesn't.",
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
      lines.push(`**Produces:** ${c.produces.map((t) => `\`${t}\``).join(", ")} (via \`bbx wakeup\`)`);
    } else {
      lines.push("**Outbound only** — no cards produced.");
    }

    lines.push("");
  }

  return lines.join("\n");
}
