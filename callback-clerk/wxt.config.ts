import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Callback Clerk",
    description: "Browser companion for callback-box",
    permissions: [
      "tabs",
      "storage",
      "sidePanel",
      "contextMenus",
      "scripting",
      "activeTab",
    ],
    // Host access is granted per-origin when the user enables a box —
    // never broadly at install time.
    optional_host_permissions: ["http://*/*", "https://*/*"],
    icons: {
      "16": "/icon-128.png",
      "128": "/icon-128.png",
    },
  },
});
