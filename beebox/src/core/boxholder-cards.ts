/**
 * Load the box's boxholders — the person(s) the box serves and acts on
 * behalf of — from `people/*.person.card` files flagged `boxholder: true`.
 *
 * This is the single source of truth for who the boxholder is. It replaces
 * the personality card's embedded `boxholder.full-name`/`called`, so a box
 * with several boxholders (a family, an ledger run by siblings) just flags
 * several person cards. `compilePersonality` calls this at doc-generation
 * time and bakes the result into the agent guide.
 *
 * Globs every `*.person.card` and loads each through `parseCardText`, so the
 * person schema's constraints apply — an invalid/unparseable card is logged
 * and skipped rather than breaking the compile. Archived/inactive boxholders
 * are excluded. `called` is the person's first alias, if any.
 */

import * as path from "node:path";
import { readFile } from "node:fs/promises";
import { glob } from "glob";
import { parseCardText } from "./card-io.js";
import { createCardSchemaMap } from "../schemas/registry.js";
import type { Boxholder } from "../schemas/personality-fields.js";

export async function loadBoxholders(boxRoot: string): Promise<Boxholder[]> {
  const matches = await glob("people/*.person.card", {
    cwd: boxRoot,
    nodir: true,
    ignore: ["node_modules/**", ".git/**", "_tmp/**", ".beebox/**"],
  });

  const schemas = await createCardSchemaMap(boxRoot);
  const boxholders: Boxholder[] = [];
  for (const rel of matches) {
    try {
      const text = await readFile(path.join(boxRoot, rel), "utf-8");
      const { fields } = parseCardText(text, { source: rel, schemas });

      if (fields["boxholder"] !== true) continue;
      const status = typeof fields["status"] === "string" ? fields["status"] : "active";
      if (status === "archived" || status === "inactive") continue;

      const name = typeof fields["name"] === "string" && fields["name"] !== ""
        ? fields["name"]
        : path.basename(rel).replace(/\.person\.card$/, "").replace(/_/g, " ");
      const aliases = Array.isArray(fields["aliases"]) ? fields["aliases"] : [];
      const called = typeof aliases[0] === "string" && aliases[0] !== "" ? aliases[0] : undefined;
      boxholders.push(called !== undefined ? { name, called } : { name });
    } catch (e) {
      console.warn(`[boxholder-cards] skipping ${rel}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return boxholders;
}
