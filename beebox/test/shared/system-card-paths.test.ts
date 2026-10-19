// # Canonical system card identity

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { SYSTEM_CARD_COHORTS, SYSTEM_CARD_PATHS, SYSTEM_CARD_MIGRATION, REMAINING_SYSTEM_CARD_MIGRATION, systemCardLocationError } from "../../src/shared/system-card-paths.js";
import { typeFromFilename } from "../../src/core/card-io.js";

// Bare filenames infer the type. Equivalent safe paths normalize through the shared resolver.
// Copies and escaping paths cannot create another working instrument.
void test("Bare filenames infer the type.", async (t) => {
  t.check([typeFromFilename("dashboard.card"), typeFromFilename("Copy.dashboard.card")], [
    "dashboard",
    "dashboard",
  ]);

  t.check(systemCardLocationError("dashboard", "/_config/interface/./dashboard.card"), null);

  t.check(systemCardLocationError("dashboard", "_content/Copy.dashboard.card"), "The dashboard card at _content/Copy.dashboard.card must be at _config/interface/dashboard.card. Open or restore the canonical card; do not create another instance.");

  t.check(systemCardLocationError("dashboard", "../_config/interface/dashboard.card"), "The dashboard card at ../_config/interface/dashboard.card must be at _config/interface/dashboard.card. Open or restore the canonical card; do not create another instance.");

  t.check(SYSTEM_CARD_COHORTS[SYSTEM_CARD_MIGRATION], [
    "dashboard",
    "settings",
    "browse",
  ]);

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

  t.check(systemCardLocationError("admin", SYSTEM_CARD_PATHS.admin), null);

  t.check(systemCardLocationError("history", "_content/Saved.history.card"), "The history card at _content/Saved.history.card must be at _config/interface/history.card. Open or restore the canonical card; do not create another instance.");

  t.check(systemCardLocationError("search", "_content/Focused.search.card"), null);
});
