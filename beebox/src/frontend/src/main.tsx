import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { TrpcProvider } from "./lib/trpc/provider";
import { createAppRouter } from "./router";
import { LightboxProvider } from "./components/LightboxProvider";
import { ToastViewport } from "./components/ui/ToastViewport";
import "./index.css";
import "./themes/materials.css";
import "./themes/card-themes.css";
import "./themes/quote-sheets.css";
import "./themes/card-turn.css";
import "./themes/stock-textures.css";
import "./themes/chrome.css";
import "./themes/system-theme-picker.css";
import "./themes/chat-material.css";
import "./themes/interface.css";
import "./renderers/setup";
import { registerBuiltinFileTypes } from "./file-types/builtins";
import { withBase } from "./api";
import { invariant } from "@shared/invariant";
import { installUiScanHook } from "./lib/ui-scan/window-hook";

registerBuiltinFileTypes();
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
