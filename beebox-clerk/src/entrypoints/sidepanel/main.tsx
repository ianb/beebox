import React from "react";
import ReactDOM from "react-dom/client";
import { SidepanelApp } from "../../ui/sidepanel-app.js";
import { invariant } from "../../domain/invariant.js";
import "../../styles/global.css";

const rootEl = document.getElementById("root");
invariant(rootEl !== null, "sidepanel.html must define a #root element");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <SidepanelApp />
  </React.StrictMode>
);
