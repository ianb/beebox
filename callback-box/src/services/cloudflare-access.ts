/**
 * CloudflareAccessClient — the Zero Trust Access surface behind the account
 * tiers' provisioning (`docs/implemented-plans/pub-setup-wrangler.md`): read the org's
 * team domain, find-or-create the One-Time PIN identity provider, the
 * self-hosted application protecting `<host>/a`, and its allow-everyone
 * policy (the Worker's per-publication email allowlist stays the real
 * authorization — Access only authenticates).
 *
 * Separate from `cloudflare-provisioning.ts` because it takes a DIFFERENT
 * credential: wrangler's OAuth scopes cannot cover `/access/` endpoints, so
 * these calls ride a setup-only API token (Access edit scopes) that is used
 * in the interactive session and never stored (plan fork 2).
 *
 * ⚠️ UNVERIFIED: the real adapter cannot be exercised without live Access-edit
 * credentials — request/response shaping is unproven until the collaborative
 * live pass (the plan's named gaps: create-response `aud` placement, org
 * behavior pre-onboarding, whether the OTP IdP is auto-provisioned).
 */

import { z } from "zod";

import {
  type CloudflareApiErrorDetail,
  ProvisioningRequestError,
} from "./cloudflare-provisioning.js";

/** The Zero Trust org slice setup reads. `authDomain` is bare (`<team>.cloudflareaccess.com`). */
export interface AccessOrganization {
  name: string;
  authDomain: string;
}

/** One configured identity provider. */
export interface AccessIdentityProvider {
  id: string;
  name: string;
  /** Cloudflare's type string (`onetimepin`, `cloudflare`, `google`, ...). */
  type: string;
}

/** The Access application slice setup consumes (`aud` is what the Worker validates). */
export interface AccessApplication {
  id: string;
  aud: string;
  domain: string;
  name: string;
  type: string;
}

/** One policy attached to an application. `includeEveryone` is the only rule shape setup manages. */
export interface AccessAppPolicy {
  id: string;
  name: string;
  decision: string;
  /** True when the include rules are exactly `[{ everyone: {} }]`. */
  includeEveryone: boolean;
}

/** The Access surface `cb pub setup --access` uses. Reads fail-soft (`null`); writes throw. */
export interface CloudflareAccessClient {
  /** The account's Zero Trust org, or `null` when the account never onboarded. */
  getOrganization(): Promise<AccessOrganization | null>;
  listIdentityProviders(): Promise<AccessIdentityProvider[]>;
  /** Create the One-Time PIN IdP (no config beyond its type). */
  createOtpIdentityProvider(): Promise<AccessIdentityProvider>;
  /** The self-hosted app whose domain exactly matches, or `null`. */
  findAppByDomain(domain: string): Promise<AccessApplication | null>;
  createApp(args: { name: string; domain: string }): Promise<AccessApplication>;
  listAppPolicies(appId: string): Promise<AccessAppPolicy[]>;
  /** Attach the allow-everyone-authenticated policy (precedence 1). */
  createAllowEveryonePolicy(appId: string, args: { name: string }): Promise<AccessAppPolicy>;
}

export interface AccessClientConfig {
  accountId: string;
  /** The setup-only Access-edit API token (never stored — plan fork 2). */
  apiToken: string;
}

/** The subset of `fetch` the real adapter calls — injectable for URL/error-mapping unit tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const cfErrorSchema = z.object({ code: z.number(), message: z.string() });
const envelopeSchema = z.object({
  success: z.boolean(),
  errors: z.array(cfErrorSchema).optional(),
  result: z.unknown().optional(),
});

const organizationSchema = z.object({ name: z.string(), auth_domain: z.string() });
const idpSchema = z.object({ id: z.string(), name: z.string(), type: z.string() });
const appSchema = z.object({
  id: z.string(),
  aud: z.string(),
  domain: z.string(),
  name: z.string(),
  type: z.string(),
});
const policySchema = z.object({
  id: z.string(),
  name: z.string(),
  decision: z.string(),
  include: z.array(z.unknown()).optional(),
});

/** Is a parsed include-rule array exactly the allow-everyone shape? */
function isEveryoneInclude(include: unknown[] | undefined): boolean {
  if (include === undefined || include.length !== 1) return false;
  const only = z.object({ everyone: z.object({}) }).strict().safeParse(include[0]);
  return only.success;
}

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

/** ⚠️ UNVERIFIED (no live-CF test). Real Access adapter over Cloudflare's REST API. */
export function createCloudflareAccessClient(config: AccessClientConfig, deps?: { fetch?: FetchLike | undefined }): CloudflareAccessClient {
  const doFetch = deps?.fetch ?? fetch;
  const base = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/access`;
  const authHeaders: Record<string, string> = { authorization: `Bearer ${config.apiToken}` };

  async function request<T>(op: string, args: { method: string; path: string; body?: unknown; resultSchema: z.ZodType<T> }): Promise<T | null> {
    const { method, path, body, resultSchema } = args;
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: body === undefined ? authHeaders : { ...authHeaders, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
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

  /** A write's result must exist — a `null` (404) from a POST is a broken invariant, surfaced as a request error. */
  function required<T>(op: string, value: T | null): T {
    if (value === null) throw new ProvisioningRequestError({ op, status: 404, statusText: "unexpected 404 on a write" });
    return value;
  }

  return {
    async getOrganization(): Promise<AccessOrganization | null> {
      const result = await request("access org read", { method: "GET", path: "/organizations", resultSchema: organizationSchema });
      return result === null ? null : { name: result.name, authDomain: result.auth_domain };
    },
    async listIdentityProviders(): Promise<AccessIdentityProvider[]> {
      const result = await request("access idp list", { method: "GET", path: "/identity_providers", resultSchema: z.array(idpSchema) });
      return result ?? [];
    },
    async createOtpIdentityProvider(): Promise<AccessIdentityProvider> {
      const result = await request("access idp create", {
        method: "POST",
        path: "/identity_providers",
        body: { name: "One-time PIN", type: "onetimepin", config: {} },
        resultSchema: idpSchema,
      });
      return required("access idp create", result);
    },
    async findAppByDomain(domain: string): Promise<AccessApplication | null> {
      const result = await request("access app find", {
        method: "GET",
        path: `/apps?domain=${encodeURIComponent(domain)}&exact=true`,
        resultSchema: z.array(appSchema),
      });
      const exact = (result ?? []).find((app) => app.domain === domain);
      return exact ?? null;
    },
    async createApp(args: { name: string; domain: string }): Promise<AccessApplication> {
      const result = await request("access app create", {
        method: "POST",
        path: "/apps",
        body: { type: "self_hosted", name: args.name, domain: args.domain, session_duration: "24h" },
        resultSchema: appSchema,
      });
      return required("access app create", result);
    },
    async listAppPolicies(appId: string): Promise<AccessAppPolicy[]> {
      const result = await request("access policy list", {
        method: "GET",
        path: `/apps/${encodeURIComponent(appId)}/policies`,
        resultSchema: z.array(policySchema),
      });
      return (result ?? []).map((p) => ({ id: p.id, name: p.name, decision: p.decision, includeEveryone: isEveryoneInclude(p.include) }));
    },
    async createAllowEveryonePolicy(appId: string, args: { name: string }): Promise<AccessAppPolicy> {
      const result = await request("access policy create", {
        method: "POST",
        path: `/apps/${encodeURIComponent(appId)}/policies`,
        body: { name: args.name, decision: "allow", precedence: 1, include: [{ everyone: {} }] },
        resultSchema: policySchema,
      });
      const created = required("access policy create", result);
      return { id: created.id, name: created.name, decision: created.decision, includeEveryone: isEveryoneInclude(created.include) };
    },
  };
}

// ---------------------------------------------------------------------------
// Fake — in-memory, for access-setup doctests. No network.
// ---------------------------------------------------------------------------

export interface FakeAccessClientOptions {
  /** The org, or `null` for an account that never onboarded to Zero Trust. */
  organization?: AccessOrganization | null | undefined;
  identityProviders?: AccessIdentityProvider[] | undefined;
  apps?: AccessApplication[] | undefined;
  /** Policies by app id. */
  policies?: Record<string, AccessAppPolicy[]> | undefined;
}

export interface FakeAccessClient extends CloudflareAccessClient {
  apps: AccessApplication[];
  identityProviders: AccessIdentityProvider[];
  policies: Map<string, AccessAppPolicy[]>;
  /** Every mutating op in call order. */
  ops: string[];
  describe(): string;
}

/** Build a network-free {@link CloudflareAccessClient} with observable state. */
export function createFakeAccessClient(opts?: FakeAccessClientOptions): FakeAccessClient {
  const organization = opts?.organization === undefined ? { name: "exampleteam", authDomain: "exampleteam.cloudflareaccess.com" } : opts.organization;
  const identityProviders = [...(opts?.identityProviders ?? [])];
  const apps = [...(opts?.apps ?? [])];
  const policies = new Map(Object.entries(opts?.policies ?? {}));
  const ops: string[] = [];
  let nextId = 1;
  const newId = (prefix: string): string => `${prefix}-${nextId++}`;

  return {
    apps,
    identityProviders,
    policies,
    ops,
    getOrganization(): Promise<AccessOrganization | null> {
      return Promise.resolve(organization);
    },
    listIdentityProviders(): Promise<AccessIdentityProvider[]> {
      return Promise.resolve([...identityProviders]);
    },
    createOtpIdentityProvider(): Promise<AccessIdentityProvider> {
      const idp: AccessIdentityProvider = { id: newId("idp"), name: "One-time PIN", type: "onetimepin" };
      identityProviders.push(idp);
      ops.push(`create-idp:${idp.type}`);
      return Promise.resolve(idp);
    },
    findAppByDomain(domain: string): Promise<AccessApplication | null> {
      return Promise.resolve(apps.find((app) => app.domain === domain) ?? null);
    },
    createApp(args: { name: string; domain: string }): Promise<AccessApplication> {
      const app: AccessApplication = { id: newId("app"), aud: `aud-${newId("tag")}`, domain: args.domain, name: args.name, type: "self_hosted" };
      apps.push(app);
      ops.push(`create-app:${args.domain}`);
      return Promise.resolve(app);
    },
    listAppPolicies(appId: string): Promise<AccessAppPolicy[]> {
      return Promise.resolve([...(policies.get(appId) ?? [])]);
    },
    createAllowEveryonePolicy(appId: string, args: { name: string }): Promise<AccessAppPolicy> {
      const policy: AccessAppPolicy = { id: newId("pol"), name: args.name, decision: "allow", includeEveryone: true };
      policies.set(appId, [...(policies.get(appId) ?? []), policy]);
      ops.push(`create-policy:${appId}`);
      return Promise.resolve(policy);
    },
    describe(): string {
      const lines = [
        `org: ${organization === null ? "(not onboarded)" : organization.authDomain}`,
        `idps: ${identityProviders.map((i) => i.type).join(", ") || "(none)"}`,
        ...apps.map((app) => `app ${app.domain} aud=${app.aud} policies=[${(policies.get(app.id) ?? []).map((p) => `${p.decision}:${p.includeEveryone ? "everyone" : "other"}`).join(", ")}]`),
        ...ops.map((op) => `  op ${op}`),
      ];
      return lines.join("\n");
    },
  };
}
