/**
 * Standalone SSR renderer for the callback-box frontend.
 *
 * Usage: node --import tsx render.tsx <boxDir> <route> [options]
 *
 * Options:
 *   --selector=<css>         CSS selector to extract specific elements
 *   --raw                    Include scripts and styles in output
 *   --list-states            List available machine states and scenarios
 *   --scenario=<name>        Render with a named scenario
 *   --machine=<id>=<state>   Override a machine's state (repeatable)
 *   --mock=<path>=<json>     Override tRPC query data (repeatable)
 *
 * Renders a frontend page to HTML using React SSR with pre-fetched tRPC data.
 * Outputs clean HTML to stdout, stripping scripts and styles by default.
 */

// setup MUST be first import — polyfills browser APIs before component imports
import { setRoute } from "./setup";
import * as path from "node:path";
import { renderToString } from "react-dom/server";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { load as cheerioLoad } from "cheerio";
import { trpc } from "../lib/trpc";
import { createAppRouter } from "../router";
import { LightboxProvider } from "../components/LightboxProvider";
import { SSRStateContext, type SSRStateMap } from "../hooks/useSSRMachine";
import { appRouter } from "../../../webapp/trpc/router.js";
import {
  buildSSRStateMap,
  getQueryOverrides,
  formatStateList,
} from "./state-registry";
import type { TrpcContext } from "../../../webapp/trpc/context.js";
import type { Services } from "../../../services/index.js";

// --- Argument parsing ---

interface RenderArgs {
  boxDir: string;
  routePath: string;
  selector: string;
  raw: boolean;
  listStates: boolean;
  scenario: string;
  machineOverrides: Record<string, string>;
  mockOverrides: Record<string, unknown>;
}

function parseArgs(): RenderArgs {
  const args = process.argv.slice(2);
  let selector = "";
  let raw = false;
  let listStates = false;
  let scenario = "";
  const machineOverrides: Record<string, string> = {};
  const mockOverrides: Record<string, unknown> = {};

  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--raw") {
      raw = true;
    } else if (arg === "--list-states") {
      listStates = true;
    } else {
      const parsed = parseNamedArg(args, i);
      if (parsed) {
        i = parsed.nextIndex;
        switch (parsed.name) {
          case "selector":
          case "s":
            selector = parsed.value;
            break;
          case "scenario":
            scenario = parsed.value;
            break;
          case "machine":
            parsePairInto(parsed.value, machineOverrides);
            break;
          case "mock":
            parseMockInto(parsed.value, mockOverrides);
            break;
          default:
            positional.push(arg);
        }
      } else {
        positional.push(arg);
      }
    }
  }

  const boxDir = positional[0] || "";
  const routePath = positional[1] || "/";

  if (!boxDir) {
    console.error(
      "Usage: cb render <boxDir> <route> [--selector=<css>] [--raw]\n" +
        "       [--list-states] [--scenario=<name>] [--machine=<id>=<state>] [--mock=<path>=<json>]",
    );
    process.exit(1);
  }

  return {
    boxDir: path.resolve(boxDir),
    routePath,
    selector,
    raw,
    listStates,
    scenario,
    machineOverrides,
    mockOverrides,
  };
}

// --- Arg parsing helpers ---

interface NamedArg {
  name: string;
  value: string;
  nextIndex: number;
}

function parseNamedArg(args: string[], i: number): NamedArg | null {
  const arg = args[i]!;
  for (const name of ["selector", "s", "scenario", "machine", "mock"]) {
    const prefix = `--${name}=`;
    if (arg.startsWith(prefix)) {
      return { name, value: arg.slice(prefix.length), nextIndex: i };
    }
    if (arg === `--${name}` || (name === "s" && arg === "-s")) {
      return { name, value: args[i + 1] || "", nextIndex: i + 1 };
    }
  }
  return null;
}

function parsePairInto(val: string, target: Record<string, string>): void {
  const eqIdx = val.indexOf("=");
  if (eqIdx > 0) {
    target[val.slice(0, eqIdx)] = val.slice(eqIdx + 1);
  }
}

function parseMockInto(val: string, target: Record<string, unknown>): void {
  const eqIdx = val.indexOf("=");
  if (eqIdx > 0) {
    try {
      target[val.slice(0, eqIdx)] = JSON.parse(val.slice(eqIdx + 1));
    } catch (_e) {
      // The error message already reports the offending value; we exit anyway.
      console.error(`Invalid JSON for --mock: ${val.slice(eqIdx + 1)}`);
      process.exit(1);
    }
  }
}

// --- tRPC query key helpers ---

function queryKey(procedurePath: string[], input?: unknown): unknown[] {
  const key: unknown[] = [procedurePath];
  if (input !== undefined) {
    key.push({ input, type: "query" });
  } else {
    key.push({ type: "query" });
  }
  return key;
}

// --- Data prefetching ---

interface PrefetchOptions {
  boxRoot: string;
  slug: string;
  routePath: string;
}

async function prefetchData(opts: PrefetchOptions): Promise<{ queryClient: QueryClient; caller: ReturnType<typeof appRouter.createCaller> }> {
  const { boxRoot, slug, routePath } = opts;
  const ctx: TrpcContext = {
    boxRoot,
    boxSlug: slug,
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {} as Services,
  };

  const caller = appRouter.createCaller(ctx);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  });

  // Common queries — always fetch, ignore failures
  const queries: Array<{ key: unknown[]; fn: () => Promise<unknown> }> = [
    { key: queryKey(["status", "status"]), fn: () => caller.status.status() },
    { key: queryKey(["status", "questions"]), fn: () => caller.status.questions() },
    { key: queryKey(["status", "activity"], { count: 15 }), fn: () => caller.status.activity({ count: 15 }) },
    { key: queryKey(["scheduler", "schedules"]), fn: () => caller.scheduler.schedules() },
    { key: queryKey(["scheduler", "log"], { limit: 20, event: "tick" }), fn: () => caller.scheduler.log({ limit: 20, event: "tick" }) },
  ];

  // Route-specific queries
  const pagePath = routePath.replace(/^\//, "");
  if (pagePath.startsWith("browse/") || pagePath === "browse") {
    const browsePath = pagePath.slice("browse/".length) || undefined;
    queries.push({ key: queryKey(["status", "browse"], { path: browsePath }), fn: () => caller.status.browse({ path: browsePath }) });
  } else if (pagePath.startsWith("history")) {
    queries.push({ key: queryKey(["status", "activity"], { count: 20 }), fn: () => caller.status.activity({ count: 20 }) });
  }

  // Fetch all in parallel, ignore failures
  await Promise.all(
    queries.map(async ({ key, fn }) => {
      try {
        const data = await fn();
        queryClient.setQueryData(key, data);
      } catch (e) {
        // Non-fatal: the client will refetch this query on hydration. Surface
        // it so SSR-time backend problems are visible in server logs.
        console.warn("SSR prefetch failed; client will refetch:", e);
      }
    }),
  );

  return { queryClient, caller };
}

// --- HTML post-processing ---

interface PostProcessOptions {
  selector: string;
  raw: boolean;
}

function postProcess(html: string, opts: PostProcessOptions): string {
  const $ = cheerioLoad(html);

  if (!opts.raw) {
    $("script").remove();
    $("style").remove();
    $("link[rel='stylesheet']").remove();
  }

  if (opts.selector) {
    const matches = $(opts.selector);
    if (matches.length === 0) {
      return `<!-- No elements matching "${opts.selector}" -->\n`;
    }
    const parts: string[] = [];
    matches.each((_, el) => {
      parts.push($.html(el) || "");
    });
    return parts.join("\n");
  }

  return $.html();
}

// --- Main ---

async function main() {
  const { boxDir, routePath, selector, raw, listStates, scenario, machineOverrides, mockOverrides } =
    parseArgs();

  // --list-states: print available states and scenarios, then exit
  if (listStates) {
    process.stdout.write(formatStateList(routePath) + "\n");
    return;
  }

  const slug = path.basename(boxDir);

  // Set the window.location polyfill to match the actual route
  const fullRoute = `/${slug}${routePath.startsWith("/") ? routePath : "/" + routePath}`;
  setRoute(fullRoute);

  const { queryClient } = await prefetchData({ boxRoot: boxDir, slug, routePath });

  // Build XState machine snapshots — from scenario, explicit overrides, or defaults
  const hasOverrides = scenario || Object.keys(machineOverrides).length > 0;
  let ssrState: SSRStateMap;

  if (hasOverrides) {
    ssrState = buildSSRStateMap(routePath, { scenario, machineOverrides });
  } else {
    ssrState = buildSSRStateMap(routePath);
  }

  // Apply query overrides from --scenario
  if (scenario) {
    const overrides = getQueryOverrides(routePath, scenario);
    if (overrides) {
      for (const [procPath, data] of Object.entries(overrides)) {
        const key = queryKey(procPath.split("."));
        queryClient.setQueryData(key, data);
      }
    }
  }

  // Apply explicit --mock overrides
  for (const [procPath, data] of Object.entries(mockOverrides)) {
    const key = queryKey(procPath.split("."));
    queryClient.setQueryData(key, data);
  }

  // Create a no-op tRPC client (all data is pre-populated in QueryClient)
  const trpcClient = (trpc as unknown as { createClient: (opts: unknown) => unknown }).createClient({
    links: [],
  });

  const memoryHistory = createMemoryHistory({ initialEntries: [fullRoute] });
  const router = createAppRouter({ history: memoryHistory });
  await router.load();

  const html = renderToString(
    <trpc.Provider client={trpcClient as never} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <SSRStateContext.Provider value={ssrState}>
          <LightboxProvider>
            <RouterProvider router={router} />
          </LightboxProvider>
        </SSRStateContext.Provider>
      </QueryClientProvider>
    </trpc.Provider>,
  );

  const output = postProcess(html, { selector, raw });
  process.stdout.write(output + "\n");
}

main().catch((err) => {
  console.error("Render failed:", err);
  process.exit(1);
});
