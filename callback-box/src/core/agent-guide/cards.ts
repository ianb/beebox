/**
 * Card creation and inquiry: type catalogue, the cb create flow, and asking
 * the user via question cards.
 */

import type { ElementSchema } from "cardworks";
import { getAllTemplates } from "../../schemas/templates.js";

export function cardTypesSection(allSchemas: ElementSchema[]): string[] {
  const lines: string[] = [
    "## Card Types",
    "",
  ];
  for (const schema of allSchemas) {
    const hasDoc = schema.instructions ? ` — see \`docs/generated/card-${schema.tagName}.md\`` : "";
    lines.push(`- **${schema.tagName}**${hasDoc}`);
  }
  lines.push("");
  lines.push("New card types can be defined in `config/schemas/` using `cardSchema()` (YAML frontmatter + markdown body) + Zod — see `config/schemas/CLAUDE.md` for how. Run `cb init` after adding a schema to generate rules and docs.");
  lines.push("");
  return lines;
}

export function creatingCardsSection(): string[] {
  const templates = getAllTemplates();
  const lines: string[] = [
    "## Creating Cards",
    "",
    "Prefer `cb create` with templates over writing XML directly:",
    "",
  ];
  for (const t of templates) {
    lines.push(`- \`cb create <path> -t ${t.name}\` — ${t.description}`);
  }
  lines.push("");
  lines.push("For array arguments (like question options), repeat the key: `options=\"Red\" options=\"Blue\"` or use JSON: `options='[\"Red\",\"Blue\"]'`");
  lines.push("");
  lines.push("**Two-step pattern:** For complex cards, create a minimal card first with `cb create`, then edit it to fill in details. This is often easier than getting all arguments right in one command. Example: `cb create box/questions/Q.question.card -t question-text memo=\"...\" prompt=\"...\"` then edit to add a `<directive>`.");
  lines.push("");
  lines.push("Always run `cb validate <path>` after creating or editing a card.");
  lines.push("");
  return lines;
}

export function questionsSection(): string[] {
  return [
    "## Questions",
    "",
    "Create question cards in `box/questions/` to ask the user.",
    "Set `answered-by` to your agent name so the answer routes back to you.",
    "Always include a `<directive>` element describing what you'll do with the answer — when the user answers, the system creates a follow-up job using this directive.",
    "See `docs/generated/card-question.md` for templates.",
    "",
  ];
}
