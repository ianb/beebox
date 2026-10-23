/**
 * Prints the owner's Claude and Codex quota windows as JSON for
 * `bin/workstreams quotas --json`. Collection lives in the workstreams app's
 * `quota-*` modules. No `glmRequest` is passed, so the output is `[claude, codex]`.
 */

import { pathToFileURL } from "node:url";

import { collectAgentQuotas } from "../workstreams-app/src/server/main/quota-collect.js";

export async function printQuotas(
  collect: () => Promise<unknown>,
  write: (text: string) => void,
): Promise<void> {
  write(`${JSON.stringify(await collect())}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await printQuotas(() => collectAgentQuotas({}), (text) => process.stdout.write(text));
}
