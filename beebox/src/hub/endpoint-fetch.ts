/**
 * One request to an endpoint, whichever way it is reached: a TCP origin or a
 * Unix socket. `fetch` has no socket form, and the hub asks a box small
 * questions in two places (the readiness probe and the canary's `/healthz`),
 * so both go through here.
 */

import http from "node:http";
import type { Endpoint } from "./endpoints.js";

export interface EndpointResponse {
  status: number;
  body: string;
}

export function fetchEndpoint(
  endpoint: Endpoint,
  request: { path: string; headers?: Record<string, string>; timeoutMs: number },
): Promise<EndpointResponse> {
  const target: http.RequestOptions = endpoint.socketPath === undefined
    ? { ...hostPort(endpoint.origin) }
    : { socketPath: endpoint.socketPath };
  return new Promise((resolve, reject) => {
    const req = http.request(
      { ...target, path: request.path, method: "GET", timeout: request.timeoutMs, headers: request.headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new EndpointTimeoutError(endpoint.slug, request.timeoutMs));
    });
    req.end();
  });
}

function hostPort(origin: string): { host: string; port: number } {
  const url = new URL(origin);
  return { host: url.hostname, port: Number(url.port) };
}

class EndpointTimeoutError extends Error {
  constructor(slug: string, timeoutMs: number) {
    super(`box/${slug} did not answer within ${String(timeoutMs)} ms`);
    this.name = "EndpointTimeoutError";
  }
}
