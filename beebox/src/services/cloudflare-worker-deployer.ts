/** Direct Worker upload adapter for server-managed publication sites. */

import { z } from "zod";
import type { BearerProvider } from "./cloudflare-bearer.js";

export interface PublicationWorkerDeployer {
  deploy(args: {
    scriptName: string;
    bucketName: string;
    pubId: string;
    hostHandle: string;
    workerVersion: string;
    bundle: Uint8Array;
  }): Promise<void>;
}

export type WorkerDeployFetch = (input: string, init?: RequestInit) => Promise<Response>;

const responseSchema = z.object({ success: z.boolean() });

class CloudflareWorkerDeployError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudflareWorkerDeployError";
  }
}

function deployError(message: string): CloudflareWorkerDeployError {
  return new CloudflareWorkerDeployError(message);
}

/** Upload the packaged module Worker and bind it to exactly one R2 bucket and PubId. */
export function createCloudflareWorkerDeployer(
  config: { accountId: string; bearer: BearerProvider },
  deps?: { fetch?: WorkerDeployFetch },
): PublicationWorkerDeployer {
  const doFetch = deps?.fetch ?? fetch;

  return {
    async deploy(args) {
      const form = new FormData();
      form.set("metadata", JSON.stringify({
        main_module: "index.js",
        compatibility_date: "2026-07-06",
        bindings: [
          { type: "r2_bucket", name: "PUB_STORE", bucket_name: args.bucketName },
          { type: "plain_text", name: "PUB_ID", text: args.pubId },
          { type: "plain_text", name: "HOST_HANDLE", text: args.hostHandle },
          { type: "plain_text", name: "PUB_WORKER_VERSION", text: args.workerVersion },
        ],
      }));
      form.set("index.js", new Blob([Uint8Array.from(args.bundle).buffer], { type: "application/javascript+module" }), "index.js");
      const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/workers/scripts/${encodeURIComponent(args.scriptName)}`;

      const send = async (token: string) => doFetch(url, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      let response = await send(await config.bearer.get());
      if (response.status === 401) response = await send(await config.bearer.refresh());
      if (!response.ok) throw deployError(`Cloudflare Worker upload failed (${response.status} ${response.statusText}).`);
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success || !parsed.data.success) throw deployError("Cloudflare did not confirm the Worker upload.");
    },
  };
}
