/**
 * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
 *
 * This XML→frontmatter migration ran before the `cardworks` XML library was
 * removed. Every box is migrated, and `cb init` seeds a full migrations
 * manifest on new boxes, so this never runs. It is a no-op kept only so its
 * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
 * never delete that entry.
 */
console.log("retired migrator (cardworks removed); nothing to do");
