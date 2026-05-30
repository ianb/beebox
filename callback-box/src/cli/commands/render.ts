/**
 * cb render - Render a frontend page to HTML via React SSR.
 *
 * Standalone script: fetches data from the box filesystem, renders
 * the React components, and prints clean HTML to stdout.
 *
 * Usage:
 *   cb render <boxDir> <route> [--selector=<css>] [--raw]
 *   cb render ~/src/boxes/test1 /dashboard --selector=".attention-cards"
 */

import { Command } from "commander";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../../lib/package-root.js";

/** Commander accumulator for repeatable options */
function collect(val: string, acc: string[]): string[] {
  acc.push(val);
  return acc;
}

export const renderCommand = new Command("render")
  .description("Render a frontend page to HTML (SSR)")
  .argument("<boxDir>", "Path to the box directory")
  .argument("[route]", "Route path to render (e.g., /dashboard, /chat)", "/")
  .option("-s, --selector <css>", "CSS selector to extract specific elements")
  .option("--raw", "Include scripts and styles in output")
  .option("--list-states", "List available machine states and scenarios for the route")
  .option("--scenario <name>", "Render with a named scenario (e.g., streaming, empty)")
  .option("--machine <id=state>", "Override a machine state (e.g., chat=streaming)", collect, [])
  .option("--mock <path=json>", "Override tRPC query data (e.g., status.status={...})", collect, [])
  .action(async (...actionArgs: unknown[]) => {
    // Commander passes (boxDir, route, options, command) — extract what we need
    const boxDir = actionArgs[0] as string;
    const route = actionArgs[1] as string;
    const options = actionArgs[2] as {
      selector?: string;
      raw?: boolean;
      listStates?: boolean;
      scenario?: string;
      machine?: string[];
      mock?: string[];
    };

    const projectDir = PACKAGE_ROOT;
    const renderScript = path.join(projectDir, "src/frontend/src/ssr/render.tsx");

    const ssrLoader = path.join(projectDir, "src/frontend/src/ssr/register-loader.mjs");

    const args = [
      "--import", "tsx",
      "--import", ssrLoader,
      renderScript,
      path.resolve(boxDir),
      route,
    ];

    if (options.selector) {
      args.push("--selector", options.selector);
    }
    if (options.raw) {
      args.push("--raw");
    }
    if (options.listStates) {
      args.push("--list-states");
    }
    if (options.scenario) {
      args.push("--scenario", options.scenario);
    }
    for (const m of options.machine ?? []) {
      args.push("--machine", m);
    }
    for (const m of options.mock ?? []) {
      args.push("--mock", m);
    }

    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      cwd: projectDir,
      env: {
        ...process.env,
        // Use the frontend tsconfig so JSX resolves to React (not cardworks)
        TSX_TSCONFIG_PATH: path.join(projectDir, "src/frontend/tsconfig.json"),
      },
    });

    child.on("exit", (code) => {
      process.exit(code ?? 1);
    });
  });
