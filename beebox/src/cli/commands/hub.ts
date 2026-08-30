/**
 * `bbx hub` — the multi-box parent process (Track D, chunk D1 in
 * `docs/implemented-plans/boxes-as-packages-v2.md`): supervision + routing + health, no
 * auth changes (children keep doing their own in-process auth exactly as
 * today — this works because cookies ride the same origin through the
 * proxy, precisely how the monorepo dev router already behaves for
 * `/main/<box>/...` vs `/<worktree>/<box>/...`).
 */

import { Command } from "commander";
import * as crypto from "node:crypto";
import {
  loadHubConfig,
  defaultHubConfigPath,
  HubConfigError,
  DEFAULT_HUB_PORT,
  DEFAULT_HUB_HOST,
} from "../../hub/hub-config.js";
import {
  planAddBoxToHubConfig,
  applyAddBoxPlan,
  describeAddBoxPlan,
  HubConfigEditError,
} from "../../hub/hub-config-edit.js";
import { Supervisor } from "../../hub/supervisor.js";
import { resolveBoxRoot } from "../../hub/child-spawn.js";
import { createHubServer, type HubHealth } from "../../hub/hub-server.js";
import { hubVerdict } from "../../hub/hub-health.js";
import { getRootDiskHealth } from "../../hub/disk-health.js";
import { loadEnv, hubEnvSchema } from "../../lib/env.js";
import { getPublicUrl } from "../../lib/public-url.js";
import { maybeArmFirstRunSetup } from "../../webapp/setup-token.js";
import type { BoxSpec } from "../../webapp/server-types.js";

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * `bbx hub add-box <slug> <path>` — register a box with the hub's routing
 * table. This is the supported alternative to hand-editing `hub.json`; see
 * `src/hub/hub-config-edit.ts` for why the edit is planned-then-written.
 * `deploy/add-box.sh` drives it (twice: `--dry-run` as a preflight before it
 * clones anything, then for real).
 */
function registerAddBoxSubcommand(parent: Command): void {
  const addBox = parent
    .command("add-box")
    .description("Register a box with the hub's routing table (hub.json)")
    .argument("<slug>", "URL prefix the box is served under")
    .argument("<path>", "Path to the box (package root or content dir)")
    .option("-c, --config <path>", "Path to hub.json (default: ~/.config/beebox/hub.json)")
    .option("--dry-run", "Validate and print what would change, without writing");

  // Options come from `.opts()` rather than the action's third parameter:
  // the ruleset caps a function at two positional parameters.
  //
  // `--config` is read from BOTH commands because `bbx hub` declares the same
  // flag: commander binds a repeated option to the PARENT unless positional
  // options are enabled program-wide, so `bbx hub add-box … --config X` lands
  // on `hub`, not on `add-box`. Both spellings mean the same file, so taking
  // whichever one holds a value is correct — and it avoids silently falling
  // back to the default config when the operator clearly named one. Passing it
  // twice resolves last-wins, since both land on the parent; that is ordinary
  // CLI behavior, and the command prints the config path it acted on either
  // way, so the operator sees which file was edited.
  addBox.action(async (slug: string, boxPath: string) => {
    const options = addBox.opts<{ config?: string; dryRun?: boolean }>();
    const parentOptions = parent.opts<{ config?: string }>();
    const configPath = options.config ?? parentOptions.config ?? defaultHubConfigPath();
    let plan;
    try {
      plan = await planAddBoxToHubConfig({ configPath, slug, boxPath });
    } catch (e) {
      if (e instanceof HubConfigEditError || e instanceof HubConfigError) {
        console.error(e.message);
        process.exit(1);
      }
      throw e;
    }

    if (options.dryRun) {
      console.log(`[dry-run] ${describeAddBoxPlan(plan)}`);
      if (plan.action === "added") {
        console.log("[dry-run] Then: systemctl restart beebox-hub (hub.json does not hot-reload)");
      }
      return;
    }

    await applyAddBoxPlan(plan);
    console.log(describeAddBoxPlan(plan));
    if (plan.action === "added") {
      console.log("Restart the hub to serve it: systemctl restart beebox-hub");
    }
  });
}

export const hubCommand = new Command("hub")
  .description("Start the hub: supervises per-box processes and routes /<slug>/... to them")
  .option("-c, --config <path>", "Path to hub.json (default: ~/.config/beebox/hub.json)")
  .action(async (options: { config?: string }) => {
    // Validate the hub's environment before it reads any of it (Track D.8):
    // a malformed session secret / networking var fails loudly here, redacted.
    const envConfig = loadEnv(hubEnvSchema);
    // TODO(env-migration): the supervisor still transports validated child
    // configuration through process.env.
    if (envConfig.BBX_DEV_SURFACES === undefined) delete process.env.BBX_DEV_SURFACES;

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
    const host = config.host ?? DEFAULT_HUB_HOST;

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

    const getHealth = (): HubHealth => {
      const statuses = supervisor.getStatuses();
      return { status: hubVerdict(statuses), boxes: statuses };
    };
    // The hub's own base URL -- see hub-server.ts's `baseUrl` doc comment for
    // why this must be threaded in rather than letting the auth routes fall
    // back to the box server's unrelated default port.
    const baseUrl = `http://${host}:${port}`;

    // First-run setup: the hub is the fleet login host, so with auth required
    // and no owner yet it prints the one-time setup claim link too. Silent once
    // an owner exists, including an OAuth-only owner with no local account.
    // `bbx hub` never enables open access, so auth is always required here.
    maybeArmFirstRunSetup({ publicUrl: getPublicUrl(baseUrl), openAccess: false });

    const server = await createHubServer({
      endpoints: supervisor,
      getHealth,
      getDiskHealth: getRootDiskHealth,
      hubSecret,
      boxes,
      baseUrl,
    });

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

registerAddBoxSubcommand(hubCommand);
