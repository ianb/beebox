import { collectAgentQuotas } from "./quota-collect.js";
import { quotaSchema, type Quota } from "../shared/documents.js";
import type { QuotasService } from "./services.js";

export function createQuotasService(): QuotasService {
  return {
    async get(): Promise<Quota[]> {
      const quotas = await collectAgentQuotas({ backgroundClaudeRefresh: true });
      return quotas.map((quota) => quotaSchema.parse(quota));
    },
  };
}
