/**
 * Custom error classes for scan-uploader. Every non-transport failure carries
 * a purpose-named class so callers (and tests) can branch on `instanceof`
 * instead of string-matching messages. Mirrors callback-box's convention
 * (`callback-box/src/lib/errors.ts`) without importing it — this package
 * shares no code with callback-box.
 */

import { errorMessage } from "./error-guards.js";

/** The config file could not be read, parsed, or failed shape validation. */
export class ConfigError extends Error {
  constructor(configPath: string, reason: string) {
    super(`Invalid config at ${configPath}: ${reason}`);
    this.name = "ConfigError";
  }
}

/** A network-level failure talking to the server (connection refused, DNS, etc). */
export class TransportError extends Error {
  constructor(url: string, cause: unknown) {
    super(`Request to ${url} failed: ${errorMessage(cause)}`);
    this.name = "TransportError";
    this.cause = cause;
  }
}

/** The server responded with a shape this client's wire-contract parser rejects. */
export class ProtocolError extends Error {
  constructor(url: string, detail: string) {
    super(`Unexpected response from ${url}: ${detail}`);
    this.name = "ProtocolError";
  }
}

/** The `trash` disposition's external helper (`trash` CLI / Finder) failed. */
export class TrashError extends Error {
  constructor(filePath: string, reason: string) {
    super(`Could not move ${filePath} to Trash: ${reason}`);
    this.name = "TrashError";
  }
}
