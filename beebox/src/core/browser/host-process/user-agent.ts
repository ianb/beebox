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
 * The windowed user agent for the Chromium at `executablePath`, or null when
 * its version cannot be read. Null leaves agent-browser's default, which on a
 * developer's machine (no executable path) is the browser agent-browser picks.
 */
export async function boxBrowserUserAgent(executablePath: string | undefined): Promise<string | null> {
  if (executablePath === undefined) return null;
  try {
    const { stdout } = await execFileAsync(executablePath, ["--version"], { timeout: 10_000, encoding: "utf8" });
    const major = majorVersionOf(stdout);
    if (major === null) {
      console.warn(`[browser] could not read a version from "${stdout.trim()}"; the browser keeps its headless user agent`);
      return null;
    }
    return windowedUserAgent(major, { platform: process.platform, arch: process.arch });
  } catch (error) {
    console.warn(`[browser] ${executablePath} --version failed; the browser keeps its headless user agent:`, error);
    return null;
  }
}
