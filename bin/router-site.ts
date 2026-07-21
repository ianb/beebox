// Serve the generated static site (site/dist/) at /<name>/site/, straight from
// disk so it never cold-starts the worktree — same properties as
// router-docs.ts's serveDevArtifact (pure disk reads, no-store, traversal
// guard) but with static-SITE semantics: index.html at directory paths, NO
// directory listings, and a 404-with-hint when dist/ hasn't been built yet.
//
// This is a separate handler, not a reuse of serveDevArtifact (which renders
// directory listings and Markdoc). The site is precompiled; the router only
// reads bytes.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

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

/**
 * Dispatch a request under /<name>/site/. `rest` is the URL after /<name>
 * (i.e. it starts with "/site"). `repoRoot` is the caller-resolved worktree
 * root, threaded in like serveDev so this module needs no router.ts config.
 */
export async function serveSite(params: {
  name: string;
  rest: string;
  res: http.ServerResponse;
  repoRoot: string;
}): Promise<void> {
  const { name, rest, res, repoRoot } = params;
  // Built artifacts are live working material — never let the browser cache them.
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const base = `/${name}/site`;
  const distRoot = path.join(repoRoot, "site", "dist");
  const [pathOnly = ""] = rest.split("?");
  const rel = decodeURIComponent(pathOnly.slice("/site".length)); // "" | "/" | "/llms.txt" | ...

  const target = await resolveSiteTarget({ distRoot, rel });
  switch (target.kind) {
    case "no-dist":
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("site not built — run: pnpm --dir site build\n");
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
