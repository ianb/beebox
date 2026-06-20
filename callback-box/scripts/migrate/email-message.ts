/**
 * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
 *
 * This XML→frontmatter migration needed the `cardworks` XML parser, which was
 * removed once every box was migrated. The MIGRATIONS entry (the manifest key
 * in src/core/migrations.ts) is kept, but the script can no longer do its work.
 *
 * It exits non-zero (a HARD failure) so `cb migrate` HALTS rather than silently
 * recording the migration as applied. In practice this never fires: fully
 * migrated boxes have it applied already, and `cb init` seeds a full manifest on
 * new boxes — so it is never pending. If you DO hit this, the box still has
 * unconverted legacy XML cards: migrate it with an older callback-box release
 * (before cardworks was removed), then resume.
 */
console.error(
  "This migration is retired: the cardworks XML library it needed was removed. " +
    "If this box still has unmigrated XML cards, run the migration with an older " +
    "callback-box release first, then re-run `cb migrate`."
);
process.exit(1);
