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
import "../themes/chrome.css";
import "../themes/system-theme-picker.css";
import "../themes/chat-material.css";
import "../themes/interface.css";
import { withBase } from "../api";
import { invariant } from "@shared/invariant";
import { installUiScanHook } from "../lib/ui-scan/window-hook";

/**
 * Wires up both file-type dispatch tables `file-type-registry.ts` backs: the
 * renderer registry (`renderers.ts`) and the built-in file-type list UI
 * (`file-types/builtins.ts`). Imported dynamically, not statically: this
 * pulls in all 31 renderer modules' full component graphs, plus
 * `file-types/builtins.ts`'s Vite-only `@schemas/*.list-entry` alias import
 * (see its header) — neither resolves outside Vite, so a static import here
 * would break every doctest that reaches `file-type-registry.ts`'s
 * lightweight dispatch functions via the plain tsx/root-tsconfig runtime.
 * Lives inline in this entry (the app's only caller) rather than as its own
 * module in `src/frontend/src/`, which would make it `renderers.ts`'s sole
 * sibling importer and misclassify the registry as a private two-file unit
 * (rule 5) when rule 4 requires it stay at `src/frontend/src/renderers.ts`.
 */
async function bootstrapFileTypeRegistrations(): Promise<void> {
  const { installRenderers } = await import("../renderers.js");
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
