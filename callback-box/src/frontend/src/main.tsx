import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { TrpcProvider } from "./lib/trpc/provider";
import { createAppRouter } from "./router";
import { LightboxProvider } from "./components/LightboxProvider";
import { ToastViewport } from "./components/ui/ToastViewport";
import "./index.css";
import "./renderers/setup";
import { registerBuiltinFileTypes } from "./file-types";
import { withBase } from "./api";
import { invariant } from "./lib/invariant";

registerBuiltinFileTypes();

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
