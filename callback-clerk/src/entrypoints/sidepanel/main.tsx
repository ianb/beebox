import React from "react";
import ReactDOM from "react-dom/client";
import { SidepanelApp } from "../../ui/sidepanel-app.js";
import "../../styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SidepanelApp />
  </React.StrictMode>
);
