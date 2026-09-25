import { z } from "zod";
import { body, cardSchema } from "../cards/index.js";
import { SYSTEM_CARD_PATHS } from "../shared/system-card-paths.js";

export const InventorySchema = cardSchema("inventory", {
  description: "The canonical Storage interface card",
  category: "system",
  searchable: false,
  fields: { body: body(z.string()) },
  instructions: `# Storage card

The one Storage card has type inventory and lives at ${SYSTEM_CARD_PATHS.inventory}.
Its filename infers its type; no view property is needed. Open this existing
card instead of creating another instance. Its editable body holds notes, not
live UI state. Restore a removed card from Git or with the declared migration.`,
});
