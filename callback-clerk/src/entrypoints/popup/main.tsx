import React from "react";
import ReactDOM from "react-dom/client";
import { PopupApp } from "../../ui/popup-app.js";
import { invariant } from "../../domain/invariant.js";
import "../../styles/global.css";

const rootEl = document.getElementById("root");
invariant(rootEl !== null, "popup.html must define a #root element");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>
);
