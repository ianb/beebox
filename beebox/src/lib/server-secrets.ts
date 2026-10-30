/**
 * The credentials a box server verifies or signs with, held outside
 * `process.env` once the server has started.
 *
 * Card schemas load inside the server process (`src/schemas.ts`), and an agent
 * can write one. `sealServerSecrets` removes these names from `process.env`, so
 * schema code that reads the environment, and any child that spreads it, gets
 * nothing. This is not an execution boundary: code in this process can still
 * import this module, and an agent with the server's user can read
 * `/proc/<pid>/environ` and `$CREDENTIALS_DIRECTORY`.
 *
 * Before sealing, and in processes that never seal (the hub, the CLI, tests),
 * reads are live from `process.env`. `startServer` seals; `createServer` alone,
 * as tests use it, does not. After sealing, `process.env` is ignored, so a schema cannot set `BBX_HUB_SECRET` to switch the server into hub mode.
 */

const SERVER_SECRET_NAMES = [
  "BBX_SESSION_SECRET",
  "BBX_HUB_SECRET",
  "BBX_DIAG_API_KEY",
  "BBX_BROWSE_API_KEY",
  "BBX_VAPID_PRIVATE_KEY",
  "GOOGLE_OAUTH_CLIENT_SECRET",
] as const;

export type ServerSecretName = (typeof SERVER_SECRET_NAMES)[number];

let sealed: Map<ServerSecretName, string> | null = null;

/** Move the server's credentials out of `env`. Call once, before any schema loads. */
export function sealServerSecrets(env: NodeJS.ProcessEnv): void {
  sealed ??= new Map();
  for (const name of SERVER_SECRET_NAMES) {
    const value = env[name];
    if (value !== undefined) sealed.set(name, value);
    delete env[name];
  }
}

/** The named credential, from the sealed store once sealed and from `process.env` until then. */
export function serverSecret(name: ServerSecretName): string | undefined {
  return sealed === null ? process.env[name] : sealed.get(name);
}
