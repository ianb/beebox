// # Resolving the card for the conversation strip
//
// `resolveStripCard` (`src/core/chat/strip.ts`) turns the ref `bbx chat strip
// set` names into a stored `/`-leading box path, or a refusal. It resolves only
// through `parseRef`/`resolveRefPath`, so a `..` escape fails closed.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTestServer } from "../../helpers/test-route-server.js";
import { resolveStripCard } from "../../../src/core/chat/strip.js";

async function setup(t: { teardown: (fn: () => Promise<void>) => void }) {
  const ctx = await makeTestServer();
  t.teardown(async () => { await ctx.cleanup(); });
  await ctx.seed("_content/Walk.tour.card", "---\n---\n## One\n");
  await ctx.seed("_content/Plain.doc.card", "---\n---\nhello\n");
  await ctx.seed("_content/notes.md", "hello\n");
  await ctx.seed("_content/Gauge.gauge.card", "---\n---\n");
  return ctx;
}

void test("a tour card is accepted and stored with a leading slash", async (t) => {
  const ctx = await setup(t);
  t.check(await resolveStripCard(ctx.boxRoot, { ref: "_content/Walk.tour.card", metas: [] }), { ok: true, value: { path: "/_content/Walk.tour.card", type: "tour" } });
  t.check(await resolveStripCard(ctx.boxRoot, { ref: "/_content/Walk.tour.card", metas: [] }), { ok: true, value: { path: "/_content/Walk.tour.card", type: "tour" } });
});

void test("a missing card, a non-card, and a .. escape are refused", async (t) => {
  const ctx = await setup(t);
  t.check(await resolveStripCard(ctx.boxRoot, { ref: "_content/Nope.tour.card", metas: [] }), { ok: false, error: { refusal: "not-found" } });
  t.check(await resolveStripCard(ctx.boxRoot, { ref: "_content/notes.md", metas: [] }), { ok: false, error: { refusal: "not-a-card" } });
  t.check(await resolveStripCard(ctx.boxRoot, { ref: "../outside/Walk.tour.card", metas: [] }), { ok: false, error: { refusal: "not-found" } });
  t.check(await resolveStripCard(ctx.boxRoot, { ref: "_content/../../x.tour.card", metas: [] }), { ok: false, error: { refusal: "not-found" } });
});

void test("a type with no strip rendering is refused and the capable types are listed", async (t) => {
  const ctx = await setup(t);
  t.check(await resolveStripCard(ctx.boxRoot, { ref: "_content/Plain.doc.card", metas: [] }), {
    ok: false,
    error: { refusal: "not-strip-capable", type: "doc", capableTypes: ["tour"] },
  });
});

void test("a type a box view draws in the strip is accepted", async (t) => {
  const ctx = await setup(t);
  const metas = [{ slug: "gauge", modes: ["page", "strip"], rendersCardTypes: ["gauge"] }];
  t.check(await resolveStripCard(ctx.boxRoot, { ref: "_content/Gauge.gauge.card", metas: metas }), { ok: true, value: { path: "/_content/Gauge.gauge.card", type: "gauge" } });
  const pageOnly = [{ slug: "gauge", modes: ["page"], rendersCardTypes: ["gauge"] }];
  t.check(await resolveStripCard(ctx.boxRoot, { ref: "_content/Gauge.gauge.card", metas: pageOnly }), {
    ok: false,
    error: { refusal: "not-strip-capable", type: "gauge", capableTypes: ["tour"] },
  });
});
