// # Canonical system card identity

import { test } from "tap";
import "agent-doctest/tap";
import { SYSTEM_CARD_COHORTS, SYSTEM_CARD_PATHS, SYSTEM_CARD_MIGRATION, REMAINING_SYSTEM_CARD_MIGRATION, systemCardLocationError } from "../../src/shared/system-card-paths.js";
import { typeFromFilename } from "../../src/core/card-io.js";

// Bare filenames infer the type. Equivalent safe paths normalize through the shared resolver.
// Copies and escaping paths cannot create another working instrument.
void test("Bare filenames infer the type.", async (t) => {
  // doctest:L12
  t.check([typeFromFilename("dashboard.card"), typeFromFilename("Copy.dashboard.card")], [
    "dashboard",
    "dashboard",
  ]);

  // doctest:L15
  t.check(systemCardLocationError("dashboard", "/_config/interface/./dashboard.card"), null);

  // doctest:L18
  t.check(systemCardLocationError("dashboard", "_content/Copy.dashboard.card")?.includes("_config/interface/dashboard.card"), true);

  // doctest:L21
  await t.checkText(systemCardLocationError("dashboard", "../_config/interface/dashboard.card") !== null, "true");

  // doctest:L24
  t.check(SYSTEM_CARD_COHORTS[SYSTEM_CARD_MIGRATION], [
    "dashboard",
    "settings",
    "browse",
  ]);

  // doctest:L27
  t.check(SYSTEM_CARD_COHORTS[REMAINING_SYSTEM_CARD_MIGRATION], [
    "dashboard",
    "settings",
    "browse",
    "questions",
    "landmarks",
    "history",
    "inventory",
    "admin",
  ]);

  // doctest:L30
  t.check(systemCardLocationError("admin", SYSTEM_CARD_PATHS.admin), null);

  // doctest:L33
  t.check(systemCardLocationError("history", "_content/Saved.history.card")?.includes(SYSTEM_CARD_PATHS.history), true);

  // doctest:L36
  t.check(systemCardLocationError("search", "_content/Focused.search.card"), null);
});
