/**
 * Resolve the path to the Claude Code binary that the agent SDK should
 * spawn, preferring the glibc variant on Linux.
 *
 * The Anthropic agent SDK bundles native binaries as optional npm
 * sub-packages and tries to resolve one at runtime. Its own search order
 * on Linux is musl-first, glibc-fallback, which crashes on glibc hosts
 * when both packages are installed (a common state, since current npm
 * lockfiles don't always carry the `libc` filter that would skip the
 * wrong variant). The SDK reports a misleading "binary not found at
 * <musl path>" because the file exists but the kernel refuses to exec it.
 *
 * See https://github.com/anthropics/claude-agent-sdk-typescript/issues/296.
 *
 * Future: the SDK's bundled binary is frozen at install time; if we
 * want fresher Claude Code versions on long-running servers we need a
 * separate update process (re-run `pnpm update @anthropic-ai/claude-agent-sdk`
 * on a schedule, or add deploy-time pinning policy). The system installer
 * at `~/.local/bin/claude` is *not* what the SDK uses — by Anthropic's
 * design it ignores `$PATH` and looks only at its sub-packages.
 */

import { createRequire } from "node:module";
import { accessSync, constants } from "node:fs";

const require = createRequire(import.meta.url);

/** Cached resolution, computed once per process. */
let cached: string | null | undefined;

/**
 * Returns an absolute path to a usable bundled Claude Code binary, or
 * null if the platform isn't covered by any installed sub-package.
 *
 * Pass the result as `options.pathToClaudeCodeExecutable` on every
 * SDK `query()` call. When null, omit the option and let the SDK do
 * whatever it does — preserves behavior on platforms we haven't
 * thought about (e.g. some BSD with glibc emulation).
 */
export function resolveClaudeCodeBinary(): string | null {
  if (cached !== undefined) return cached;
  cached = doResolve();
  return cached;
}

function doResolve(): string | null {
  const ext = process.platform === "win32" ? ".exe" : "";
  // On Linux: glibc first, musl second. Reverses the SDK's own (broken)
  // order so glibc hosts don't crash trying to exec a musl binary.
  // Off Linux: only one variant per platform, no choice to make.
  const variants: string[] =
    process.platform === "linux"
      ? [`linux-${process.arch}`, `linux-${process.arch}-musl`]
      : [`${process.platform}-${process.arch}`];

  for (const variant of variants) {
    // Resolve `<pkg>/claude` directly — these binary sub-packages don't
    // declare an `exports` field, so subpath resolution works. Resolving
    // the parent SDK's package.json doesn't work because that package
    // *does* declare `exports` and excludes `./package.json`.
    const subpath = `@anthropic-ai/claude-agent-sdk-${variant}/claude${ext}`;
    let resolved: string;
    try {
      resolved = require.resolve(subpath);
    } catch {
      continue;
    }
    try {
      accessSync(resolved, constants.X_OK);
      return resolved;
    } catch {
      // File present but not executable; skip.
    }
  }
  return null;
}
