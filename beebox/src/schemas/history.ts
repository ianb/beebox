import { z } from "zod";
import { body, cardSchema } from "../cards/index.js";
import { SYSTEM_CARD_PATHS } from "../shared/system-card-paths.js";

export const HistorySchema = cardSchema("history", {
  description: "The canonical History interface card",
  category: "system",
  searchable: false,
  fields: { body: body(z.string()) },
  instructions: `# History card

The one History card lives at ${SYSTEM_CARD_PATHS.history}. Its filename infers
its type; no view property is needed. Open it for the default History entrance.
Authored saved filters remain plural view cards. The editable body holds notes,
not live filter or selected-commit state. Restore a removed canonical card from
Git or with the declared engine migration.`,
});
