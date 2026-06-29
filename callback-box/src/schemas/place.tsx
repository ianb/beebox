/**
 * Place card schema — named places ("Home", "Office") the box can recognize.
 *
 * Place cards live at `places/<Name>.place.card`. Identity, aliases, a
 * human-readable address, and a center coordinate + radius live in the
 * frontmatter; the markdown body describes the place and why it matters in the
 * box. `cb location get` reports which place the current device location falls
 * in; `cb location mark <path>` stamps the current fix's coordinates into a card.
 *
 * Coordinates are optional so the agent can author the card (name, address,
 * description) before any fix is stamped — the card-first workflow. `lat`/`lng`
 * are not hand-typed; `cb location mark` writes them from the device fix.
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { body, cardSchema, type CardSchema } from "../cards/index.js";
import { namedEntityFields } from "./named-entity-fields.js";

export const PlaceStatus = z.enum(["active", "inactive", "archived"]);
export type PlaceStatusType = z.infer<typeof PlaceStatus>;

export const PlaceSchema: CardSchema = cardSchema("place", {
  // Cross-field rule Zod's per-field shape can't express: coordinates are
  // both-or-neither. A half-set card still loads (lenient parse) but lint-warns
  // and is skipped by location matching, which requires both lat and lng.
  validate: ({ fields }) => {
    const hasLat = fields["lat"] !== undefined && fields["lat"] !== null;
    const hasLng = fields["lng"] !== undefined && fields["lng"] !== null;
    if (hasLat !== hasLng) {
      return [
        {
          type: "validation",
          severity: "warning",
          message: "place card has lat without lng (or vice versa); both are required for location matching",
        },
      ];
    }
    return [];
  },
  fields: {
    status: PlaceStatus.default("active"),
    ...namedEntityFields,
    address: z.string().optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    radius: z.number().positive().optional(),
    body: body(z.string()),
  },
  instructions: `# Place Cards

Place cards track named places the box should recognize — "Home", "Office",
the gym — so location-aware context ("the boxholder is at Home") works.

They live at \`places/<Name>.place.card\`. The filename uses the place's name
with underscores.

**Frontmatter:**
- \`name:\` — The place's name. Required.
- \`aliases:\` — Array of other names for the place (e.g., ["the house"]).
- \`address:\` — Freeform human-readable address (street, city). Optional —
  this is the address a person reads; it is *not* the coordinates.
- \`lat:\` / \`lng:\` — Center coordinate. **Do not hand-type these** — run
  \`cb location mark <path>\` to stamp the boxholder's current device location
  into the card. Both must be set together.
- \`radius:\` — Match radius in meters (written by \`cb location mark\`).
- \`status:\` — \`active\` (default), \`inactive\`, or \`archived\`.

**Body (markdown):** describe the place and **why it matters in the box** —
e.g. "Home — where the boxholder usually works; default for after-hours context."

**How to record a place (card-first, then mark):**
1. Author the card describing the place (name, address, body). Coordinates can
   be absent at this point.
2. When the boxholder is physically at the place, run
   \`cb location mark places/<Name>.place.card\` to stamp the current location.
   It reports the fix's age, so you can judge whether it's current.

\`cb location get\` then names the place whenever the boxholder's location falls
within its radius.

**Filename convention:** \`places/<Name>.place.card\` — use the place's name,
not a slug.`,
});

export interface PlaceFields {
  type: "place";
  status: PlaceStatusType;
  name: string;
  aliases?: string[];
  address?: string;
  lat?: number;
  lng?: number;
  radius?: number;
  body: string;
}

export function createPlaceTemplate(options: {
  name: string;
  aliases?: string;
  address?: string;
}): string {
  const fields: Record<string, unknown> = {
    status: "active",
    name: options.name,
  };
  if (options.aliases !== undefined && options.aliases !== "") {
    fields["aliases"] = [options.aliases];
  }
  if (options.address !== undefined && options.address !== "") {
    fields["address"] = options.address;
  }
  return `---\n${stringifyYaml(fields)}---\n`;
}
