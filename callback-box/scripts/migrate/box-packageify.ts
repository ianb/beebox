#!/usr/bin/env tsx

/**
 * `box-packageify` — RETIRED tombstone.
 *
 * This migration once converted a legacy (shapeVersion 1) box in place into
 * the v2 package layout (Track H, `docs/implemented-plans/boxes-as-packages-v2.md`).
 * Every box is now v2 and the v1 shape has been removed, so the converter is
 * gone. The migration's stable `name` stays registered in
 * `src/core/migrations.ts` (the manifest is append-only — never remove an
 * entry), so this script must remain runnable as an idempotent no-op.
 *
 * It asserts the box is already a valid v2 package and exits 0 (the box's
 * post-state is exactly what this migration used to produce). A box that
 * predates v2 — the case the converter used to handle — can no longer be
 * migrated automatically: exit 1 loudly so it's investigated by hand.
 *
 * Usage (invoked by `cb migrate`):
 *   pnpm exec tsx scripts/migrate/box-packageify.ts <boxRoot> --apply
 */

import * as path from "node:path";
import { getBoxShape } from "../../src/lib/box-shape.js";
import { errnoCode, errorMessage } from "../../src/lib/error-guards.js";

const RETIRED =
  "box-packageify was retired (all boxes are v2 now); a box that predates the " +
  "v2 package layout can't be converted automatically — investigate by hand. " +
  "See docs/box-layout.md.";

async function main(): Promise<number> {
  const target = process.argv[2];
  if (target === undefined || target === "") {
    process.stderr.write("usage: box-packageify <boxRoot> [--apply]\n");
    return 1;
  }
  const boxRoot = path.resolve(target);
  // The migrate harness passes the operational box root (a v2 box's
  // `content/`); tolerate a caller that passes the package root by also
  // checking `<boxRoot>/content`.
  for (const candidate of [boxRoot, path.join(boxRoot, "content")]) {
    try {
      const shape = await getBoxShape(candidate);
      process.stderr.write(
        `[box-packageify] ${candidate} is already a valid shapeVersion-${String(shape.shapeVersion)} box; nothing to do.\n`
      );
      return 0;
    } catch (e) {
      // No `.cb-box` here — try the next candidate. Any other failure
      // (pre-v2/malformed marker, broken package.json) is the retired case.
      if (errnoCode(e) === "ENOENT") continue;
      process.stderr.write(`[box-packageify] ${candidate}: ${errorMessage(e)}\n`);
      process.stderr.write(`[box-packageify] ${RETIRED}\n`);
      return 1;
    }
  }
  process.stderr.write(`[box-packageify] no box found at ${boxRoot}. ${RETIRED}\n`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    process.stderr.write(`[box-packageify] ${errorMessage(e)}\n`);
    process.exit(1);
  });
