/**
 * Shared identity fields for "named entity" cards — things the box refers to by
 * name and other names (people, places, …). Spread into a schema's `fields` so
 * the vocabulary stays consistent across entity types:
 *
 *   fields: { ...namedEntityFields, role: ..., body: body(z.string()) }
 *
 * `aliases` is the standard name for an entity's other-names list (an array of
 * strings). Earlier `person` cards called this `called`; the `person-aliases`
 * migration renamed them.
 */

import { z } from "zod";

export const namedEntityFields = {
  /** Canonical name. Required. */
  name: z.string(),
  /** Other names the entity is known by. */
  aliases: z.array(z.string()).optional(),
};
