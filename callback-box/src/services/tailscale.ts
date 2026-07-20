/**
 * Tailscale engine foundation for `cb tailscale` (Track B chunk 1 of
 * `docs/plans/tailscale-expose-and-protect.md`).
 *
 * This module owns the injected-dependency seam ({@link TailscaleDeps}, modeled
 * on `bin/doctor.ts`'s `DoctorDeps`), the zod schemas that validate `tailscale`
 * CLI JSON *at the subprocess boundary*, target resolution, and the low-level
 * parsing helpers. The status state machine lives in `tailscale-status.ts`; the
 * command file (`src/cli/commands/tailscale.ts`) is a thin presenter — the same
 * split `health.ts` has over `health-box.ts`.
 *
 * Fail-closed is the governing rule (the OpenClaw-CVE bug class the plan calls
 * out): every `tailscale ... --json` payload is parsed through a schema and an
 * unrecognized shape becomes its OWN state, never undefined-propagation.
 *
 * Testability: `TailscaleDeps` injects the subprocess runner and an HTTP probe,
 * so the whole state machine runs against {@link createFakeTailscaleDeps} with
 * no tailnet — see `test/services/tailscale.doctest.md`.
 */

import { execFile } from "node:child_process";
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
}

export type ProbeEndpoint = (url: string) => Promise<ProbeResult>;

export interface TailscaleDeps {
  run: RunCommand;
  probe: ProbeEndpoint;
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
      return { reachable: true, status: res.status };
    } catch (_e) {
      // Network-level failure (DNS, TLS, connection refused) — the endpoint is
      // simply not reachable; an expected state-machine branch, not a crash.
      return { reachable: false, status: null };
    }
  };
}

export function createRealTailscaleDeps(): TailscaleDeps {
  return { run: createRealRun(), probe: createRealProbe() };
}

// ─── Fake deps for tests: script the two `tailscale` subcommands plus the
// probe. `status`/`serve` accept either an object (JSON-stringified into
// stdout) or a raw string (to exercise schema-drift / parse failure). ────────

export interface FakeTailscaleOptions {
  /** Default true; false makes every `tailscale` call unspawnable (binary absent). */
  binaryPresent?: boolean;
  /** `tailscale status --json` stdout: an object to serialize, or a raw string. */
  status?: unknown;
  /** `tailscale serve status --json` stdout: an object to serialize, or a raw string. */
  serve?: unknown;
  /** What the injected probe returns for `/auth/me`. */
  probe?: ProbeResult;
}

function stdoutFor(value: unknown): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function createFakeTailscaleDeps(options: FakeTailscaleOptions): TailscaleDeps {
  const binaryPresent = options.binaryPresent ?? true;
  const notSpawned: CommandResult = { spawned: false, code: null, stdout: "", stderr: "" };
  return {
    run: (cmd, args) => {
      if (cmd !== "tailscale" || !binaryPresent) return Promise.resolve(notSpawned);
      const sub = args.join(" ");
      if (sub === "status --json") {
        return Promise.resolve({ spawned: true, code: 0, stdout: stdoutFor(options.status), stderr: "" });
      }
      if (sub === "serve status --json") {
        return Promise.resolve({ spawned: true, code: 0, stdout: stdoutFor(options.serve), stderr: "" });
      }
      return Promise.resolve({ spawned: true, code: 0, stdout: "", stderr: "" });
    },
    probe: () => Promise.resolve(options.probe ?? { reachable: false, status: null }),
  };
}

// ─── Boundary schemas: only the fields the state machine reads, with
// `.passthrough()` so a NEW Tailscale field never trips a parse failure — but a
// RENAMED/absent field the machine depends on does (the distinct "unrecognized
// output" state). ────────────────────────────────────────────────────────────

const tailscaleStatusSchema = z
  .object({
    // A plain string on purpose: a future BackendState value must NOT fail the
    // schema (that is schema-drift) — it must reach the explicit unknown branch
    // in the state machine (that is value-drift). Two distinct states.
    BackendState: z.string(),
    Self: z
      .object({
        DNSName: z.string().optional(),
        TailscaleIPs: z.array(z.string()).nullish(),
      })
      .passthrough()
      .nullish(),
    CertDomains: z.array(z.string()).nullish(),
  })
  .passthrough();

export type TailscaleStatusJson = z.infer<typeof tailscaleStatusSchema>;

const serveHandlerSchema = z.object({ Proxy: z.string().optional() }).passthrough();

const serveWebSchema = z
  .object({ Handlers: z.record(z.string(), serveHandlerSchema).optional() })
  .passthrough();

const serveConfigSchema = z
  .object({
    Web: z.record(z.string(), serveWebSchema).optional(),
    AllowFunnel: z.record(z.string(), z.boolean()).optional(),
  })
  .passthrough();

export type ServeConfigJson = z.infer<typeof serveConfigSchema>;

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
