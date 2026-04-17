import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { TrpcProvider } from "./lib/trpc-provider";
import { createAppRouter } from "./router";
import "./index.css";
import "./renderers/setup";
import { registerBuiltinFileTypes } from "./file-types";

registerBuiltinFileTypes();

const router = createAppRouter();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <TrpcProvider>
    <RouterProvider router={router} />
  </TrpcProvider>
);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}
