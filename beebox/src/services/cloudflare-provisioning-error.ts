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
