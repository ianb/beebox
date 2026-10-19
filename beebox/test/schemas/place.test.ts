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
  const draft = "---\nname: Home\naddress: 123 Main St\n---\nWhere the boxholder works.\n";
  const parsed = parseCardText(draft, { source: "places/Home.place.card", schemas });
  t.check(parsed.fields, {
    type: "place",
    name: "Home",
    address: "123 Main St",
    body: "Where the boxholder works.\n",
  });
});

// ## A full card with coordinates validates
void test("A full card with coordinates validates", async (t) => {
  const full = "---\nname: Home\nlat: 45.5231\nlng: -122.6765\nradius: 120\n---\nbody\n";
  const parsed = parseCardText(full, { source: "places/Home.place.card", schemas });
  t.check(parsed.fields, {
    type: "place",
    name: "Home",
    lat: 45.5231,
    lng: -122.6765,
    radius: 120,
    body: "body\n",
  });
});

// ## Out-of-range latitude fails the per-field Zod check
void test("Out-of-range latitude fails the per-field Zod check", async (t) => {
  t.check(PlaceSchema.frontmatterSchema.safeParse({ type: "place", name: "X", lat: 999, lng: 0 }).success, false);
});

// ## The `validate` hook flags a half-set coordinate (lat without lng)
void test("The `validate` hook flags a half-set coordinate (lat without lng)", async (t) => {
  t.check(v ? v({ fields: { name: "Home", lat: 45.5 } }) : [], [
    {
      type: "validation",
      severity: "warning",
      message: "place card has lat without lng (or vice versa); both are required for location matching",
    },
  ]);
});

// ## Both-or-neither: full coords and no coords both pass clean
void test("Both-or-neither: full coords and no coords both pass clean", async (t) => {
  t.check(v ? v({ fields: { name: "Home", lat: 45.5, lng: -122.6 } }) : [], []);

  t.check(v ? v({ fields: { name: "Home" } }) : [], []);
});

// ## Template scaffolds a coordless card (coords come from `bbx location mark`)
void test("Template scaffolds a coordless card (coords come from `bbx location mark`)", async (t) => {
  const text = createPlaceTemplate({ name: "Office", address: "1 Market St" });
  t.check(text, "---\nname: Office\naddress: 1 Market St\n---\n");
});
