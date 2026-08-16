/**
 * Parses the `configure` subcommand's `<server-url-with-box>` argument into
 * a server base URL and a box slug, and validates the slug against a
 * conservative local pattern BEFORE it can ever become a filesystem path
 * component — the token file path derives only from this locally-validated
 * value, never from any server response (`token-file.ts`).
 */

import { ConfigureError } from "./errors.js";

/** Deliberately conservative: lowercase alphanumerics and hyphens only, no
 * leading hyphen, capped length. This rules out "/" and ".." from ever
 * reaching the filesystem through this value — a slug that can't parse
 * cannot be a path separator or a traversal segment. */
export const BOX_SLUG_PATTERN = /^[\da-z][\da-z-]{0,63}$/;

export interface ParsedServerTarget {
  readonly serverUrl: string;
  readonly box: string;
}

export function parseServerUrlWithBox(input: string): ParsedServerTarget {
  const url = parseUrl(input);
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  // The box is the LAST path segment; anything before it is a mount prefix
  // that stays part of the server URL (e.g. the dev router's
  // http://localhost:3210/<worktree>/<box>). Dropping the prefix would
  // silently target the wrong server path.
  const box = segments.at(-1);
  if (box === undefined) {
    const message = `URL must include a box slug in its path, e.g. https://cb.example.org/family (got "${input}")`;
    throw new ConfigureError(message);
  }
  if (!BOX_SLUG_PATTERN.test(box)) {
    const message = `box slug "${box}" is invalid — must match ${BOX_SLUG_PATTERN.source}`;
    throw new ConfigureError(message);
  }
  const prefix = segments.slice(0, -1).join("/");
  const serverUrl = `${url.protocol}//${url.host}${prefix.length > 0 ? `/${prefix}` : ""}`;
  return { serverUrl, box };
}

function parseUrl(input: string): URL {
  try {
    return new URL(input);
  } catch (_e) {
    const message = `not a valid URL: "${input}"`;
    throw new ConfigureError(message);
  }
}
