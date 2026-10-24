// finish-preflight-lib: a landing that touches theme styles, the UI primitives
// or palette, the studio, the theme catalog or the contrast checker runs
// `bin/theme-check --all`, and a docs-only landing lists it as skipped.

import { test } from "tap";
import { touchesThemeSurface, verificationCommands } from "../finish-preflight-lib.js";

function themeCommand(paths: string[]): { command: string; skip?: string }[] {
  return verificationCommands({
    paths,
    workspacePackages: new Set(["beebox"]),
    hasScript: () => false,
    skipTypecheckLint: { value: false, reason: "" },
  }).filter((c) => c.kind === "theme").map(({ command, skip }) => (skip === undefined ? { command } : { command, skip }));
}

void test("theme paths are recognized; neighbouring frontend paths are not", (t) => {
  const cases = [
    "beebox/src/frontend/src/themes/deck.css",
    "beebox/src/frontend/src/components/themes/SystemThemePicker.tsx",
    "beebox/src/frontend/src/pages/dev/theme-studio-draft.css",
    "beebox/src/frontend/src/pages/dev/components/ThemeStudioHarness.tsx",
    "beebox/src/frontend/src/pages/dev/components/ThemeStudioCards.tsx",
    "beebox/src/shared/card-theme/catalog.ts",
    "beebox/src/shared/theme-screens.ts",
    "beebox/test/tours/tour-lib/contrast-page.ts",
    "beebox/test/tours/tour-lib/rules-page.ts",
    "bin/theme-check",
    "beebox/src/frontend/src/components/ui/Card.tsx",
    "beebox/src/frontend/tailwind.config.js",
    "beebox/src/frontend/src/pages/SettingsPage.tsx",
    "beebox/test/tours/tour-lib/axe.ts",
  ];
  t.check(cases.map((path) => [path, touchesThemeSurface([path])]), [
    ["beebox/src/frontend/src/themes/deck.css", true],
    ["beebox/src/frontend/src/components/themes/SystemThemePicker.tsx", true],
    ["beebox/src/frontend/src/pages/dev/theme-studio-draft.css", true],
    ["beebox/src/frontend/src/pages/dev/components/ThemeStudioHarness.tsx", true],
    ["beebox/src/frontend/src/pages/dev/components/ThemeStudioCards.tsx", true],
    ["beebox/src/shared/card-theme/catalog.ts", true],
    ["beebox/src/shared/theme-screens.ts", true],
    ["beebox/test/tours/tour-lib/contrast-page.ts", true],
    ["beebox/test/tours/tour-lib/rules-page.ts", true],
    ["bin/theme-check", true],
    ["beebox/src/frontend/src/components/ui/Card.tsx", true],
    ["beebox/src/frontend/tailwind.config.js", true],
    ["beebox/src/frontend/src/pages/SettingsPage.tsx", false],
    ["beebox/test/tours/tour-lib/axe.ts", false],
  ]);
  t.end();
});

void test("a theme change runs the catalog check; docs-only skips it", (t) => {
  t.check(themeCommand(["beebox/src/frontend/src/themes/deck.css"]), [{ command: "bin/theme-check --all" }]);
  t.check(themeCommand(["beebox/src/frontend/src/pages/SettingsPage.tsx"]), []);
  t.check(themeCommand(["beebox/src/frontend/src/themes/README.md"]), [{ command: "bin/theme-check --all", skip: "docs-only diff" }]);
  t.end();
});
