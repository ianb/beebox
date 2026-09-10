#!/usr/bin/env tsx
/** Bootstrap creates files, rather than transforming walked cards, so it does not use the transform harness. */
import { seedSystemCards, checkSystemCards, SystemCardInvariantError } from "../../src/core/system-cards.js";
import { errorMessage } from "../../src/lib/error-guards.js";
import { REMAINING_SYSTEM_CARD_MIGRATION } from "../../src/shared/system-card-paths.js";

const boxRoot = process.argv[2];
try {
  if (boxRoot === undefined) throw new SystemCardInvariantError(["Usage: remaining-interface-cards.ts <box-root> [--apply]"], REMAINING_SYSTEM_CARD_MIGRATION);
  if (process.argv.includes("--apply")) await seedSystemCards(boxRoot, REMAINING_SYSTEM_CARD_MIGRATION);
  else {
    const errors = await checkSystemCards(boxRoot, REMAINING_SYSTEM_CARD_MIGRATION);
    if (errors.length > 0) throw new SystemCardInvariantError(errors, REMAINING_SYSTEM_CARD_MIGRATION);
    console.log("Dry run: create missing canonical Questions, Landmarks, History, Storage, and Admin cards; preserve existing cards.");
  }
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
