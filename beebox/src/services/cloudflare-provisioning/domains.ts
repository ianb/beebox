import { z } from "zod";

import { ProvisioningRequestError } from "./error.js";

export interface CloudflareZone { id: string; name: string; status: string; accountId: string }
export interface WorkerDomain { id: string; hostname: string; service: string; environment: string; zoneId: string; zoneName: string }
type Request = (url: string, init: { method: string; headers?: Record<string, string>; body?: string }) => Promise<Response>;

const providerError = z.object({ code: z.number(), message: z.string() });
const envelope = z.object({
  success: z.boolean(),
  errors: z.array(providerError).nullable().optional(),
  result: z.unknown().optional(),
});
const zoneSchema = z.object({ id: z.string(), name: z.string(), status: z.string(), account: z.object({ id: z.string() }) });
const domainSchema = z.object({ id: z.string(), hostname: z.string(), service: z.string(), environment: z.string(), zone_id: z.string(), zone_name: z.string() });

async function responseBody(op: string, res: Response): Promise<{ result: unknown; pages?: number }> {
  let body: unknown;
  try { body = await res.json(); } catch (error) {
    void error;
    throw new ProvisioningRequestError({ op, status: res.status, statusText: res.ok ? "malformed response body" : res.statusText });
  }
  const parsed = envelope.safeParse(body);
  const cfErrors = parsed.success ? (parsed.data.errors ?? []).slice(0, 5).map((error) => ({ code: error.code, message: sanitizeProviderMessage(error.message) })) : [];
  if (!res.ok || !parsed.success || !parsed.data.success || parsed.data.result === undefined) {
    throw new ProvisioningRequestError({
      op,
      status: res.status,
      statusText: parsed.success && !parsed.data.success ? "Cloudflare rejected the request" : res.ok ? "malformed or unsuccessful response envelope" : res.statusText,
      cfErrors,
    });
  }
  const pageInfo = z.object({ result_info: z.object({ total_pages: z.number().int().nonnegative().optional() }).optional() }).passthrough().safeParse(body);
  const pages = pageInfo.success ? pageInfo.data.result_info?.total_pages : undefined;
  return { result: parsed.data.result, ...(pages === undefined ? {} : { pages }) };
}

function sanitizeProviderMessage(message: string): string {
  return Array.from(message, (character) => character.codePointAt(0) ?? 0)
    .map((codePoint) => codePoint < 32 || codePoint === 127 ? 32 : codePoint)
    .map((codePoint) => String.fromCodePoint(codePoint))
    .join("")
    .slice(0, 240);
}

export function createCloudflareDomainMethods(args: { accountId: string; base: string; request: Request }) {
  return {
    async listZones(): Promise<CloudflareZone[]> {
      const found: CloudflareZone[] = [];
      let page = 1;
      let pages = 1;
      do {
        const url = new URL("https://api.cloudflare.com/client/v4/zones");
        url.searchParams.set("account.id", args.accountId);
        url.searchParams.set("status", "active");
        url.searchParams.set("per_page", "50");
        url.searchParams.set("page", String(page));
        const response = await responseBody("zone list", await args.request(url.toString(), { method: "GET" }));
        const parsed = z.array(zoneSchema).safeParse(response.result);
        if (!parsed.success) throw new ProvisioningRequestError({ op: "zone list", status: 200, statusText: `unexpected result shape: ${parsed.error.message}` });
        found.push(...parsed.data.map((zone) => ({ id: zone.id, name: zone.name, status: zone.status, accountId: zone.account.id })));
        pages = response.pages ?? page;
        page += 1;
      } while (page <= pages);
      return found;
    },
    async listWorkerDomains(hostname: string): Promise<WorkerDomain[]> {
      const url = new URL(`${args.base}/workers/domains`);
      url.searchParams.set("hostname", hostname);
      const response = await responseBody("worker domain list", await args.request(url.toString(), { method: "GET" }));
      const parsed = z.array(domainSchema).safeParse(response.result);
      if (!parsed.success) throw new ProvisioningRequestError({ op: "worker domain list", status: 200, statusText: `unexpected result shape: ${parsed.error.message}` });
      return parsed.data.map((domain) => ({ id: domain.id, hostname: domain.hostname, service: domain.service, environment: domain.environment, zoneId: domain.zone_id, zoneName: domain.zone_name }));
    },
    async attachWorkerDomain(input: { hostname: string; service: string; zoneId: string; zoneName: string }): Promise<WorkerDomain> {
      const response = await args.request(`${args.base}/workers/domains`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostname: input.hostname, service: input.service, zone_id: input.zoneId, zone_name: input.zoneName }),
      });
      const result = await responseBody("worker domain attach", response);
      const parsed = domainSchema.safeParse(result.result);
      if (!parsed.success) throw new ProvisioningRequestError({ op: "worker domain attach", status: response.status, statusText: `unexpected result shape: ${parsed.error.message}` });
      const domain = parsed.data;
      return { id: domain.id, hostname: domain.hostname, service: domain.service, environment: domain.environment, zoneId: domain.zone_id, zoneName: domain.zone_name };
    },
  };
}
