/**
 * Keep the test suite away from the developer's real Codex state.
 *
 * Loaded by `.taprc`'s `node-arg` in EVERY test process, for the same reason
 * as `isolate-secret-store.ts`: `ensureCodexPluginInstalled()` mutates GLOBAL
 * machine state — it registers the `beebox` plugin marketplace in
 * `~/.codex/config.toml` with this checkout's path as the source, and
 * re-points an existing registration whenever the path differs.
 *
 * Exactly one test reaches it (`test/core/chat-start-choice.doctest.md`
 * records a codex-engine session start, whose husk reads a snippet title,
 * which opens the real Codex history app-server). That was enough: the hourly
 * `full-suite` schedule runs in a temp checkout, so the run re-pointed the
 * marketplace at a directory it then deleted, and every `codex plugin …`
 * command on the machine failed with "marketplace root does not contain a
 * supported manifest" until the next hour re-broke it. Isolation has to be the
 * process default rather than something one test remembers, because the reach
 * is invisible from the test that triggers it.
 *
 * The home is per-checkout and stable, not a per-process `mkdtemp`: a fresh
 * home would reinstall the plugin on every run and litter the temp dir, and a
 * machine-wide shared one would inherit exactly the dangling-path problem this
 * exists to prevent (a temp checkout's registration outliving the checkout).
 * Living inside the checkout means a deleted checkout takes its home with it.
 *
 * The override is unconditional, unlike its siblings: nothing in the suite
 * wants its own Codex home, and an inherited `CODEX_HOME` — a developer's
 * shell, a launchd job's environment — would silently be a REAL one, which is
 * exactly the state this guards against. "Isolate unless told otherwise" would
 * be an opt-out nobody asks for and an escape hatch everybody inherits.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";

const home = join(PACKAGE_ROOT, ".codex-test-home");
mkdirSync(home, { recursive: true });
process.env["CODEX_HOME"] = home;
