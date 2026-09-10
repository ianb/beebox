import { z } from "zod";
import { body, cardSchema } from "../cards/index.js";
import { SYSTEM_CARD_PATHS } from "../shared/system-card-paths.js";

export const QuestionsSchema = cardSchema("questions", {
  description: "The canonical Questions interface card",
  category: "system",
  searchable: false,
  fields: { body: body(z.string()) },
  instructions: `# Questions card

The one Questions card lives at ${SYSTEM_CARD_PATHS.questions}. Its filename
infers its type; no view property is needed. Open this existing card instead of
creating another instance. Its editable body holds notes, not live UI state.
Restore a removed card from Git or with the declared engine migration.`,
});
