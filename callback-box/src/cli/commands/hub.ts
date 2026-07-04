/**
 * `cb hub` — the multi-box parent process (Track D, chunk D1 in
 * `docs/plans/boxes-as-packages-v2.md`): supervision + routing + health, no
 * auth changes (children keep doing their own in-process auth exactly as
 * today — this works because cookies ride the same origin through the
 * proxy, precisely how the monorepo dev router already behaves for
 * `/main/<box>/...` vs `/<worktree>/<box>/...`).
 */

import { Command } from "commander";
import * as crypto from "node:crypto";
import { loadHubConfig, defaultHubConfigPath, HubConfigError } from "../../hub/hub-config.js";
import { Supervisor, resolveBoxRoot } from "../../hub/supervisor.js";
import { createHubServer, type HubHealth } from "../../hub/hub-server.js";
import type { BoxSpec } from "../../webapp/server-types.js";

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** No strong precedent for a hub default port (it's a new, prod-only
 *  concept distinct from the dev router's 3210) — chosen simply to avoid
 *  the box server's own `DEFAULT_PORT` (3210) and common dev ports. */
const DEFAULT_HUB_PORT = 4310;

export const hubCommand = new Command("hub")
  .description("Start the hub: supervises per-box processes and routes /<slug>/... to them")
  .option("-c, --config <path>", "Path to hub.json (default: ~/.config/cb/hub.json)")
  .action(async (options: { config?: string }) => {
    const configPath = options.config ?? defaultHubConfigPath();

    let config;
    try {
      config = await loadHubConfig(configPath);
    } catch (e) {
      if (e instanceof HubConfigError) {
        console.error(e.message);
        process.exit(1);
      }
      throw e;
    }

    const port = config.port ?? DEFAULT_HUB_PORT;
    const host = config.host ?? "127.0.0.1";

    // Fresh per boot -- never persisted, never logged. The only channels
    // that see it are each child's env (Supervisor) and the hub's own
    // header-injection logic (createHubServer). See auth.ts's isHubMode.
    const hubSecret = crypto.randomBytes(32).toString("hex");

    const supervisor = new Supervisor({ config, hubSecret });
    await supervisor.startAll();

    // Best-effort: this list only feeds the hub's own login surface
    // (/auth/me's accessible-boxes list) and the box picker (D3), so a
    // misconfigured entry here must not crash the whole hub -- the
    // supervisor already handles that box's own resolution failure
    // gracefully (it's reported "unhealthy" via getStatuses()/healthz), and
    // this list is separately best-effort so a box that never came up is
    // simply omitted from what login/the picker can name.
    const boxEntries = await Promise.all(
      Object.entries(config.boxes).map(async ([slug, entry]): Promise<BoxSpec | undefined> => {
        try {
          return { slug, boxRoot: await resolveBoxRoot(entry.path) };
        } catch (e) {
          console.error(`Could not resolve box root for "${slug}" (${entry.path}): ${describeError(e)}`);
          return undefined;
        }
      }),
    );
    const boxes: BoxSpec[] = boxEntries.filter((box): box is BoxSpec => box !== undefined);

    const getHealth = (): HubHealth => ({ status: "ok", boxes: supervisor.getStatuses() });
    // The hub's own base URL -- see hub-server.ts's `baseUrl` doc comment for
    // why this must be threaded in rather than letting the auth routes fall
    // back to the box server's unrelated default port.
    const baseUrl = `http://${host}:${port}`;
    const server = await createHubServer({ endpoints: supervisor, getHealth, hubSecret, boxes, baseUrl });

    let shuttingDown = false;
    const shutdown = async (signal: string): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\nReceived ${signal}, shutting down hub...`);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await supervisor.stopAll();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    // SIGHUP is "config reload" for the crash-loop latch (see Supervisor.reloadUnhealthy) —
    // it does NOT re-read hub.json; adding/removing boxes still needs a full restart.
    process.on("SIGHUP", () => supervisor.reloadUnhealthy());

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve());
    });
    console.log(`Hub running at http://${host}:${port} (config: ${config.configPath})`);
    for (const slug of Object.keys(config.boxes)) {
      console.log(`  ${slug}: http://${host}:${port}/${slug}/`);
    }
  });
