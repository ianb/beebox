import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { TrpcProvider } from "./lib/trpc-provider";
import "./index.css";
import "./renderers/setup";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <TrpcProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </TrpcProvider>
);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}
