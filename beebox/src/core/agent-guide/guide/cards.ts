/**
 * Filler for the card-type catalogue in `guide.md`'s CARD_TYPES
 * (`{{card_types}}`), built from the schema and template registries.
 */

import { BOX_PACKAGE_DOCS, DOCS_DIR } from "../../docs-gen/shared.js";
import type { TemplateDefinition } from "../../../templates-registry.js";
import type { CardSchema } from "../../../exports/cards.js";

const CARD_CATEGORY_GROUPS = [
  {
    category: "authored",
    heading: "**Types you create and edit:**",
  },
  {
    category: "synced",
    heading: "**Synced & captured** — made by connectors and capture; rarely created by hand:",
  },
  {
    category: "system",
    heading: "**System bookkeeping** — made and consumed by the machinery; don't author these:",
  },
] as const;

export interface CardTypesInput {
  /** Every schema the box sees: built-in plus box-local. A box-local schema
   *  that shares a built-in's type shadows it (last write wins, as in
   *  `createCardSchemaMap`), so the list is deduplicated by type with the
   *  box-local entry kept. */
  allCardSchemas: readonly CardSchema[];
  /** The box-local subset. Their docs are compiled into the box; every other
   *  type's doc is in the package. */
  boxCardSchemas?: CardSchema[];
  /** Templates this box's own schemas registered. The package's
   *  `bbx-commands.md` lists only built-in templates, so these are listed
   *  here — the one place the agent learns they exist. */
  boxTemplates?: TemplateDefinition[];
}

/** Where a type's `card-<type>.md` lives: the package for built-ins, the box for box-local. */
function cardDocPath(type: string, boxTypes: Set<string>): string {
  return `${boxTypes.has(type) ? DOCS_DIR : BOX_PACKAGE_DOCS}/card-${type}.md`;
}

/** Deduplicate by type, keeping the LAST schema with that type (box-local shadows built-in). */
function effectiveSchemas(allCardSchemas: readonly CardSchema[]): CardSchema[] {
  const byType = new Map<string, CardSchema>();
  for (const s of allCardSchemas) byType.set(s.type, s);
  return [...byType.values()];
}

/** The CARD_TYPES catalogue: one group per category, then any box-local templates. */
export function cardTypesList({ allCardSchemas, boxCardSchemas, boxTemplates }: CardTypesInput): string {
  const boxTypes = new Set((boxCardSchemas ?? []).map((s) => s.type));
  const lines: string[] = [];
  const effective = effectiveSchemas(allCardSchemas);
  for (const group of CARD_CATEGORY_GROUPS) {
    const schemas = effective.filter((s) => s.category === group.category);
    if (schemas.length === 0) continue;
    lines.push(group.heading);
    lines.push("");
    for (const schema of schemas) {
      const summary = schema.brief ?? schema.description;
      const desc = summary === undefined ? "" : ` — ${summary}`;
      const doc = schema.instructions === undefined ? "" : ` → \`${cardDocPath(schema.type, boxTypes)}\``;
      lines.push(`- **${schema.type}**${desc}${doc}`);
    }
    lines.push("");
  }
  if (boxTemplates !== undefined && boxTemplates.length > 0) {
    lines.push("**Box-local templates** — registered by this box's own schemas, so they are not in the package's `bbx-commands.md`. Use with `bbx create <path> -t <name>`:");
    lines.push("");
    for (const t of boxTemplates) {
      lines.push(`- **${t.name}** — ${t.description} (card types: ${t.cardTypes.join(", ")})`);
    }
  }
  return lines.join("\n").replace(/\n+$/, "");
}
