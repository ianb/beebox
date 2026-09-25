import type { CloudflareProvisioningClient, DeployedScriptSettings, ScriptSubdomainSettings } from "./cloudflare-provisioning.js";
import type { CloudflareZone, WorkerDomain } from "./cloudflare-provisioning-domains.js";

class WorkerDomainAlreadyAttachedError extends Error {
  constructor() {
    super("Hostname is already attached to another Worker or zone.");
    this.name = "WorkerDomainAlreadyAttachedError";
  }
}

export interface FakeProvisioningClient extends CloudflareProvisioningClient {
  /** Bucket names that exist. Mutated by `createBucket`. */
  buckets: Set<string>;
  /** The account's workers.dev subdomain label (`null` = none registered). */
  accountSubdomain: string | null;
  /** Deployed scripts by name. Absent name ⇒ never deployed. */
  scripts: Map<string, DeployedScriptSettings>;
  /** Per-script workers.dev routing state. */
  scriptSubdomains: Map<string, ScriptSubdomainSettings>;
  zones: CloudflareZone[];
  workerDomains: WorkerDomain[];
  /** Every mutating op in call order (`create-bucket:<name>` / `set-subdomain:<script>:<enabled>:<previews>`). */
  ops: string[];
}

export interface FakeProvisioningOptions {
  buckets?: string[];
  accountSubdomain?: string | null;
  scripts?: Record<string, DeployedScriptSettings>;
  scriptSubdomains?: Record<string, ScriptSubdomainSettings>;
  zones?: CloudflareZone[];
  workerDomains?: WorkerDomain[];
}

/** Build a network-free {@link CloudflareProvisioningClient} with observable state. */
export function createFakeProvisioningClient(options?: FakeProvisioningOptions): FakeProvisioningClient {
  const buckets = new Set(options?.buckets);
  const scripts = new Map(Object.entries(options?.scripts ?? {}));
  const scriptSubdomains = new Map(Object.entries(options?.scriptSubdomains ?? {}));
  const zones = [...(options?.zones ?? [])];
  const workerDomains = [...(options?.workerDomains ?? [])];
  const ops: string[] = [];

  return {
    buckets,
    accountSubdomain: options?.accountSubdomain === undefined ? "examplesub" : options.accountSubdomain,
    scripts,
    scriptSubdomains,
    zones,
    workerDomains,
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
    listZones(): Promise<CloudflareZone[]> {
      return Promise.resolve(zones);
    },
    listWorkerDomains(hostname: string): Promise<WorkerDomain[]> {
      return Promise.resolve(workerDomains.filter((domain) => domain.hostname === hostname));
    },
    attachWorkerDomain(args: { hostname: string; service: string; zoneId: string; zoneName: string }): Promise<WorkerDomain> {
      ops.push(`attach-domain:${args.hostname}:${args.service}`);
      const existing = workerDomains.find((domain) => domain.hostname === args.hostname);
      if (existing !== undefined) {
        if (existing.service !== args.service || existing.zoneId !== args.zoneId) return Promise.reject(new WorkerDomainAlreadyAttachedError());
        return Promise.resolve(existing);
      }
      const domain = { id: `domain-${workerDomains.length + 1}`, ...args, environment: "production" };
      workerDomains.push(domain);
      return Promise.resolve(domain);
    },
  };
}
