import { z } from "zod";
import { body, cardSchema } from "../cards/index.js";
import { SYSTEM_CARD_PATHS } from "../shared/system-card-paths.js";

export const LandmarksSchema = cardSchema("landmarks", {
  description: "The canonical Landmarks interface card",
  category: "system",
  searchable: false,
  fields: { body: body(z.string()) },
  instructions: `# Landmarks card

The one Landmarks card lives at ${SYSTEM_CARD_PATHS.landmarks}. Its filename
infers its type; no view property is needed. Open this existing card instead of
creating another instance. Its editable body holds notes, not live UI state.
Restore a removed card from Git or with the declared engine migration.`,
});
