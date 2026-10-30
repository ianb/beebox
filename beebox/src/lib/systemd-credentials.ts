/**
 * systemd credentials (`LoadCredential=`): files the service manager reads as
 * root and exposes to one service under `$CREDENTIALS_DIRECTORY`. A box unit
 * receives its hub secret this way (deploy/systemd/beebox-box@.service), so
 * the hub user never has to give a file to a box group it is not in.
 *
 * The engine turns the one credential it knows into the environment variable
 * the rest of the code reads (`BBX_HUB_SECRET`, `webapp/auth.ts`), before the
 * env is validated. Outside systemd the directory is unset and nothing happens.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { errnoCode } from "../shared/error-guards.js";

/** Credential names a unit may pass, and the env var each one fills. */
const CREDENTIAL_ENV: Readonly<Record<string, string>> = { "hub-secret": "BBX_HUB_SECRET" };

/**
 * Copy known credentials from `$CREDENTIALS_DIRECTORY` into `env`. A
 * credential that is present wins over an inherited variable of the same
 * name: it is what systemd handed this very process. Returns the env names
 * that were set, for the caller's log line.
 */
export function adoptSystemdCredentials(env: NodeJS.ProcessEnv): string[] {
  const dir = env.CREDENTIALS_DIRECTORY;
  if (dir === undefined || dir === "") return [];
  const adopted: string[] = [];
  for (const [credential, name] of Object.entries(CREDENTIAL_ENV)) {
    let value: string;
    try {
      value = fs.readFileSync(path.join(dir, credential), "utf8").trim();
    } catch (e) {
      if (errnoCode(e) === "ENOENT") continue;
      throw e;
    }
    if (value === "") continue;
    env[name] = value;
    adopted.push(name);
  }
  return adopted;
}
