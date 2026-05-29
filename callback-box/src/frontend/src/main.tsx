import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { TrpcProvider } from "./lib/trpc-provider";
import { createAppRouter } from "./router";
import { LightboxProvider } from "./components/LightboxProvider";
import "./index.css";
import "./renderers/setup";
import { registerBuiltinFileTypes } from "./file-types";
import { withBase } from "./api";

registerBuiltinFileTypes();

const router = createAppRouter();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <TrpcProvider>
    <LightboxProvider>
      <RouterProvider router={router} />
    </LightboxProvider>
  </TrpcProvider>
);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(withBase("/sw.js"));
}
