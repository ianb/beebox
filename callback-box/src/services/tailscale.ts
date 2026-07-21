/**
 * Tailscale engine foundation for `cb tailscale` (Track B of
 * `docs/implemented-plans/tailscale-expose-and-protect.md`).
 *
 * This module owns the injected-dependency seam ({@link TailscaleDeps}), the zod
 * schemas that validate `tailscale` CLI JSON *at the subprocess boundary*,
 * target resolution, and the low-level parsing helpers. The status state machine
 * lives in `tailscale-status.ts`; the fake deps in `tailscale-fake.ts`; the
 * command file is a thin presenter (`src/cli/commands/tailscale.ts`).
 *
 * Fail-closed is the governing rule: every `tailscale ... --json` payload is
 * parsed through a schema and an unrecognized shape becomes its OWN state, never
 * undefined-propagation. The whole machine runs against a fake with no tailnet.
 */

import { execFile } from "node:child_process";
import * as os from "node:os";
import { promisify } from "node:util";
import { z } from "zod";

import { isRecord } from "../lib/is-record.js";

const execFileAsync = promisify(execFile);

// ─── Subprocess + probe injection (mirrors bin/doctor.ts's RunCommand shape;
// defined locally because callback-box must not import from bin/) ────────────

export interface CommandResult {
  /** True iff the OS could spawn the command at all (i.e. it is on PATH). */
  spawned: boolean;
  /** Exit code, or null if the process never spawned or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
}

export type RunCommand = (cmd: string, args: string[]) => Promise<CommandResult>;

/** Result of probing a served HTTP(S) endpoint. */
export interface ProbeResult {
  /** True iff an HTTP response came back at all (any status). */
  reachable: boolean;
  /** HTTP status code, or null when the request never completed. */
  status: number | null;
  /**
   * The response body text, or null when unreachable/unread. Setup reads this
   * from a loopback `/auth/me` probe to classify the target's auth posture
   * (`open` vs `enforced`); the status state machine ignores it. Optional so
   * chunk-1 fakes and callers that only need reachability stay unchanged.
   */
  body?: string | null;
}

export type ProbeEndpoint = (url: string) => Promise<ProbeResult>;

/**
 * Enumerate this host's NON-loopback, non-internal IP addresses. Injected so the
 * non-loopback-bind guard (`classifyTargetPosture`) can be tested with a fake
 * interface list — a server that answers on a public interface must be refused
 * even though it also answers on 127.0.0.1.
 */
export type ListNetworkAddresses = () => string[];

export interface TailscaleDeps {
  run: RunCommand;
  probe: ProbeEndpoint;
  networkInterfaces: ListNetworkAddresses;
}

export function createRealRun(): RunCommand {
  return async (cmd, args) => {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 10000, encoding: "utf8" });
      return { spawned: true, code: 0, stdout, stderr };
    } catch (e) {
      const code = isRecord(e) ? e["code"] : undefined;
      if (code === "ENOENT") return { spawned: false, code: null, stdout: "", stderr: "" };
      const numericCode = typeof code === "number" ? code : null;
      const stdout = isRecord(e) && typeof e["stdout"] === "string" ? e["stdout"] : "";
      const stderr = isRecord(e) && typeof e["stderr"] === "string" ? e["stderr"] : "";
      return { spawned: true, code: numericCode, stdout, stderr };
    }
  };
}

export function createRealProbe(): ProbeEndpoint {
  return async (url) => {
    try {
      const res = await fetch(url, { method: "GET", redirect: "manual" });
      // Body is small (an `/auth/me` JSON) and load-bearing for the auth-posture
      // classification; a body read failure degrades to null, still reachable.
      let body: string | null;
      try {
        body = await res.text();
      } catch (_e) {
        body = null;
      }
      return { reachable: true, status: res.status, body };
    } catch (_e) {
      // Network-level failure (DNS, TLS, connection refused) — the endpoint is
      // simply not reachable; an expected state-machine branch, not a crash.
      return { reachable: false, status: null, body: null };
    }
  };
}

/** Real non-loopback address enumeration: every non-internal interface address. */
export function createRealNetworkInterfaces(): ListNetworkAddresses {
  return () => {
    const out: string[] = [];
    for (const infos of Object.values(os.networkInterfaces())) {
      for (const info of infos ?? []) {
        if (!info.internal) out.push(info.address);
      }
    }
    return out;
  };
}

export function createRealTailscaleDeps(): TailscaleDeps {
  return { run: createRealRun(), probe: createRealProbe(), networkInterfaces: createRealNetworkInterfaces() };
}

// ─── Boundary schemas: only the fields the machine reads, `.passthrough()` so a
// NEW field never trips a parse failure — but a RENAMED/absent required field
// does (the "unrecognized output" state). `status --json`'s marshaler emits
// `BackendState`/`Self`/`CertDomains` WITHOUT `,omitempty` (verified against
// ipn/ipnstate/ipnstate.go) — always present, `null` before the node is up — so
// the KEYS are required (absence ⇒ drift) but `null` values are allowed. Inside
// `Self`, `DNSName`/`TailscaleIPs` are likewise always-emitted members. ────────
const tailscaleStatusSchema = z
  .object({
    // A plain string on purpose: a future BackendState value must NOT fail the
    // schema (that is schema-drift) — it must reach the explicit unknown branch
    // in the state machine (that is value-drift). Two distinct states.
    BackendState: z.string(),
    Self: z
      .object({
        DNSName: z.string(),
        TailscaleIPs: z.array(z.string()).nullable(),
      })
      .passthrough()
      .nullable(),
    CertDomains: z.array(z.string()).nullable(),
  })
  .passthrough();

export type TailscaleStatusJson = z.infer<typeof tailscaleStatusSchema>;

const serveHandlerSchema = z.object({ Proxy: z.string().optional() }).passthrough();

const serveWebSchema = z
  .object({ Handlers: z.record(z.string(), serveHandlerSchema).optional() })
  .passthrough();

/**
 * The `tailscale serve status --json` payload (`ipn.ServeConfig`). `Foreground`
 * is a map of IPN-bus session id → a nested `ServeConfig`: running `tailscale
 * funnel` WITHOUT `--bg` writes the funnel allowance into one of these instead
 * of the top level, so the no-Funnel invariant must inspect BOTH (mirrors
 * Tailscale's own `ServeConfigView.HasFunnelForTarget`). The schema is therefore
 * recursive.
 */
export interface ServeConfigJson {
  Web?: Record<string, z.infer<typeof serveWebSchema>> | undefined;
  AllowFunnel?: Record<string, boolean> | undefined;
  Foreground?: Record<string, ServeConfigJson> | undefined;
}

const serveConfigSchema: z.ZodType<ServeConfigJson> = z.lazy(() =>
  z
    .object({
      Web: z.record(z.string(), serveWebSchema).optional(),
      AllowFunnel: z.record(z.string(), z.boolean()).optional(),
      Foreground: z.record(z.string(), serveConfigSchema).optional(),
    })
    .passthrough(),
);

/**
 * Whether a Funnel allowance covers `hostPort`, checking the top-level
 * `AllowFunnel` AND every foreground config — the shape `tailscale funnel`
 * (no `--bg`) produces. Mirrors `ServeConfigView.HasFunnelForTarget`.
 */
export function hasFunnelForTarget(serve: ServeConfigJson, hostPort: string): boolean {
  if (serve.AllowFunnel?.[hostPort] === true) return true;
  for (const conf of Object.values(serve.Foreground ?? {})) {
    if (conf.AllowFunnel?.[hostPort] === true) return true;
  }
  return false;
}

// ─── BackendState: the seven known ipn.State values plus a fail-closed unknown
// branch (a "six states" schema would misreport InUseOtherUser). ─────────────

export const KNOWN_BACKEND_STATES = [
  "NoState",
  "NeedsLogin",
  "NeedsMachineAuth",
  "Stopped",
  "Starting",
  "Running",
  "InUseOtherUser",
] as const;

export type BackendState = (typeof KNOWN_BACKEND_STATES)[number];

export function toBackendState(raw: string): BackendState | null {
  for (const state of KNOWN_BACKEND_STATES) {
    if (state === raw) return state;
  }
  return null;
}

// ─── Target: for chunk 1 the operator names an explicit loopback port. With no
// flag we refuse and say so (the plan's refuse-and-list; discovery is a later
// chunk). ────────────────────────────────────────────────────────────────────

export interface TailscaleTarget {
  port: number;
}

export type TargetResolution =
  | { ok: true; target: TailscaleTarget }
  | { ok: false; message: string };

export function resolveTarget(target: string | undefined): TargetResolution {
  if (target === undefined || target.trim() === "") {
    return {
      ok: false,
      message:
        "no --target given. Pass the loopback port of the auth-gated cb serve/hub to expose, e.g. `--target 3210`. " +
        "The dev router is never a valid target.",
    };
  }
  const port = Number(target.trim());
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { ok: false, message: `invalid --target '${target}': expected a loopback port number (1-65535).` };
  }
  return { ok: true, target: { port } };
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; message: string };

export function parseStatusJson(raw: string): ParseOutcome<TailscaleStatusJson> {
  return safeParseJson(raw, tailscaleStatusSchema);
}

/** `tailscale serve status --json` prints an empty ServeConfig as `{}` or `null`. */
export function parseServeConfig(raw: string): ParseOutcome<ServeConfigJson> {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "null") return { ok: true, value: {} };
  return safeParseJson(trimmed, serveConfigSchema);
}

function safeParseJson<T>(raw: string, schema: z.ZodType<T>): ParseOutcome<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, message: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    };
  }
  return { ok: true, value: parsed.data };
}

/** Tailscale's DNSName carries a trailing dot; strip it for URLs and matching. */
export function normalizeDnsName(dnsName: string): string {
  return dnsName.replace(/\.$/, "");
}

/**
 * Extract the port from a serve Proxy target IFF it points at loopback. Accepts
 * a bare port ("3210" ⇒ localhost) or a URL/host:port whose host is a loopback
 * literal. Returns null for a non-loopback target (a drift we must NOT treat as
 * a match).
 */
export function loopbackProxyPort(proxy: string): number | null {
  const trimmed = proxy.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
  } catch (_e) {
    return null;
  }
  const isLoopback =
    url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (!isLoopback || url.port === "") return null;
  return Number(url.port);
}
