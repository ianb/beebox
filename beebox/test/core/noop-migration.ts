import { MIGRATIONS, type Migration } from "../../src/core/migrations.js";

/** Name of the test-only script migration that does nothing and exits 0. */
export const NOOP_MIGRATION = "test-noop-migration";

/** A second no-op, registered after the first, for tests that need an ordered pair. */
export const NOOP_MIGRATION_AFTER = "test-later-noop-migration";

/**
 * Append the no-op to this process's copy of the registry. Retired entries
 * exit 1 on a box that never applied them, so a sweep test that needs a
 * pending migration to apply cleanly uses this one. MIGRATIONS is readonly to
 * product code and no seam injects a list; tests register on purpose.
 */
export function registerNoopMigration(): void {
  const script = "test/fixtures/migrate/noop.ts";
  const migrations: Migration[] = [{ name: NOOP_MIGRATION, script }, { name: NOOP_MIGRATION_AFTER, script }];
  Array.prototype.push.apply(MIGRATIONS, migrations);
}
