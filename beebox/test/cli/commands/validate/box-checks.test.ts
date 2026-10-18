// # `bbx validate`'s box-wide error buckets
//
// `checkRootStrayErrors` (Track C, `docs/implemented-plans/one-root-box-layout.md`) formats
// `checkBoxRoot`'s findings as the error lines `bbx validate` prints and counts
// toward its exit code. The check itself (`checkBoxRoot`) is doctested in
// `test/lib/box-root-check.doctest.md`; this covers only the formatting.

import { test } from "tap";
import "agent-doctest/tap";
import {
  checkPresentationErrors,
  checkReservedSegmentErrors,
  checkRootStrayErrors,
} from "../../../../src/cli/commands/validate/box-checks.js";
import { clearBoxConfigCache } from "../../../../src/core/box/config.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

// A clean box reports nothing:
void test("A clean box reports nothing:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L21
  const box = await makeTmpBox();
  await box.write("_content/inbox/x.doc.card", "---\ntitle: Note\n---\n");
  t.check(await checkRootStrayErrors(box.root), []);
});

// A stray root entry becomes one `Box root: …` error line, ready to print
// alongside the other buckets `bbx validate` reports:
void test("A stray root entry becomes one Box root:", async (t) => {
  t.teardown(async () => {
    try {
      await strayBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L35
  const strayBox = await makeTmpBox();
  await strayBox.write("recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
  t.check((await checkRootStrayErrors(strayBox.root)).join("\n"), "Box root: recipes: the box root is a closed vocabulary — user content goes under /_content/");
});

// ## Below-root reserved area names
//
// `checkReservedSegmentErrors` walks every underscore area except `_tmp` and
// reports entries nesting a reserved area name (`box-reserved-segments.ts`) —
// the net for out-of-band writes (a plain `mkdir` from an agent shell) that the
// CLI/HTTP guards never saw. The shallowest offender is reported once, not
// every file inside it:
void test("checkReservedSegmentErrors walks every underscore area except tmp and reports...", async (t) => {
  t.teardown(async () => {
    try {
      await nestedBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L54
  const nestedBox = await makeTmpBox();
  await nestedBox.write("_content/recipes/_config/x.md", "stray\n");
  t.check((await checkReservedSegmentErrors(nestedBox.root)).join("\n"), "Reserved name: _content/recipes/_config: \"_config\" is a reserved box-area name, legal only at the box root (a nested _tmp is the one exception) — rename this entry");

  // The template-updates mirror stays clean:

  // doctest:L63
  await nestedBox.write("_config/_template-updates/_content/briefing.md", "parked\n");
  await t.checkText(JSON.stringify((await checkReservedSegmentErrors(nestedBox.root)).length), "1");
});

// `_tmp` is walked too (nesting the NAME `_tmp` is legal; a `_config` hiding in
// scratch is not), and a descendant of an offender — even one itself named
// `_config` — is not re-reported:
void test("tmp is walked too (nesting the NAME tmp is legal; a config hiding in scratch...", async (t) => {
  t.teardown(async () => {
    try {
      await tmpBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L77
  const tmpBox = await makeTmpBox();
  await tmpBox.write("_tmp/_config/x.txt", "stray\n");
  await tmpBox.write("_content/_config/_config/y.txt", "stray\n");
  await t.checkText((await checkReservedSegmentErrors(tmpBox.root)).join("\n"), `Reserved name: _content/_config: "_config" is a reserved box-area name, legal only at the box root (a nested _tmp is the one exception) — rename this entry
Reserved name: _tmp/_config: "_config" is a reserved box-area name, legal only at the box root (a nested _tmp is the one exception) — rename this entry`);
});

// ## Card-theme presentation configuration
//
// The box-wide validator checks `_config/box.json`'s presentation block against
// the deliberately small path-pattern language. It does NOT check theme names or
// stocks against a catalog — those are an open set, so an unrecognized stock is
// the box's own vocabulary and falls back at the renderer:
void test("The box-wide validator checks config/box.json's presentation block against th...", async (t) => {
  t.teardown(async () => {
    try {
      await themeBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L97
  const themeBox = await makeTmpBox();
  await themeBox.write("_config/box.json", JSON.stringify({
    presentation: {
      default: { name: "paper", stock: "cream" },
      rules: [{ match: "_content/**", theme: { name: "post-it", stock: "yellow" } }],
    },
  }));
  t.check(await checkPresentationErrors(themeBox.root), []);

  // doctest:L107
  await themeBox.write("_config/box.json", JSON.stringify({
    presentation: {
      rules: [{ match: "../outside/**", theme: { name: "post-it", stock: "purple" } }],
    },
  }));
  clearBoxConfigCache(themeBox.root);
  t.check((await checkPresentationErrors(themeBox.root)).join("\n"), "Presentation: presentation.rules.0.match: pattern must not contain . or .. path segments");
});
