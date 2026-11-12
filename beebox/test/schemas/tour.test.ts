// # `tour` card schema
//
// Body-bearing card: one `## ` heading per beat, optional `current` naming a
// beat. The `validate` hook rejects a body with no beat, equal beat titles, and
// a `current` that matches no beat; its messages list the titles.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { TourSchema } from "../../src/schemas/tour.js";
import { containing } from "@ianbicking/tap-check/check";
import { getCardTypes } from "../../src/schemas.js";

function validate(fields: Record<string, unknown>) {
  return TourSchema.validate?.({ fields }) ?? "no validate hook";
}

void test("tour is registered", async (t) => {
  t.check(getCardTypes(), containing(["tour"]));
});

void test("a good card has no issues", async (t) => {
  t.check(validate({ current: "Ask me", body: "Intro\n## Look around\n## Ask me\n" }), []);
});

void test("a body with no heading fails", async (t) => {
  t.check(validate({ body: "Just text." }), [
    { type: "validation", severity: "error", message: "a tour needs at least one beat: start each beat with a `## ` heading" },
  ]);
});

void test("equal titles fail and the message lists the beats", async (t) => {
  t.check(validate({ body: "## A\n## B\n## A\n" }), [
    { type: "validation", severity: "error", message: "two beats are titled \"A\"; beat titles must differ (beats: A, B, A)" },
  ]);
});

void test("current naming no beat fails and the message lists the beats", async (t) => {
  t.check(validate({ current: "C", body: "## A\n## B\n" }), [
    { type: "validation", severity: "error", message: "current \"C\" matches no beat title (beats: A, B)" },
  ]);
});
