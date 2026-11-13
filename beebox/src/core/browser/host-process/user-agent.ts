/**
 * The user agent the box browser presents.
 *
 * Headless Chrome names itself `HeadlessChrome/<version>` in its user agent.
 * Cloudflare's Turnstile fails a browser that says so whoever clicks the
 * checkbox, so the person could not clear a challenge through the shared
 * browser (LinkedIn's login, 2026-11-13). The same Chromium with the plain
 * `Chrome/<version>` string loaded that page from the server with no challenge.
 * So the box browser presents the user agent this Chromium would send with a
 * window: the same version and platform, without the `Headless` prefix.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Chrome's reduced user agent: the real platform token and the major version, minor parts zeroed. */
export function windowedUserAgent(majorVersion: string, host: { platform: NodeJS.Platform; arch: string }): string {
  const platformToken = host.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : `X11; Linux ${host.arch === "arm64" ? "aarch64" : "x86_64"}`;
  return `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVersion}.0.0.0 Safari/537.36`;
}

/** The major version in a `chrome --version` line ("Google Chrome for Testing 157.0.8103.38"), or null. */
export function majorVersionOf(versionLine: string): string | null {
  return /\b(\d+)(?:\.\d+){3}\b/.exec(versionLine)?.[1] ?? null;
}

/**
 * The Chrome major version used when the browser's own cannot be read: on a
 * developer's machine (agent-browser picks the browser, so there is no path to
 * ask) or when `--version` fails. A recent stable version; a user agent a few
 * versions behind the real browser is ordinary, a `HeadlessChrome` one is not.
 */
const FALLBACK_MAJOR_VERSION = "157";

async function readMajorVersion(executablePath: string | undefined): Promise<string> {
  if (executablePath === undefined) return FALLBACK_MAJOR_VERSION;
  try {
    const { stdout } = await execFileAsync(executablePath, ["--version"], { timeout: 10_000, encoding: "utf8" });
    const major = majorVersionOf(stdout);
    if (major !== null) return major;
    console.warn(`[browser] could not read a version from "${stdout.trim()}"; using Chrome ${FALLBACK_MAJOR_VERSION} in the user agent`);
  } catch (error) {
    console.warn(`[browser] ${executablePath} --version failed; using Chrome ${FALLBACK_MAJOR_VERSION} in the user agent:`, error);
  }
  return FALLBACK_MAJOR_VERSION;
}

/**
 * The windowed user agent for the Chromium at `executablePath`. Always a
 * plain Chrome string: its own version when it can be read, else a recent one.
 */
export async function boxBrowserUserAgent(executablePath: string | undefined): Promise<string> {
  return windowedUserAgent(await readMajorVersion(executablePath), { platform: process.platform, arch: process.arch });
}
