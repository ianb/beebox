/**
 * The `configure` subcommand's core logic. Given an already-resolved token,
 * folder, and disposition, this parses the server URL + box, writes (or
 * updates) the uploader config, writes the token file, and verifies the new
 * token against the server. Deliberately free of process globals
 * (stdin/TTY/argv) so it's directly doctestable; `configure-cli.ts` owns
 * argv parsing and interactive prompting and calls into this.
 */

import { join } from "node:path";

import type { Disposition } from "./config.js";
import { writeUploaderTarget } from "./config-writer.js";
import { errorMessage } from "./error-guards.js";
import { ConfigureError } from "./errors.js";
import { parseServerUrlWithBox } from "./target-url.js";
import { writeTokenFile } from "./token-file.js";
import { checkHashes } from "./wire-client.js";

export interface ConfigureParams {
  readonly serverUrlWithBox: string;
  readonly folder: string;
  readonly disposition: Disposition;
  readonly name: string;
  readonly token: string;
  readonly configPath: string;
  readonly homeDir: string;
}

export interface ConfigureResult {
  readonly configPath: string;
  readonly tokenPath: string;
  readonly box: string;
  readonly folder: string;
  readonly name: string;
}

export async function configure(params: ConfigureParams): Promise<ConfigureResult> {
  if (params.token.length === 0) {
    const message = "token is empty — nothing was read from stdin";
    throw new ConfigureError(message);
  }
  const { serverUrl, box } = parseServerUrlWithBox(params.serverUrlWithBox);
  // Deliberately keyed on box alone (per the plan): two different servers
  // sharing a box slug on the same machine would share this token file. That
  // pairing is not a supported configuration — box slugs are expected to be
  // machine-local-unique across servers a laptop talks to.
  const tokenPath = join(params.homeDir, ".scan-tokens", `${box}.token`);

  await writeUploaderTarget({
    configPath: params.configPath,
    target: { folder: params.folder, serverUrl, box, tokenPath, disposition: params.disposition },
  });

  await writeTokenFile(tokenPath, params.token);

  await verify({ serverUrl, box, token: params.token, configPath: params.configPath, tokenPath });

  return { configPath: params.configPath, tokenPath, box, folder: params.folder, name: params.name };
}

interface VerifyParams {
  readonly serverUrl: string;
  readonly box: string;
  readonly token: string;
  readonly configPath: string;
  readonly tokenPath: string;
}

/** One `POST /api/scan/check` with an empty hash list — legal per
 * `docs/scan-upload-contract.md` and enough to prove the token and box are
 * accepted. On failure, both the config and token file are already written
 * and are deliberately left in place (no rollback) — the error names both
 * paths. Re-running `configure` with the SAME `<server-url-with-box>` and a
 * corrected token replaces this target in place (matched on box +
 * serverUrl, so nothing is duplicated). Re-running with a *different*
 * server URL for the same box does not clean up this failed target — it
 * appends a new one instead — so a mistyped host in `<server-url-with-box>`
 * needs the stale target removed by hand. */
async function verify(params: VerifyParams): Promise<void> {
  try {
    await checkHashes({ serverUrl: params.serverUrl, box: params.box, token: params.token }, []);
  } catch (e) {
    const message =
      `server verification failed for box "${params.box}": ${errorMessage(e)} — the config ` +
      `(${params.configPath}) and token file (${params.tokenPath}) were still written; fix the ` +
      "token and re-run configure with the same URL";
    throw new ConfigureError(message);
  }
}
