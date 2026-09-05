import React from "react";
import ReactDOM from "react-dom/client";
import { SettingsApp } from "../../ui/settings-app.js";
import { invariant } from "../../domain/invariant.js";
import "../../styles/global.css";

const rootEl = document.getElementById("root");
invariant(rootEl !== null, "options.html must define a #root element");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <SettingsApp />
  </React.StrictMode>
);
