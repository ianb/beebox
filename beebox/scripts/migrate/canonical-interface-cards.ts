#!/usr/bin/env tsx
/** Bootstrap creates files, rather than transforming walked cards, so it does not use the transform harness. */
import { seedSystemCards, checkSystemCards, SystemCardInvariantError } from "../../src/core/system-cards.js";
import { errorMessage } from "../../src/lib/error-guards.js";

const boxRoot = process.argv[2];
try {
  if (boxRoot === undefined) throw new SystemCardInvariantError(["Usage: canonical-interface-cards.ts <box-root> [--apply]"]);
  if (process.argv.includes("--apply")) await seedSystemCards(boxRoot);
  else {
    const errors = await checkSystemCards(boxRoot);
    if (errors.length > 0) throw new SystemCardInvariantError(errors);
    console.log("Dry run: create missing canonical Dashboard, Settings, and Browse cards; preserve existing cards.");
  }
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
