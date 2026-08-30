/**
 * CloudflareProvisioningClient — the account-level Cloudflare surface behind
 * `bbx pub setup` / `bbx pub status` (Track E of `docs/plans/publish-pages.md`):
 * R2 bucket creation, the account's workers.dev subdomain, the deployed
 * script's settings, and the per-script workers.dev/preview-URL toggles.
 *
 * Same pattern as `publish-remote-store.ts`: the CLI logic never talks to
 * Cloudflare directly — it goes through this narrow interface so setup/status
 * are fully unit-testable against {@link createFakeProvisioningClient} with no
 * network. The real implementation ({@link createCloudflareProvisioningClient})
 * calls Cloudflare's REST API (`api.cloudflare.com/client/v4/accounts/<id>/...`)
 * through the injected {@link BearerProvider}.
 *
 * ⚠️ UNVERIFIED: the real adapter cannot be exercised without live Cloudflare
 * credentials, so it is NOT covered by any doctest. The setup/status *logic* is
 * fully tested through the fake; the adapter is the thin, best-effort seam.
 * Treat its request shaping / error mapping as unproven until the manual
 * end-to-end run (the plan's step-5/7 verification).
 *
 * CREDENTIAL MODEL (decided 2026-07-31 — `docs/implemented-plans/pub-setup-wrangler.md`):
 * this client rides the interactive wrangler-OAuth login through a
 * {@link BearerProvider} (or the `CLOUDFLARE_API_TOKEN` env escape hatch). No
 * broad management token is stored anywhere; the headless connector holds only
 * an ingestion-bucket-scoped R2 token, so a box compromise can neither
 * redeploy the Worker nor rewrite publication manifests/content.
 */

import { z } from "zod";

import type { BearerProvider } from "./cloudflare-bearer.js";

/** One entry of a Cloudflare API JSON error body's `errors` array. */
export interface CloudflareApiErrorDetail {
  code: number;
  message: string;
}

/** A provisioning API request returned a non-success HTTP status. */
export class ProvisioningRequestError extends Error {
  readonly op: string;
  readonly status: number;
  readonly cfErrors: CloudflareApiErrorDetail[];
  constructor(args: { op: string; status: number; statusText: string; cfErrors?: CloudflareApiErrorDetail[] | undefined }) {
    const detail = args.cfErrors?.length ? `: ${args.cfErrors.map((e) => `[${e.code}] ${e.message}`).join(", ")}` : "";
    super(`Cloudflare ${args.op} failed: ${args.status} ${args.statusText}${detail}`);
    this.name = "ProvisioningRequestError";
    this.op = args.op;
    this.status = args.status;
    this.cfErrors = args.cfErrors ?? [];
  }
}

/** Per-script workers.dev routing state: the live toggle and the version-preview-URL toggle (a leak surface when true). */
export interface ScriptSubdomainSettings {
  enabled: boolean;
  previewsEnabled: boolean;
}

/** One binding row of the deployed script's settings (only the fields status inspects). */
export interface DeployedBinding {
  type: string;
  name: string;
  /** Plain-text var value, when the binding is a var. */
  text?: string | undefined;
}

/** The deployed script's settings slice status inspects (bindings incl. plain-text vars). */
export interface DeployedScriptSettings {
  bindings: DeployedBinding[];
}

/**
 * The account-level Cloudflare surface `bbx pub setup`/`status` use. Reads
 * return `null` for "does not exist" (fail-soft probes); writes throw
 * {@link ProvisioningRequestError} on refusal.
 */
export interface CloudflareProvisioningClient {
  /** Does the R2 bucket exist? */
  bucketExists(name: string): Promise<boolean>;
  /** Create the R2 bucket. Idempotent: resolves `{ created: false }` when it already exists. */
  createBucket(name: string): Promise<{ created: boolean }>;
  /** The account's workers.dev subdomain label (`<label>.workers.dev`), or `null` when none is registered. */
  getAccountSubdomain(): Promise<string | null>;
  /** The deployed script's settings, or `null` when the script has never been deployed. */
  getScriptSettings(scriptName: string): Promise<DeployedScriptSettings | null>;
  /** The script's workers.dev routing state, or `null` when the script has never been deployed. */
  getScriptSubdomain(scriptName: string): Promise<ScriptSubdomainSettings | null>;
  /** Set the script's workers.dev routing state (setup enforces `enabled` + previews DISABLED). */
  setScriptSubdomain(scriptName: string, settings: ScriptSubdomainSettings): Promise<void>;
}

export interface ProvisioningConfig {
  accountId: string;
  /** The bearer seam: a static API token, or the wrangler-OAuth-backed provider. */
  bearer: BearerProvider;
}

/** The subset of `fetch` the real adapter calls — injectable so a unit test can exercise URL/error mapping without a network. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const cfErrorSchema = z.object({ code: z.number(), message: z.string() });

/** The Cloudflare v4 JSON envelope — the untrusted-response parse boundary. */
const envelopeSchema = z.object({
  success: z.boolean(),
  errors: z.array(cfErrorSchema).optional(),
  result: z.unknown().optional(),
});

const subdomainResultSchema = z.object({ subdomain: z.string() });
const scriptSubdomainResultSchema = z.object({ enabled: z.boolean(), previews_enabled: z.boolean().optional() });
const scriptSettingsResultSchema = z.object({
  bindings: z
    .array(z.object({ type: z.string(), name: z.string(), text: z.string().optional() }))
    .optional(),
});

/** Cloudflare error code for "bucket already exists" — mapped to idempotent success. */
const R2_BUCKET_ALREADY_EXISTS = 10004;

/** Best-effort extraction of a Cloudflare JSON error body's `errors` array. */
async function tryReadCfErrors(res: Response): Promise<CloudflareApiErrorDetail[] | undefined> {
  try {
    const body: unknown = await res.clone().json();
    const parsed = z.object({ errors: z.array(cfErrorSchema).optional() }).safeParse(body);
    return parsed.success ? parsed.data.errors : undefined;
  } catch (_e) {
    // Non-JSON error body (e.g. a plain-text gateway error) — no CF detail available.
    return undefined;
  }
}

/**
 * ⚠️ UNVERIFIED (no live-CF test). Real provisioning adapter over Cloudflare's
 * REST API, authenticated per request through the injected bearer provider
 * (see the module-header credential model).
 */
export function createCloudflareProvisioningClient(config: ProvisioningConfig, deps?: { fetch?: FetchLike | undefined }): CloudflareProvisioningClient {
  const doFetch = deps?.fetch ?? fetch;
  const base = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}`;

  /**
   * Fetch with the current bearer; on a 401 the OAuth access token may simply
   * have expired mid-flow, so refresh through the provider and retry ONCE
   * (every op here is idempotent). A second 401 propagates to the caller.
   */
  async function authedFetch(url: string, init: { method: string; headers?: Record<string, string>; body?: string }): Promise<Response> {
    const attempt = async (bearer: string): Promise<Response> =>
      doFetch(url, { method: init.method, headers: { ...init.headers, authorization: `Bearer ${bearer}` }, ...(init.body === undefined ? {} : { body: init.body }) });
    const res = await attempt(await config.bearer.get());
    if (res.status !== 401) return res;
    return attempt(await config.bearer.refresh());
  }

  /** GET returning the parsed `result`, or `null` on 404. Throws on any other failure. */
  async function getResult<T>(op: string, args: { url: string; resultSchema: z.ZodType<T> }): Promise<T | null> {
    const { url, resultSchema } = args;
    const res = await authedFetch(url, { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new ProvisioningRequestError({ op, status: res.status, statusText: res.statusText, cfErrors: await tryReadCfErrors(res) });
    }
    const envelope = envelopeSchema.safeParse(await res.json());
    if (!envelope.success || !envelope.data.success) {
      throw new ProvisioningRequestError({ op, status: res.status, statusText: "malformed or unsuccessful response envelope", cfErrors: envelope.success ? envelope.data.errors : undefined });
    }
    const result = resultSchema.safeParse(envelope.data.result);
    if (!result.success) {
      throw new ProvisioningRequestError({ op, status: res.status, statusText: `unexpected result shape: ${result.error.message}` });
    }
    return result.data;
  }

  return {
    async bucketExists(name: string): Promise<boolean> {
      const result = await getResult("r2 bucket probe", { url: `${base}/r2/buckets/${encodeURIComponent(name)}`, resultSchema: z.unknown() });
      return result !== null;
    },
    async createBucket(name: string): Promise<{ created: boolean }> {
      const res = await authedFetch(`${base}/r2/buckets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) return { created: true };
      const cfErrors = await tryReadCfErrors(res);
      // Idempotent: an already-existing bucket is success, not failure.
      if (cfErrors?.some((e) => e.code === R2_BUCKET_ALREADY_EXISTS)) return { created: false };
      throw new ProvisioningRequestError({ op: "r2 bucket create", status: res.status, statusText: res.statusText, cfErrors });
    },
    async getAccountSubdomain(): Promise<string | null> {
      const result = await getResult("workers.dev subdomain probe", { url: `${base}/workers/subdomain`, resultSchema: subdomainResultSchema });
      return result === null || result.subdomain.length === 0 ? null : result.subdomain;
    },
    async getScriptSettings(scriptName: string): Promise<DeployedScriptSettings | null> {
      const result = await getResult("script settings probe", { url: `${base}/workers/scripts/${encodeURIComponent(scriptName)}/settings`, resultSchema: scriptSettingsResultSchema });
      if (result === null) return null;
      return { bindings: result.bindings ?? [] };
    },
    async getScriptSubdomain(scriptName: string): Promise<ScriptSubdomainSettings | null> {
      const result = await getResult("script subdomain probe", { url: `${base}/workers/scripts/${encodeURIComponent(scriptName)}/subdomain`, resultSchema: scriptSubdomainResultSchema });
      if (result === null) return null;
      return { enabled: result.enabled, previewsEnabled: result.previews_enabled ?? false };
    },
    async setScriptSubdomain(scriptName: string, settings: ScriptSubdomainSettings): Promise<void> {
      const res = await authedFetch(`${base}/workers/scripts/${encodeURIComponent(scriptName)}/subdomain`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: settings.enabled, previews_enabled: settings.previewsEnabled }),
      });
      if (!res.ok) {
        throw new ProvisioningRequestError({ op: "script subdomain update", status: res.status, statusText: res.statusText, cfErrors: await tryReadCfErrors(res) });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Fake — in-memory, for setup/status doctests. No network.
// ---------------------------------------------------------------------------

export interface FakeProvisioningClient extends CloudflareProvisioningClient {
  /** Bucket names that exist. Mutated by `createBucket`. */
  buckets: Set<string>;
  /** The account's workers.dev subdomain label (`null` = none registered). */
  accountSubdomain: string | null;
  /** Deployed scripts by name. Absent name ⇒ never deployed. */
  scripts: Map<string, DeployedScriptSettings>;
  /** Per-script workers.dev routing state. */
  scriptSubdomains: Map<string, ScriptSubdomainSettings>;
  /** Every mutating op in call order (`create-bucket:<name>` / `set-subdomain:<script>:<enabled>:<previews>`). */
  ops: string[];
}

export interface FakeProvisioningOptions {
  buckets?: string[];
  accountSubdomain?: string | null;
  scripts?: Record<string, DeployedScriptSettings>;
  scriptSubdomains?: Record<string, ScriptSubdomainSettings>;
}

/** Build a network-free {@link CloudflareProvisioningClient} with observable state. */
export function createFakeProvisioningClient(options?: FakeProvisioningOptions): FakeProvisioningClient {
  const buckets = new Set(options?.buckets);
  const scripts = new Map(Object.entries(options?.scripts ?? {}));
  const scriptSubdomains = new Map(Object.entries(options?.scriptSubdomains ?? {}));
  const ops: string[] = [];

  return {
    buckets,
    accountSubdomain: options?.accountSubdomain === undefined ? "examplesub" : options.accountSubdomain,
    scripts,
    scriptSubdomains,
    ops,
    bucketExists(name: string): Promise<boolean> {
      return Promise.resolve(buckets.has(name));
    },
    createBucket(name: string): Promise<{ created: boolean }> {
      ops.push(`create-bucket:${name}`);
      if (buckets.has(name)) return Promise.resolve({ created: false });
      buckets.add(name);
      return Promise.resolve({ created: true });
    },
    getAccountSubdomain(): Promise<string | null> {
      return Promise.resolve(this.accountSubdomain);
    },
    getScriptSettings(scriptName: string): Promise<DeployedScriptSettings | null> {
      return Promise.resolve(scripts.get(scriptName) ?? null);
    },
    getScriptSubdomain(scriptName: string): Promise<ScriptSubdomainSettings | null> {
      return Promise.resolve(scriptSubdomains.get(scriptName) ?? null);
    },
    setScriptSubdomain(scriptName: string, settings: ScriptSubdomainSettings): Promise<void> {
      ops.push(`set-subdomain:${scriptName}:${settings.enabled}:${settings.previewsEnabled}`);
      scriptSubdomains.set(scriptName, settings);
      return Promise.resolve();
    },
  };
}
