#!/usr/bin/env tsx
/** Install the copyable Search card's canonical seeded instance. */
import { seedSystemCards, checkSystemCards, SystemCardInvariantError } from "../../src/core/system-cards.js";
import { errorMessage } from "../../src/lib/error-guards.js";
import { SEARCH_SYSTEM_CARD_MIGRATION } from "../../src/shared/system-card-paths.js";

const boxRoot = process.argv[2];
try {
  if (boxRoot === undefined) throw new SystemCardInvariantError(["Usage: search-interface-card.ts <box-root> [--apply]"], SEARCH_SYSTEM_CARD_MIGRATION);
  if (process.argv.includes("--apply")) await seedSystemCards(boxRoot, SEARCH_SYSTEM_CARD_MIGRATION);
  else {
    const errors = await checkSystemCards(boxRoot, SEARCH_SYSTEM_CARD_MIGRATION);
    if (errors.length > 0) throw new SystemCardInvariantError(errors, SEARCH_SYSTEM_CARD_MIGRATION);
    console.log("Dry run: create the missing canonical Search card; preserve existing cards.");
  }
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
