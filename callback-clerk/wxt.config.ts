import { defineConfig } from "wxt";

// Date-stamp the build so chrome://extensions shows when the loaded copy was
// last built. Chrome caps each version component at 65535, so YYMMDD (260613)
// won't fit in one part — split it: 0.1.<YY>.<MMDD> (e.g. 0.1.26.613). Each
// part stays under 65535 and the value increases monotonically over time, so
// Chrome still treats a newer build as an upgrade. `version_name` is a
// free-form label Chrome displays as-is — that's where the plain date lives.
// Evaluated at build time (this config is loaded fresh per `wxt build`).
const built = new Date();
const pad = (n: number): string => String(n).padStart(2, "0");
const buildDate = `${built.getFullYear()}-${pad(built.getMonth() + 1)}-${pad(built.getDate())}`;
const dateVersion =
  `0.1.${built.getFullYear() % 100}.` +
  `${(built.getMonth() + 1) * 100 + built.getDate()}`;

export default defineConfig({
  srcDir: "src",
  outDir: "dist",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Callback Clerk",
    description: "Browser companion for callback-box",
    version: dateVersion,
    version_name: `0.1 · built ${buildDate}`,
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
