import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { TrpcProvider } from "../lib/trpc/provider";
import { createAppRouter } from "./router";
import { LightboxProvider } from "../components/LightboxProvider";
import { ToastViewport } from "../components/ui/ToastViewport";
import "../index.css";
import "../themes/materials.css";
import "../themes/card-themes.css";
import "../themes/quote-sheets.css";
import "../themes/card-turn.css";
import "../themes/stock-textures.css";
import "../themes/letter-set.css";
import "../themes/chrome.css";
import "../themes/candy.css";
import "../themes/system-theme-picker.css";
import "../themes/chat-material.css";
import "../themes/interface.css";
import "../themes/expressive.css";
import "../themes/control-shapes.css";
import "../themes/harlequin.css";
import "../themes/electric-playground.css";
import "../themes/daydream.css";
import "../themes/selvedge.css";
import "../themes/footlights.css";
import "../themes/overpass.css";
import "../themes/golden-hour.css";
import "../themes/interlace.css";
import "../themes/blacklight.css";
import "../themes/far-horizon.css";
import { withBase } from "../api";
import { invariant } from "@shared/invariant";
import { installUiScanHook } from "../lib/ui-scan/window-hook";
import { installRenderers } from "../renderers.js";
import { markFirstLoad } from "../lib/first-load-marks";
import { FIRST_LOAD_MARKS } from "@shared/first-load-marks";

// Every static import above has evaluated: the entry script is loaded.
markFirstLoad(FIRST_LOAD_MARKS.entry);

/**
 * Wires up the built-in file-type list UI (`file-types/builtins.ts`).
 * Imported dynamically, not statically: `file-types/builtins.tsx` has a
 * Vite-only `@schemas/*.list-entry` alias import (see its header) that does
 * not resolve outside Vite, so a static import here would break any doctest
 * that reaches this module. `installRenderers` (`renderers.ts`) has no such
 * alias and is imported statically above; the layout check no longer
 * misclassifies a registry-declaring module as a private two-file unit
 * just because one entry imports it alone, so this split is safe.
 */
async function bootstrapFileTypeRegistrations(): Promise<void> {
  installRenderers();
  const { registerBuiltinFileTypes } = await import("../file-types/builtins.js");
  registerBuiltinFileTypes();
}

/**
 * Top-level await isn't available at this build's browser targets (esbuild:
 * "chrome87"/"safari14"/...), so the async bootstrap step runs inside this
 * IIFE instead; rendering waits for it exactly as the old synchronous
 * side-effect import did.
 */
async function boot(): Promise<void> {
  await bootstrapFileTypeRegistrations();
  installUiScanHook();

  const router = createAppRouter();

  const rootEl = document.getElementById("root");
  invariant(rootEl !== null, "index.html must define a #root element");

  markFirstLoad(FIRST_LOAD_MARKS.render);

  ReactDOM.createRoot(rootEl).render(
    <TrpcProvider>
      <LightboxProvider>
        <RouterProvider router={router} />
        <ToastViewport />
      </LightboxProvider>
    </TrpcProvider>
  );

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(withBase("/sw.js")).catch((e: unknown) => {
      console.error("Service worker registration failed:", e);
    });
  }
}

boot().catch((e: unknown) => {
  console.error("App bootstrap failed:", e);
});
