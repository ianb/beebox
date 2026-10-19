// # ScanVision service — backend selection
//
// The `ScanVision` service is the photo-analysis backend behind `bbx scan-import`'s
// photo flow (design: `docs/plans/scan-vision-claude.md`). This doctest covers the
// backend selection rules.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { selectScanVisionBackend } from "../../src/services/scan-vision.js";

// ## Backend selection
//
// Default (no `BBX_SCAN_VISION`) is Claude — the zero-setup path. Gemini is
// explicit opt-in and fails closed without a key; unknown values are errors,
// never silent fallbacks. The env selects the *backend*; the route arrives
// already resolved from `core/openrouter.ts` — the box's own Gemini key
// (`core/gemini-key.ts`, the machine secret store) when it has one, OpenRouter
// otherwise — so there is one place a Gemini key is resolved.
void test("Default (no BBXSCANVISION) is Claude — the zero-setup path.", async (t) => {
  const claude = selectScanVisionBackend({}, null);
  t.check(claude, {
    ok: true,
    value: {
      backend: "claude",
    },
  });

  const gemini = selectScanVisionBackend({ BBX_SCAN_VISION: "gemini" }, { via: "direct", apiKey: "placeholder-gemini-key" });
  t.check(gemini, {
    ok: true,
    value: {
      backend: "gemini",
      route: {
        via: "direct",
        apiKey: "placeholder-gemini-key",
      },
    },
  });

  const noKey = selectScanVisionBackend({ BBX_SCAN_VISION: "gemini" }, null);
  t.check(noKey.ok ? "ok" : noKey.error, "BBX_SCAN_VISION=gemini but no key can reach the model — grant the \"gemini\" or \"openrouter\" secret to this box");

  const typo = selectScanVisionBackend({ BBX_SCAN_VISION: "gemnii" }, { via: "direct", apiKey: "placeholder-gemini-key" });
  t.check(typo.ok ? "ok" : typo.error, "BBX_SCAN_VISION=gemnii is not a valid backend (valid: claude, gemini)");

  // A key present but empty is still "no key" — the same fail-closed answer:

  const emptyKey = selectScanVisionBackend({ BBX_SCAN_VISION: "gemini" }, { via: "direct", apiKey: "" });
  t.check(emptyKey.ok, false);
});
