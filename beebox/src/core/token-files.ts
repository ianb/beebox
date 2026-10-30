/**
 * Where a box keeps its hashed-bearer credentials, named once so the stores
 * that write them (`core/mobile/pairing.ts`, `core/scan/tokens.ts`,
 * `core/agent/token.ts`) and the hub metadata that publishes their hashes
 * (`core/hub-meta.ts`) agree without importing each other. A leaf module.
 */

/** A `TokenStore` file: records under one JSON key, each with `tokenHash` and maybe `revokedAt`. */
export interface TokenFile {
  /** Relative to the box root. */
  relativePath: string;
  /** The top-level key holding the record array. */
  collectionKey: string;
}

export const MOBILE_DEVICES_FILE: TokenFile = { relativePath: ".beebox/mobile-devices.secret.json", collectionKey: "devices" };
export const SCAN_TOKENS_FILE: TokenFile = { relativePath: ".beebox/scan-tokens.secret.json", collectionKey: "tokens" };
/** The agent loopback token, plaintext, 0600. */
export const AGENT_TOKEN_RELATIVE_PATH = ".beebox/agent-token";
