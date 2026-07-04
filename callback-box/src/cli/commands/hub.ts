/**
 * `cb hub` — the multi-box parent process (Track D, chunk D1 in
 * `docs/plans/boxes-as-packages-v2.md`): supervision + routing + health, no
 * auth changes (children keep doing their own in-process auth exactly as
 * today — this works because cookies ride the same origin through the
 * proxy, precisely how the monorepo dev router already behaves for
 * `/main/<box>/...` vs `/<worktree>/<box>/...`).
 */

import { Command } from "commander";
import { loadHubConfig, defaultHubConfigPath, HubConfigError } from "../../hub/hub-config.js";
import { Supervisor } from "../../hub/supervisor.js";
import { createHubServer, type HubHealth } from "../../hub/hub-server.js";

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

    const supervisor = new Supervisor(config);
    await supervisor.startAll();

    const getHealth = (): HubHealth => ({ status: "ok", boxes: supervisor.getStatuses() });
    const server = createHubServer({ endpoints: supervisor, getHealth });

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
