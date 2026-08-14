import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router.js";
import { WorkstreamsApiProvider } from "./trpc.js";
import "./styles.css";

const root = document.getElementById("root");
class MissingRootError extends Error {
  constructor() { super("The workstreams application requires its #root mount point."); this.name = "MissingRootError"; }
}
if (!root) throw new MissingRootError();
ReactDOM.createRoot(root).render(<WorkstreamsApiProvider><RouterProvider router={router} /></WorkstreamsApiProvider>);
