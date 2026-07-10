/**
 * API adapters — authenticated pass-through to external provider APIs,
 * for frontend use (views, primarily).
 *
 *   ANY /api/adapters/:adapter/<path>  →  <provider base>/<path>
 *
 * The adapter injects the provider's auth header server-side, reading the
 * key from the box's existing connector-secret convention
 * (`config/connectors/<adapter>.secret.json`, `{"apiKey": "..."}`). The
 * key never reaches the browser, and providers that (correctly) refuse
 * CORS become callable from views. Adapters may grow other behaviors
 * (header shaping, path restrictions); v1 is auth + forwarding.
 *
 * LLM calls normally happen server-side (agents, CLI); this is the bridge
 * for interactive frontend surfaces. Requests ride the box's normal auth
 * like every other /api route.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { isRecord } from "../../lib/is-record.js";
import { Readable } from "node:stream";
import { errorMessage } from "../../lib/error-guards.js";

interface AdapterDef {
  /** Default upstream base URL; CB_ADAPTER_BASE_<NAME> overrides (tests). */
  base: string;
  /** Auth header injected from the adapter's secret. */
  authHeader: (key: string) => [name: string, value: string];
}

const ADAPTERS: Record<string, AdapterDef> = {
  replicate: {
    base: "https://api.replicate.com",
    authHeader: (key) => ["authorization", `Bearer ${key}`],
  },
  mistral: {
    base: "https://api.mistral.ai",
    authHeader: (key) => ["authorization", `Bearer ${key}`],
  },
  anthropic: {
    base: "https://api.anthropic.com",
    authHeader: (key) => ["x-api-key", key],
  },
  openai: {
    base: "https://api.openai.com",
    authHeader: (key) => ["authorization", `Bearer ${key}`],
  },
};

/** Request headers forwarded upstream; everything else (cookies!) is dropped. */
const FORWARDED_HEADERS = ["content-type", "accept", "prefer", "anthropic-version"];

interface RegisterApiAdapterRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
}

export function registerApiAdapterRoutes(options: RegisterApiAdapterRoutesOptions): void {
  const { server, boxRoot } = options;

  server.route<{ Params: { adapter: string; "*": string } }>({
    method: ["GET", "POST", "PUT", "DELETE"],
    url: "/api/adapters/:adapter/*",
    handler: async (request, reply) => {
      const adapterName = request.params.adapter;
      const adapter = ADAPTERS[adapterName];
      if (adapter === undefined) {
        return reply.status(404).send({
          error: `Unknown adapter "${adapterName}" — available: ${Object.keys(ADAPTERS).join(", ")}`,
        });
      }
      const key = await readAdapterKey(boxRoot, adapterName);
      if (key === null) {
        return reply.status(503).send({
          error:
            `No API key for "${adapterName}" — create ` +
            `config/connectors/${adapterName}.secret.json with {"apiKey": "..."}`,
        });
      }

      const base = process.env[`CB_ADAPTER_BASE_${adapterName.toUpperCase()}`] ?? adapter.base;
      const upstreamPath = request.params["*"] || "";
      const query = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
      const url = `${base}/${upstreamPath}${query}`;

      const headers: Record<string, string> = {};
      for (const name of FORWARDED_HEADERS) {
        const value = singleHeader(request, name);
        if (value !== undefined) headers[name] = value;
      }
      const [authName, authValue] = adapter.authHeader(key);
      headers[authName] = authValue;

      const init: RequestInit = { method: request.method, headers };
      if (request.method !== "GET" && request.body !== undefined && request.body !== null) {
        init.body = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
        headers["content-type"] = headers["content-type"] ?? "application/json";
      }

      let upstream: Response;
      try {
        upstream = await fetch(url, init);
      } catch (e) {
        return reply.status(502).send({
          error: `Upstream ${adapterName} request failed: ${errorMessage(e)}`,
        });
      }

      void reply.status(upstream.status);
      const contentType = upstream.headers.get("content-type");
      if (contentType !== null) void reply.header("content-type", contentType);
      // Stream the body through (SSE and large responses included).
      if (upstream.body === null) return reply.send();
      return reply.send(Readable.fromWeb(upstream.body));
    },
  });
}

function singleHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Key from config/connectors/<adapter>.secret.json ({"apiKey": "..."}). */
async function readAdapterKey(boxRoot: string, adapterName: string): Promise<string | null> {
  const secretPath = path.join(boxRoot, "config", "connectors", `${adapterName}.secret.json`);
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(secretPath, "utf8"));
    const apiKey = isRecord(parsed) ? parsed["apiKey"] : undefined;
    return typeof apiKey === "string" && apiKey !== "" ? apiKey : null;
  } catch (_e) {
    return null;
  }
}
