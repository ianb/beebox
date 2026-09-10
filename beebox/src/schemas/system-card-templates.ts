import { REMAINING_SYSTEM_CARD_MIGRATION, SYSTEM_CARD_COHORTS, SYSTEM_CARD_PATHS, type SystemCardType } from "../shared/system-card-paths.js";
import { registerTemplate } from "./templates-registry.js";
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
  }[type];
  return `---\ntitle: ${title}\n---\n`;
}

for (const type of SYSTEM_CARD_COHORTS[REMAINING_SYSTEM_CARD_MIGRATION]) {
  registerTemplate({
    name: type,
    description: `Canonical ${type} card. Restore only at ${SYSTEM_CARD_PATHS[type]}; additional instances are invalid.`,
    cardTypes: [type],
    defaultForTypes: [type],
    argsSchema: z.object({}),
    generate: () => systemCardTemplate(type),
  });
}
