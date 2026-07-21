// Serve the generated static site (site/dist/) at /<name>/site/, straight from
// disk so it never cold-starts the worktree — same properties as
// router-docs.ts's serveDevArtifact (pure disk reads, no-store, traversal
// guard) but with static-SITE semantics: index.html at directory paths, NO
// directory listings.
//
// Auto-build (boxholder 2026-07-21, "It should be auto-building somehow" /
// "I don't want stale builds"): before serving, the router compares the current
// site sources against the manifest the generator wrote into dist/ and rebuilds
// on ANY difference (content-hash based — deletion/rename-correct and
// clock-independent; missing/unparseable manifest → rebuild). Builds are
// serialized per checkout (concurrent requests await one build), and a build
// failure is loud: 500 with the build's actual error output. The 404-with-hint
// remains only for a checkout that has no site/ generator at all (old worktree).
//
// This is a separate handler, not a reuse of serveDevArtifact (which renders
// directory listings and Markdoc).

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { isStale } from "../site/sources.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function contentTypeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const type = CONTENT_TYPES[ext];
  return type === undefined ? "application/octet-stream" : type;
}

/**
 * Resolve the on-disk target for a site-relative request path, applying the
 * traversal guard and static-index rules. Returns a discriminated result the
 * caller turns into an HTTP response. Pure except for the fs.stat probe.
 */
export async function resolveSiteTarget(params: {
  distRoot: string;
  rel: string;
}): Promise<
  | { kind: "file"; abs: string }
  | { kind: "redirect" }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "no-dist" }
> {
  const { distRoot, rel } = params;
  try {
    await fs.stat(distRoot);
  } catch {
    return { kind: "no-dist" };
  }

  const resolved = path.resolve(distRoot, `.${rel || "/"}`);
  if (resolved !== distRoot && !resolved.startsWith(distRoot + path.sep)) {
    return { kind: "forbidden" };
  }

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    return { kind: "not-found" };
  }

  if (stat.isDirectory()) {
    // Directory paths serve index.html; canonicalize to a trailing slash first
    // so relative asset URLs resolve correctly in the browser.
    if (!rel.endsWith("/")) return { kind: "redirect" };
    const indexPath = path.join(resolved, "index.html");
    try {
      await fs.stat(indexPath);
    } catch {
      return { kind: "not-found" };
    }
    return { kind: "file", abs: indexPath };
  }
  return { kind: "file", abs: resolved };
}

/** How to (re)build a checkout's site. Injectable so tests need not spawn pnpm. */
export type BuildRunner = (params: { repoRoot: string; siteDir: string }) => Promise<void>;

/** Thrown by the default runner when the build exits non-zero; carries its output. */
export class SiteBuildError extends Error {
  readonly output: string;
  constructor(output: string) {
    super("site build failed");
    this.name = "SiteBuildError";
    this.output = output;
  }
}

const defaultBuildRunner: BuildRunner = async ({ repoRoot }) => {
  try {
    await execa("pnpm", ["--dir", "site", "build"], { cwd: repoRoot, timeout: 60_000 });
  } catch (err) {
    const parts: string[] = [];
    if (err instanceof Error && "stderr" in err && typeof err.stderr === "string") parts.push(err.stderr);
    if (err instanceof Error && "stdout" in err && typeof err.stdout === "string") parts.push(err.stdout);
    if (parts.join("").trim() === "") parts.push(err instanceof Error ? err.message : String(err));
    throw new SiteBuildError(parts.join("\n").trim());
  }
};

// One in-flight build per checkout's site dir. Concurrent requests await the
// same promise rather than each spawning a build.
const buildLocks = new Map<string, Promise<void>>();

async function ensureBuilt(params: { repoRoot: string; siteDir: string; distRoot: string; runner: BuildRunner }): Promise<void> {
  const { repoRoot, siteDir, distRoot, runner } = params;
  // Ride an in-flight build if one exists; otherwise decide from the manifest.
  const inflight = buildLocks.get(siteDir);
  if (inflight) {
    await inflight;
    return;
  }
  if (!(await isStale(siteDir, distRoot))) return;

  // Re-check the lock after the async staleness probe: a concurrent request may
  // have started a build meanwhile. The get/set below has no await between the
  // check and the set, so at most one build starts per site dir.
  let started = buildLocks.get(siteDir);
  if (!started) {
    started = runner({ repoRoot, siteDir }).finally(() => buildLocks.delete(siteDir));
    buildLocks.set(siteDir, started);
  }
  await started;
}

/**
 * Dispatch a request under /<name>/site/. `rest` is the URL after /<name>
 * (i.e. it starts with "/site"). `repoRoot` is the caller-resolved worktree
 * root, threaded in like serveDev so this module needs no router.ts config.
 * `buildRunner` is injectable for tests; production uses the pnpm runner.
 */
export async function serveSite(params: {
  name: string;
  rest: string;
  res: http.ServerResponse;
  repoRoot: string;
  buildRunner?: BuildRunner;
}): Promise<void> {
  const { name, rest, res, repoRoot } = params;
  const runner = params.buildRunner === undefined ? defaultBuildRunner : params.buildRunner;
  // Built artifacts are live working material — never let the browser cache them.
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const base = `/${name}/site`;
  const siteDir = path.join(repoRoot, "site");
  const distRoot = path.join(siteDir, "dist");
  const [pathOnly = ""] = rest.split("?");
  const rel = decodeURIComponent(pathOnly.slice("/site".length)); // "" | "/" | "/llms.txt" | ...

  // A checkout with no generator at all (predates the site package) can't be
  // built — keep the 404-with-hint for that case only.
  try {
    await fs.stat(path.join(siteDir, "build.ts"));
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("site not built — run: pnpm --dir site build\n");
    return;
  }

  try {
    await ensureBuilt({ repoRoot, siteDir, distRoot, runner });
  } catch (err) {
    const detail = err instanceof SiteBuildError ? err.output : err instanceof Error ? err.message : String(err);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`site build failed:\n\n${detail}\n`);
    return;
  }

  const target = await resolveSiteTarget({ distRoot, rel });
  switch (target.kind) {
    case "no-dist":
      // The build ran but produced no dist/ — treat as a build failure, not a
      // stale-serve. Never silent.
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("site build produced no dist/ output\n");
      return;
    case "forbidden":
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("forbidden\n");
      return;
    case "redirect":
      res.writeHead(301, { location: `${base}${rel}/` });
      res.end();
      return;
    case "not-found":
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(`not found in site: ${rel}\n`);
      return;
    case "file": {
      const buf = await fs.readFile(target.abs);
      res.writeHead(200, { "content-type": contentTypeFor(target.abs) });
      res.end(buf);
      return;
    }
  }
}
