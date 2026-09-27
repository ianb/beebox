import { REMAINING_SYSTEM_CARD_MIGRATION, SYSTEM_CARD_COHORTS, SYSTEM_CARD_PATHS, type SystemCardType } from "../shared/system-card-paths.js";
import { eraseTemplateArgs, type TemplateDefinition } from "../templates-registry.js";
import { z } from "zod";

export function systemCardTemplate(type: SystemCardType): string {
  const title = {
    dashboard: "Dashboard",
    settings: "Settings",
    browse: "Browse",
    questions: "Questions",
    landmarks: "Landmarks",
    history: "History",
    inventory: "Storage",
    admin: "Admin",
    search: "Search",
  }[type];
  return `---\ntitle: ${title}\n---\n`;
}

export const SYSTEM_CARD_TEMPLATES: TemplateDefinition[] = [
  ...SYSTEM_CARD_COHORTS[REMAINING_SYSTEM_CARD_MIGRATION].map((type) =>
    eraseTemplateArgs({
      name: type,
      description: `Canonical ${type} card. Restore only at ${SYSTEM_CARD_PATHS[type]}; additional instances are invalid.`,
      cardTypes: [type],
      defaultForTypes: [type],
      argsSchema: z.object({}),
      generate: () => systemCardTemplate(type),
    })
  ),
  eraseTemplateArgs({
    name: "search",
    description: "A copyable Search interface card with optional durable defaults.",
    cardTypes: ["search"],
    defaultForTypes: ["search"],
    argsSchema: z.object({}),
    generate: () => "---\ntitle: Search\n---\n",
  }),
];
