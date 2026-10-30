/**
 * pi's network switch, set in this process before any pi module loads: no
 * model-catalog refresh from pi.dev, no ripgrep/fd download from GitHub, no
 * package install. pi reads it at call time, and only "1", "true" or "yes"
 * count for its downloads (`utils/tools-manager.js`), so the value is "1".
 * Imported first by `session.ts`; `grep` and `find` are also never offered,
 * so a lost variable still cannot reach the download path.
 */

process.env.PI_OFFLINE = "1";
