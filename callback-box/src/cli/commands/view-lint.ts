/**
 * cb view lint - Flag card-less views.
 *
 * Every view attaches to a card type via `rendersCardTypes` (there is no
 * standalone view). This catches a view that declares none — it would render
 * nowhere — so a box-wide sweep surfaces it instead of a silent 404.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { listViews } from "../../webapp/views/compiler.js";
import { errorMessage } from "../../lib/error-guards.js";

export const viewLintCommand = new Command("lint")
  .description("Flag card-less views — every view must attach to a card type via rendersCardTypes; exit non-zero if any lack it")
  .option("--json", "Emit machine-readable JSON ({ ok, cardless: [slug] })")
  .action(async (options: { json?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const metas = await listViews(boxRoot);
      const cardless = metas.filter((m) => m.rendersCardTypes.length === 0).map((m) => m.slug);
      const ok = cardless.length === 0;
      if (options.json === true) {
        process.stdout.write(JSON.stringify({ ok, cardless }) + "\n");
      } else {
        for (const m of metas) {
          if (m.rendersCardTypes.length > 0) {
            process.stdout.write(`✓ ${m.slug} → ${m.rendersCardTypes.join(", ")}\n`);
          } else {
            process.stderr.write(`✗ ${m.slug} — no rendersCardTypes; attach it to a card type or remove it\n`);
          }
        }
        process.stdout.write(`${String(metas.length)} view(s), ${String(cardless.length)} card-less\n`);
      }
      process.exitCode = ok ? 0 : 1;
    } catch (error) {
      process.stderr.write(`Error: ${errorMessage(error)}\n`);
      process.exitCode = 1;
    }
  });
