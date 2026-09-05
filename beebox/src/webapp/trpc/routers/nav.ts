/**
 * tRPC router for the nav card — resolves the box root's `nav.card` into
 * render-ready entries for the app bar's switch menu. The frontend treats
 * `absent`/`invalid` as "render no custom section"; the health check (not
 * this endpoint) carries the report when the card is invalid. See docs/implemented-plans/nav-card.md.
 */

import { router, publicProcedure } from "../trpc.js";
import { resolveNav, type NavResolution } from "../../../core/nav.js";

export const navRouter = router({
  get: publicProcedure.query(async ({ ctx }): Promise<NavResolution> => {
    return resolveNav(ctx.boxRoot);
  }),
});
