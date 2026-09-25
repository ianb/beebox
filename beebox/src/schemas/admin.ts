import { z } from "zod";
import { body, cardSchema } from "../cards/index.js";
import { SYSTEM_CARD_PATHS } from "../shared/system-card-paths.js";

export const AdminSchema = cardSchema("admin", {
  description: "The canonical Admin interface card",
  category: "system",
  searchable: false,
  fields: { body: body(z.string()) },
  instructions: `# Admin card

The one Admin card lives at ${SYSTEM_CARD_PATHS.admin}. It is an address for
host-wide management controls, not authorization; backend permission checks
remain authoritative. Its editable body holds notes, never passwords, tokens,
grants, OAuth results, or live form state. Restore a removed card from Git or
with the declared engine migration.`,
});
