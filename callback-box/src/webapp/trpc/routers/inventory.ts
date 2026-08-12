import { z } from "zod";
import { scanBoxInventory, type BoxInventory } from "../../../core/box-inventory.js";
import { authedProcedure, router } from "../trpc.js";

const CACHE_MAX_AGE_MS = 15 * 60 * 1000;
const inventoryCache = new Map<string, { inventory: BoxInventory; storedAt: number }>();
const inFlightScans = new Map<string, Promise<BoxInventory>>();

async function getInventory(boxRoot: string, refresh: boolean): Promise<BoxInventory> {
  const cached = inventoryCache.get(boxRoot);
  if (!refresh && cached !== undefined && Date.now() - cached.storedAt < CACHE_MAX_AGE_MS) {
    return cached.inventory;
  }
  const existing = inFlightScans.get(boxRoot);
  if (existing !== undefined) {
    if (!refresh) return existing;
    await existing;
    return getInventory(boxRoot, true);
  }
  const scan = scanBoxInventory(boxRoot).then((inventory) => {
    if (inventory.complete || cached === undefined) {
      inventoryCache.set(boxRoot, { inventory, storedAt: Date.now() });
    }
    return inventory;
  }).finally(() => {
    inFlightScans.delete(boxRoot);
  });
  inFlightScans.set(boxRoot, scan);
  return scan;
}

export const inventoryRouter = router({
  summary: authedProcedure
    .input(z.object({ refresh: z.boolean().optional() }).optional())
    .query(({ ctx, input }) => getInventory(ctx.boxRoot, input?.refresh === true)),
});
