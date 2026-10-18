// # Place card schema
//
// Place cards (`places/<Name>.place.card`) name a location the box recognizes.
// Coordinates are optional (authored card-first, then stamped by `bbx location
// mark`); the `validate` hook flags a half-set coordinate.

import { test } from "tap";
import "agent-doctest/tap";
import { PlaceSchema, createPlaceTemplate } from "../../src/schemas/place.js";
import { parseCardText } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas.js";

const schemas = await createCardSchemaMap();
const v = PlaceSchema.validate;

// ## A coordless draft (name + address + body) validates
void test("A coordless draft (name + address + body) validates", async (t) => {
  // doctest:L19
  const draft = "---\nname: Home\naddress: 123 Main St\n---\nWhere the boxholder works.\n";
  const parsed = parseCardText(draft, { source: "places/Home.place.card", schemas });
  t.check(parsed.fields.name, "Home");

  // doctest:L24
  t.check(parsed.fields.address, "123 Main St");
});

// ## A full card with coordinates validates
void test("A full card with coordinates validates", async (t) => {
  // doctest:L31
  const full = "---\nname: Home\nlat: 45.5231\nlng: -122.6765\nradius: 120\n---\nbody\n";
  const parsed = parseCardText(full, { source: "places/Home.place.card", schemas });
  t.check([parsed.fields.lat, parsed.fields.lng, parsed.fields.radius], [
    45.5231,
    -122.6765,
    120,
  ]);
});

// ## Out-of-range latitude fails the per-field Zod check
void test("Out-of-range latitude fails the per-field Zod check", async (t) => {
  // doctest:L40
  t.check(PlaceSchema.frontmatterSchema.safeParse({ type: "place", name: "X", lat: 999, lng: 0 }).success, false);
});

// ## The `validate` hook flags a half-set coordinate (lat without lng)
void test("The `validate` hook flags a half-set coordinate (lat without lng)", async (t) => {
  // doctest:L47
  await t.checkText((v ? v({ fields: { name: "Home", lat: 45.5 } }) : []).length, "1");

  // doctest:L50
  t.check((v ? v({ fields: { name: "Home", lat: 45.5 } }) : [])[0]?.severity, "warning");
});

// ## Both-or-neither: full coords and no coords both pass clean
void test("Both-or-neither: full coords and no coords both pass clean", async (t) => {
  // doctest:L57
  await t.checkText((v ? v({ fields: { name: "Home", lat: 45.5, lng: -122.6 } }) : []).length, "0");

  // doctest:L60
  await t.checkText((v ? v({ fields: { name: "Home" } }) : []).length, "0");
});

// ## Template scaffolds a coordless card (coords come from `bbx location mark`)
void test("Template scaffolds a coordless card (coords come from `bbx location mark`)", async (t) => {
  // doctest:L67
  const text = createPlaceTemplate({ name: "Office", address: "1 Market St" });
  await t.checkText(text.includes("name: Office") && text.includes("address: 1 Market St") && !text.includes("lat:"), "true");
});
