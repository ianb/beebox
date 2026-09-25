import { collectAgentQuotas, glmQuotaFromEnv } from "./quota-collect.js";
import { quotaSchema, type Quota } from "../shared/documents.js";
import type { QuotasService } from "./services.js";

export function createQuotasService(): QuotasService {
  return {
    async get(): Promise<Quota[]> {
      const quotas = await collectAgentQuotas({ backgroundClaudeRefresh: true, glmRequest: await glmQuotaFromEnv() });
      return quotas.map((quota) => quotaSchema.parse(quota));
    },
  };
}
