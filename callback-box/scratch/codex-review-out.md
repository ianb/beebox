OpenAI Codex v0.137.0
--------
workdir: /Users/ianbicking/src/callback-worktrees/remove-cardworks
model: gpt-5.5
provider: openai
approval: never
sandbox: read-only
reasoning effort: high
reasoning summaries: none
session id: 019ee252-4a25-7803-811b-a9fd78166a97
--------
user
IMPORTANT: Do NOT read or execute files under ~/.claude/, ~/.agents/, or .claude/skills/ — those are skill definitions for a different AI runtime and will waste your time. Everything else in this repo, including docs/ and .claude/rules/, is fair game.

This targets the callback-box/ subproject. Paths like src/…, docs/…, test/…, scripts/…, bin/… are under callback-box/; pnpm-workspace.yaml and the top CLAUDE.md are at the monorepo root. You may read any repo file (read-only) to verify claims.

You are an independent, adversarial engineering reviewer. A Claude model produced a branch that REMOVES the `cardworks` XML card library from callback-box, now that every card is YAML-frontmatter (the data migration is already complete — do NOT re-litigate that). Review the branch diff against `main`.

Get the diff yourself and review it:
  git diff main...HEAD --stat        # overview
  git diff main...HEAD -- callback-box/src callback-box/scripts callback-box/bin callback-box/deploy callback-box/package.json pnpm-workspace.yaml
The bulk of the file count is the mechanical deletion of the cardworks/ directory (~6000 deletions) — SKIP that; it is just removing the package. Focus your effort on the callback-box code, build, and migrator changes.

The highest-risk changes to scrutinize, with verify-against-source required:

1. **The frontmatter ref-existence checker** (new src/core/ref-exists.ts, replacing cardworks `loader.resolveRef` in src/core/card-lint.ts). This is the one silent-failure-prone change: a wrong "exists" suppresses a broken-ref warning nobody sees fail. Verify it faithfully reproduces cardworks' ref semantics — read the OLD cardworks refs/parse-ref.ts + refs/resolve.ts via `git show main:cardworks/src/refs/parse-ref.ts` (they're deleted on HEAD). Check: `@version` stripping, `#fragment` ignored for existence, box-root-absolute (`/box/...` → boxRoot+path), `attach/` and bare `attach` scope, relative-to-referring-card. Does the new checker miss any case that would flip a real broken-ref warning on or off?

2. **The LoadedCard union collapse** (src/core/card-io.ts: removed XmlLoadedCard/loadXmlCard; an unrecognized .card now throws CardIOError instead of XML-parsing). Verify every consumer that branched on `kind === "xml"` was correctly updated and none now mis-handles a card. Check the browse-listing rewrites (src/webapp/routes/api-browse.ts, src/webapp/trpc/routers/status.ts) and the scan-import photo write-back rewrite (src/core/commands/scan-import-cards.ts applyBundleAnalysisToCard) — the last one was rewritten from XML element mutation to frontmatter field-setting against the image schema; verify the field names/shapes it writes (status, has-text, rotation, description, text[], subject-bbox) actually match src/schemas/image.tsx, and that it doesn't drop or corrupt data.

3. **The `callback-box/cards` bundle resolution** (C1): package.json exports "./cards" → ./dist/cards/index.js, built by scripts/build-cli.mjs; box-local schemas load it via the tsx resolver in src/schemas/registry.ts. Verify this resolves under BOTH the dist/cli.mjs bundle (Node native type-stripping, which can't follow TS-source `.js` re-exports) and the tsx server path. Is there any path where a box-local schema import of callback-box/cards still breaks (e.g. deploy ships dist/cards or not — see deploy.sh)?

4. **The migrator stubs** (scripts/migrate/*.ts replaced with no-ops; MIGRATIONS entries kept). Verify the claim that they never run: src/core/box.ts seeds a full migrations manifest on `cb init`, and existing boxes are migrated. Is there any path where `cb migrate` would still spawn a stubbed migrator and need its real behavior? Did keeping the MIGRATIONS entries but stubbing the scripts leave anything inconsistent?

5. **card-lint fallback behavior change**: a `.card` whose filename type has no registered schema previously XML-linted; now it yields a non-blocking warning. Verify this doesn't silently pass a genuinely malformed card that used to error.

Also scan for: dead code left behind (unused exports/functions after the removal), any remaining `cardworks` import or reference that would break at runtime, and any place the deletion changed observable behavior without a corresponding test update.

Review priorities: (1) silent failure modes (no test AND no handling AND invisible); (2) data corruption/loss in the rewritten write paths; (3) incorrect claims in commit messages vs the actual code; (4) anything treated as settled that will bite on deploy. Be concrete: cite file:line. Rank by impact. Don't pad. End with the single most important change to make before this merges to main and auto-deploys.

2026-06-19T23:58:24.928952Z ERROR codex_memories_write::phase2: Phase 2 no changes
codex
I’ll review this in code-review mode, against `main`, and I’ll avoid the excluded skill/runtime folders. I’m going to pull the targeted diff plus the old deleted cardworks resolver files first, then trace the risky paths from source rather than trusting the branch description.
exec
/opt/homebrew/bin/bash -lc 'git show main:cardworks/src/refs/parse-ref.ts' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc 'git show main:cardworks/src/refs/resolve.ts' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-teRqKwwK' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-VLwRrIps' (errno=Operation not permitted)
import type { ParsedRef, RefFragment } from "./types.js";

/**
 * Parse a reference string into its components.
 *
 * Reference format: path[@version][#fragment]
 *
 * Examples:
 * - ./Other.card
 * - ./Other.card@1.0.0
 * - ./Other.card#section
 * - ./Other.card@1.0.0#section
 * - ./Other.card#query(//element)
 * - /absolute/path.card@2.0.0#id
 *
 * @param ref - The reference string to parse
 * @returns The parsed reference structure
 */
/**
 * Parse a whitespace-separated list of references.
 *
 * Used for the `refs` attribute which can contain multiple references.
 *
 * @param refs - The refs string (whitespace-separated references)
 * @returns Array of parsed references
 */
export function parseRefs(refs: string): ParsedRef[] {
  return refs
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .map((ref) => parseRef(ref));
}

export function parseRef(ref: string): ParsedRef {
  let remaining = ref;
  let fragment: RefFragment | undefined;
  let version: string | undefined;

  // Extract fragment (after #)
  const fragmentIndex = remaining.indexOf("#");
  if (fragmentIndex !== -1) {
    const fragmentStr = remaining.slice(fragmentIndex + 1);
    remaining = remaining.slice(0, fragmentIndex);
    fragment = parseFragment(fragmentStr);
  }

  // Extract version (after @)
  const versionIndex = remaining.lastIndexOf("@");
  if (versionIndex !== -1) {
    // Make sure @ is not part of a path (e.g., not in the middle of a filename)
    const afterAt = remaining.slice(versionIndex + 1);
    // Version should look like a version string (starts with digit or has version-like pattern)
    if (/^\d/.test(afterAt) || /^v\d/.test(afterAt)) {
      version = afterAt;
      remaining = remaining.slice(0, versionIndex);
    }
  }

  const path = remaining;
  const isAbsolute = path.startsWith("/");

  return {
    path,
    isAbsolute,
    version,
    fragment,
    original: ref,
  };
}

/**
 * Parse a fragment string into its structure.
 */
function parseFragment(fragmentStr: string): RefFragment {
  // Check for query-all(...) syntax (must check before query())
  if (fragmentStr.startsWith("query-all(") && fragmentStr.endsWith(")")) {
    return {
      type: "query-all",
      value: fragmentStr.slice(10, -1), // Extract content between query-all( and )
    };
  }

  // Check for query(...) syntax
  if (fragmentStr.startsWith("query(") && fragmentStr.endsWith(")")) {
    return {
      type: "query",
      value: fragmentStr.slice(6, -1), // Extract content between query( and )
    };
  }

  // Otherwise treat as ID
  return {
    type: "id",
    value: fragmentStr,
  };
}

export type { ParsedRef, RefFragment };

 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-cnpMQEcK' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-7as9RcU9' (errno=Operation not permitted)
import type { FileSystem } from "../fs/types.js";
import type { ElementNode } from "../parser/provenance.js";
import { parseCard } from "../parser/parse.js";
import { parseRef, parseRefs } from "./parse-ref.js";
import { executeXPath } from "./xpath.js";
import type { ResolvedRef, ParsedRef, RefFragment } from "./types.js";

/**
 * Resolve multiple references from a whitespace-separated refs string.
 *
 * @param refs - The refs attribute value (whitespace-separated references)
 * @param resolver - The resolver context
 * @returns Array of resolved references
 */
export async function resolveRefs(
  refs: string,
  resolver: RefResolver
): Promise<ResolvedRef[]> {
  const parsedRefs = parseRefs(refs);
  const results: ResolvedRef[] = [];

  for (const parsed of parsedRefs) {
    const resolved = await resolveRef(parsed.original, resolver);
    results.push(resolved);
  }

  return results;
}

/**
 * Context for resolving references.
 */
export interface RefResolver {
  /** Filesystem to use for reading files */
  fs: FileSystem;
  /** Root directory of the project */
  projectRoot: string;
  /** Path of the file containing the reference */
  currentFile: string;
}

/**
 * Resolve a reference string to its target.
 *
 * @param ref - The reference string to resolve
 * @param resolver - The resolver context
 * @returns The resolved reference result
 */
export async function resolveRef(
  ref: string,
  resolver: RefResolver
): Promise<ResolvedRef> {
  const parsed = parseRef(ref);

  // Resolve the path
  const resolvedPath = resolvePath(parsed, resolver);

  // Check if file exists
  const exists = await resolver.fs.exists(resolvedPath);

  if (!exists) {
    return {
      original: ref,
      parsed,
      resolvedPath,
      exists: false,
      error: `File not found: ${resolvedPath}`,
      versionMismatch: false,
    };
  }

  // Load and parse the target file
  let targetNode: ElementNode;
  try {
    const content = await resolver.fs.read(resolvedPath);
    targetNode = await parseCard(content, { source: resolvedPath });
  } catch (e) {
    return {
      original: ref,
      parsed,
      resolvedPath,
      exists: true,
      error: `Failed to parse ${resolvedPath}: ${e instanceof Error ? e.message : String(e)}`,
      versionMismatch: false,
    };
  }

  // Extract version from target
  const actualVersion = targetNode.attrs["version"];

  // Check version mismatch
  const versionMismatch =
    parsed.version !== undefined &&
    actualVersion !== undefined &&
    parsed.version !== actualVersion;

  // Resolve fragment if specified
  let fragment: ElementNode | undefined;
  let fragments: ElementNode[] | undefined;
  let fragmentError: string | undefined;
  let fragmentWarning: string | undefined;

  if (parsed.fragment) {
    const fragmentResult = resolveFragment(parsed.fragment, targetNode);

    if (fragmentResult.error) {
      fragmentError = fragmentResult.error;
    } else if (fragmentResult.warning) {
      fragmentWarning = fragmentResult.warning;
    }

    if (parsed.fragment.type === "query-all") {
      fragments = fragmentResult.nodes;
      if (fragments.length === 0 && !fragmentError) {
        fragmentWarning = `No elements matched query-all: #query-all(${parsed.fragment.value})`;
      }
    } else {
      // id or query - expect single result
      fragment = fragmentResult.nodes[0];
      if (!fragment && !fragmentError) {
        fragmentError = `Fragment not found: ${formatFragment(parsed.fragment)}`;
      }
    }
  }

  const result: ResolvedRef = {
    original: ref,
    parsed,
    resolvedPath,
    exists: true,
    requestedVersion: parsed.version,
    actualVersion,
    versionMismatch,
  };

  // Add optional fields only if defined
  if (fragment !== undefined) {
    result.fragment = fragment;
  }
  if (fragments !== undefined) {
    result.fragments = fragments;
  }
  if (fragmentError !== undefined) {
    result.fragmentError = fragmentError;
  }
  if (fragmentWarning !== undefined) {
    result.fragmentWarning = fragmentWarning;
  }

  return result;
}

/**
 * Format a fragment for error messages.
 */
function formatFragment(fragment: RefFragment): string {
  switch (fragment.type) {
    case "id":
      return `#${fragment.value}`;
    case "query":
      return `#query(${fragment.value})`;
    case "query-all":
      return `#query-all(${fragment.value})`;
  }
}

/**
 * Resolve a path from a parsed reference.
 *
 * The path part of a ref is one of:
 * - Absolute (`/box/...`) — resolved against project root
 * - `attach/<rest>` — virtual prefix; resolved against the current card's
 *   attach scope (`<basename>.attach/`)
 * - Relative — resolved from the current file's directory
 */
function resolvePath(parsed: ParsedRef, resolver: RefResolver): string {
  if (parsed.isAbsolute) {
    return resolver.projectRoot + parsed.path;
  }

  // `attach/` virtual prefix — resolve against the current card's
  // <basename>.attach/ scope.
  if (parsed.path === "attach" || parsed.path.startsWith("attach/")) {
    const attachDir = computeAttachDir(resolver.currentFile);
    if (attachDir !== null) {
      const rest = parsed.path === "attach" ? "" : parsed.path.slice("attach/".length);
      return rest === "" ? attachDir : `${attachDir}/${rest}`;
    }
  }

  return resolver.fs.resolve(resolver.currentFile, parsed.path);
}

/**
 * Given a card's absolute path, return its attach scope directory:
 * `<basename>.attach` next to the card. Returns null if the path doesn't
 * look like a `.card` file.
 */
function computeAttachDir(cardPath: string): string | null {
  const slash = cardPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : cardPath.slice(0, slash);
  const name = slash === -1 ? cardPath : cardPath.slice(slash + 1);
  if (!name.endsWith(".card")) return null;
  const withoutCard = name.slice(0, -".card".length);
  const lastDot = withoutCard.lastIndexOf(".");
  const basename = lastDot === -1 ? withoutCard : withoutCard.slice(0, lastDot);
  const attachName = `${basename}.attach`;
  return dir === "" ? attachName : `${dir}/${attachName}`;
}

/**
 * Result of resolving a fragment.
 */
interface FragmentResult {
  nodes: ElementNode[];
  error?: string;
  warning?: string;
}

/**
 * Resolve a fragment within a parsed document.
 */
function resolveFragment(fragment: RefFragment, root: ElementNode): FragmentResult {
  if (fragment.type === "id") {
    const node = findById(root, fragment.value);
    return { nodes: node ? [node] : [] };
  }

  // XPath query
  const expectOne = fragment.type === "query";
  const xpathResult = executeXPath(fragment.value, { root, expectOne });

  const result: FragmentResult = { nodes: xpathResult.nodes };
  if (xpathResult.error !== undefined) {
    result.error = xpathResult.error;
  }
  if (xpathResult.warning !== undefined) {
    result.warning = xpathResult.warning;
  }
  return result;
}

/**
 * Find an element by its id attribute.
 */
function findById(node: ElementNode, id: string): ElementNode | undefined {
  if (node.attrs["id"] === id) {
    return node;
  }

  for (const child of node.children) {
    const found = findById(child, id);
    if (found) {
      return found;
    }
  }

  return undefined;
}

export type { ResolvedRef };

exec
/opt/homebrew/bin/bash -lc 'git diff main...HEAD -- callback-box/src callback-box/scripts callback-box/bin callback-box/deploy callback-box/package.json pnpm-workspace.yaml' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-1FKKmde1' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-avjGeGeT' (errno=Operation not permitted)
diff --git a/callback-box/bin/cb b/callback-box/bin/cb
index 51642267..d11e1e6d 100755
--- a/callback-box/bin/cb
+++ b/callback-box/bin/cb
@@ -59,13 +59,6 @@ fi
 # the frontend tree, which is spawned separately and not in the bundle) is
 # newer than it. Pruning src/frontend keeps this scan ~5ms even on a fresh
 # bundle. package.json is checked too so dependency changes trigger a rebuild.
-#
-# cardworks/dist is checked as well: it's a sibling workspace package inlined
-# into the bundle (consumed via `link:../cardworks`), so a cardworks rebuild
-# must invalidate our bundle too. Without this, a stale inlined cardworks
-# silently ships an old API surface — exactly how chat broke when cardworks'
-# named-params refactor landed but the bundle wasn't rebundled. `-L` follows
-# the node_modules symlink into the live build.
 needs_build=0
 if [ ! -f "$BUNDLE" ]; then
   needs_build=1
@@ -73,8 +66,6 @@ elif [ "$PROJECT_DIR/package.json" -nt "$BUNDLE" ]; then
   needs_build=1
 elif [ -n "$(find "$PROJECT_DIR/src" -path "$PROJECT_DIR/src/frontend" -prune -o -name '*.ts' -newer "$BUNDLE" -print -quit 2>/dev/null)" ]; then
   needs_build=1
-elif [ -n "$(find -L "$PROJECT_DIR/node_modules/cardworks/dist" -name '*.js' -newer "$BUNDLE" -print -quit 2>/dev/null)" ]; then
-  needs_build=1
 fi
 
 if [ "$needs_build" = 1 ]; then
diff --git a/callback-box/deploy/README.md b/callback-box/deploy/README.md
index 575616f2..b112960c 100644
--- a/callback-box/deploy/README.md
+++ b/callback-box/deploy/README.md
@@ -40,7 +40,7 @@ What it does:
 
 Installs everything on Ubuntu 24.04:
 - System packages (git, Node.js 22, nginx)
-- Clones and builds: cardworks → callback-box
+- Clones and builds: callback-box
 - Symlinks `cb` CLI to `/usr/local/bin/`
 - Installs Claude Code CLI (native installer — auto-updates in background)
 - Creates systemd services for web server and scheduler
@@ -65,7 +65,7 @@ Each box is served at `https://box.example.com/<box-name>/`.
 
 ### `rebuild.sh` — Pull latest code and rebuild
 
-Pulls both repos (cardworks, callback-box), rebuilds, and restarts services.
+Pulls callback-box, rebuilds, and restarts services.
 
 ```bash
 ./deploy/rebuild.sh
@@ -87,7 +87,6 @@ Uses agent forwarding (`-A`) so your local SSH key works for GitHub operations o
 
 ```
 /opt/callback/              # Source code
-  cardworks/
   callback-box/
 /home/callback/boxes/       # Box data (each is a git repo)
   test1/
diff --git a/callback-box/deploy/deploy.sh b/callback-box/deploy/deploy.sh
index 68f02d3a..f0f88485 100755
--- a/callback-box/deploy/deploy.sh
+++ b/callback-box/deploy/deploy.sh
@@ -47,26 +47,24 @@ if [[ "$SKIP_FRONTEND" != true ]]; then
   cd "$REPO_DIR/src/frontend" && pnpm --silent build
 fi
 
-# Build cardworks locally before syncing. The server consumes it through a
-# workspace symlink (callback-box/node_modules/cardworks -> ../../cardworks)
-# and the remote deploy step installs deps but never builds cardworks. So the
-# dist/ we rsync must already match the source we rsync. cardworks/dist is
-# gitignored, so rsync ships whatever build is on disk here; a stale one once
-# shipped an old API surface that crashed `cb validate` and hung chat. Always
-# rebuild so source and dist stay in lockstep on the server.
-if [[ -d "$MONO_DIR/cardworks" ]]; then
-  echo "Building cardworks..."
-  cd "$MONO_DIR/cardworks" && pnpm --silent build
-fi
+# Build the CLI bundle locally before syncing. dist/ is rsynced (not excluded),
+# and while the server runs cb via tsx (not the bundle), it DOES need
+# dist/cards/index.js on disk: box-local schema files import `callback-box/cards`,
+# which package.json `exports` maps to ./dist/cards/index.js (a plain-JS build of
+# the card-primitive layer, emitted by build-cli.mjs alongside dist/cli.mjs). If
+# that file is missing or stale on the server, every box-local schema fails to
+# load. Building here keeps dist/ in lockstep with the source we rsync.
+echo "Building CLI bundle (dist/cli.mjs + dist/cards)..."
+cd "$REPO_DIR" && node scripts/build-cli.mjs >/dev/null
 
 # Sync monorepo packages. These are pnpm workspace members linked via
 # `workspace:*` deps, so they must all be present alongside callback-box on the
 # server for the root `pnpm install` to resolve. personal-vibe-check and
 # agent-doctest are devDeps of callback-box (the server install is non-prod
-# because the runtime uses tsx, itself a devDep); cardworks is a runtime dep.
+# because the runtime uses tsx, itself a devDep).
 # browse/agent-browser-typed are deliberately NOT synced — they're dev-only
 # tooling and a partial workspace installs fine (pnpm ignores absent members).
-for repo in cardworks personal-vibe-check agent-doctest callback-box; do
+for repo in personal-vibe-check agent-doctest callback-box; do
   local_path="$MONO_DIR/$repo/"
   if [[ ! -d "$local_path" ]]; then
     echo "  $repo: not found at $local_path, skipping"
@@ -107,6 +105,13 @@ ssh -A "root@$SERVER_IP" bash -s <<'REMOTE'
     echo "  Removing stale /opt/personal-vibe-check (superseded by /opt/callback/personal-vibe-check)..."
     rm -rf /opt/personal-vibe-check
   fi
+  # One-time cleanup: the cardworks package was removed (absorbed into
+  # callback-box/src/cards). The deploy no longer syncs it, so an old
+  # /opt/callback/cardworks just lingers — drop it idempotently.
+  if [[ -d /opt/callback/cardworks ]]; then
+    echo "  Removing stale /opt/callback/cardworks (package removed)..."
+    rm -rf /opt/callback/cardworks
+  fi
   # One-time cutover from the old per-subdir installs to a single workspace
   # install. Before this change each subdir had its own isolated node_modules;
   # the workspace uses a hoisted node_modules at the root. Remove the legacy
@@ -139,26 +144,16 @@ REMOTE
 # expansion in the node script body.
 echo "Writing deploy info..."
 DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
-CARDWORKS_HASH=""
-CARDWORKS_SUBJECT=""
 CALLBACK_BOX_HASH=""
 CALLBACK_BOX_SUBJECT=""
-if [[ -d "$MONO_DIR/cardworks/.git" ]]; then
-  CARDWORKS_HASH=$(cd "$MONO_DIR/cardworks" && git rev-parse --short HEAD)
-  CARDWORKS_SUBJECT=$(cd "$MONO_DIR/cardworks" && git log -1 --format=%s)
-fi
 if [[ -d "$MONO_DIR/callback-box/.git" ]]; then
   CALLBACK_BOX_HASH=$(cd "$MONO_DIR/callback-box" && git rev-parse --short HEAD)
   CALLBACK_BOX_SUBJECT=$(cd "$MONO_DIR/callback-box" && git log -1 --format=%s)
 fi
 DEPLOY_INFO=$(DEPLOYED_AT="$DEPLOYED_AT" \
-  CARDWORKS_HASH="$CARDWORKS_HASH" CARDWORKS_SUBJECT="$CARDWORKS_SUBJECT" \
   CALLBACK_BOX_HASH="$CALLBACK_BOX_HASH" CALLBACK_BOX_SUBJECT="$CALLBACK_BOX_SUBJECT" \
   node -e '
 const out = { deployedAt: process.env.DEPLOYED_AT, commits: {} };
-if (process.env.CARDWORKS_HASH) {
-  out.commits.cardworks = { hash: process.env.CARDWORKS_HASH, subject: process.env.CARDWORKS_SUBJECT };
-}
 if (process.env.CALLBACK_BOX_HASH) {
   out.commits["callback-box"] = { hash: process.env.CALLBACK_BOX_HASH, subject: process.env.CALLBACK_BOX_SUBJECT };
 }
diff --git a/callback-box/deploy/rebuild-server.sh b/callback-box/deploy/rebuild-server.sh
index 175680b8..10a84b0f 100755
--- a/callback-box/deploy/rebuild-server.sh
+++ b/callback-box/deploy/rebuild-server.sh
@@ -8,16 +8,11 @@ set -euo pipefail
 INSTALL_DIR="/opt/callback"
 
 echo "=== Pulling latest code ==="
-for repo in cardworks callback-box; do
+for repo in callback-box; do
   echo "  $repo..."
   cd "$INSTALL_DIR/$repo" && git pull --ff-only
 done
 
-echo "=== Rebuilding cardworks ==="
-cd "$INSTALL_DIR/cardworks"
-pnpm install
-pnpm build
-
 echo "=== Rebuilding callback-box ==="
 cd "$INSTALL_DIR/callback-box"
 pnpm install
diff --git a/callback-box/deploy/setup-server.sh b/callback-box/deploy/setup-server.sh
index 609d64f2..8cd42ea0 100755
--- a/callback-box/deploy/setup-server.sh
+++ b/callback-box/deploy/setup-server.sh
@@ -3,7 +3,7 @@ set -euo pipefail
 
 # ── Config ──────────────────────────────────────────────────────────
 REPO_BASE="git@github.com:ianb"
-REPOS=(cardworks callback-box)
+REPOS=(callback-box)
 INSTALL_DIR="/opt/callback"
 CB_USER="callback"
 CB_HOME="/home/$CB_USER"
@@ -69,12 +69,7 @@ for repo in "${REPOS[@]}"; do
   fi
 done
 
-# ── Install and build in dependency order ───────────────────────────
-echo "Building cardworks..."
-cd "$INSTALL_DIR/cardworks"
-pnpm install
-pnpm build
-
+# ── Install and build ───────────────────────────────────────────────
 echo "Installing callback-box..."
 cd "$INSTALL_DIR/callback-box"
 pnpm install
diff --git a/callback-box/package.json b/callback-box/package.json
index a840f478..ece17b1d 100644
--- a/callback-box/package.json
+++ b/callback-box/package.json
@@ -6,7 +6,7 @@
   "main": "dist/cli/index.js",
   "exports": {
     ".": "./dist/cli/index.js",
-    "./cards": "./src/cards/index.ts"
+    "./cards": "./dist/cards/index.js"
   },
   "bin": {
     "cb": "./bin/cb"
@@ -81,7 +81,6 @@
     "@types/ws": "^8.18.1",
     "ansi-to-html": "^0.7.2",
     "better-sqlite3": "^12.6.2",
-    "cardworks": "workspace:*",
     "chalk": "^5.6.2",
     "cheerio": "^1.2.0",
     "chokidar": "^5.0.0",
diff --git a/callback-box/scripts/build-cli.mjs b/callback-box/scripts/build-cli.mjs
index 73f83227..b44cb290 100644
--- a/callback-box/scripts/build-cli.mjs
+++ b/callback-box/scripts/build-cli.mjs
@@ -4,7 +4,7 @@
 //
 // node_modules are externalized (`packages: "external"`): native addons like
 // better-sqlite3 can't be bundled, and loading deps from disk keeps their own
-// __dirname / asset resolution intact. cardworks resolves to its built dist.
+// __dirname / asset resolution intact.
 //
 // An external sourcemap (cli.mjs.map) gives real stack traces under
 // `node --enable-source-maps` without slowing startup — node loads the map
@@ -40,5 +40,25 @@ await rename(join(tmpDir, "cli.mjs.map"), join(distDir, "cli.mjs.map"));
 await rename(join(tmpDir, "cli.mjs"), join(distDir, "cli.mjs"));
 await rm(tmpDir, { recursive: true, force: true });
 
+// Also build the public card-primitive layer (the `callback-box/cards` export)
+// to a single bundled dist/cards/index.js. Box-local schema files import this
+// specifier; it must be plain JS with no TS-source `.js` re-exports, because
+// the CLI loads box schemas with Node's native type-stripping (under the
+// dist/cli.mjs bundle) which does NOT remap `./schema.js` → `schema.ts`.
+// Bundling collapses src/cards/{schema,frontmatter,lint-format,errors}.ts into
+// one file, so there are no internal `.js` specifiers to resolve; zod/yaml stay
+// external (resolved from node_modules at runtime).
+await build({
+  entryPoints: [join(root, "src/cards/index.ts")],
+  outfile: join(distDir, "cards", "index.js"),
+  bundle: true,
+  platform: "node",
+  format: "esm",
+  target: "node22",
+  packages: "external",
+  sourcemap: true,
+  logLevel: "warning",
+});
+
 const ms = Number(process.hrtime.bigint() - t) / 1e6;
 process.stderr.write(`built dist/cli.mjs in ${ms | 0}ms\n`);
diff --git a/callback-box/scripts/clean-broken-refs.ts b/callback-box/scripts/clean-broken-refs.ts
index 9e38afbb..3a4fa83b 100644
--- a/callback-box/scripts/clean-broken-refs.ts
+++ b/callback-box/scripts/clean-broken-refs.ts
@@ -1,320 +1,6 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * One-off data hygiene: remove broken references in a box.
- *
- * Actions, all safe and idempotent:
- *
- *   1. Image card whose filename.ref points to a missing file → delete
- *      the image card (the card is metadata about a JPG that no longer
- *      exists, so the card is orphaned).
- *
- *   2. Capture-session whose photo refs (markdown links to sibling
- *      *.image.card files) point to missing cards → remove the dead
- *      link lines. If no photos remain in the session, delete it too.
- *
- *   3. Record card with dead sources[].ref or persons[].ref → drop the
- *      dead entries. Record body and other fields are untouched. If the
- *      array becomes empty, remove the field.
- *
- *   4. Record persons[].ref using `../../../people/Foo.person.card`
- *      relative form that doesn't resolve → rewrite to absolute
- *      `/people/Foo.person.card` form if the absolute target exists.
- *
- *   5. Intake-job, calendar-review-job, question-followup-job with any
- *      dead items[]/changes[].ref → drop the dead entries. If no
- *      entries remain, delete the job (it has no real work left).
- *
- * Anything outside these categories is reported but not touched.
- *
- * Usage:
- *   pnpm exec tsx scripts/clean-broken-refs.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/clean-broken-refs.ts <boxRoot> --apply
+ * Retired one-time repair script — it parsed legacy XML cards via the
+ * `cardworks` package, which has been removed now that every box is
+ * frontmatter. Kept as a no-op stub for git history; safe to delete.
  */
-
-import { readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
-import { basename, dirname, join, relative, resolve } from "node:path";
-import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
-import { splitCardContent } from "cardworks";
-
-interface Action {
-  kind: "delete-card" | "prune-refs" | "rewrite-ref";
-  file: string;
-  detail: string;
-}
-
-const actions: Action[] = [];
-const unhandled: string[] = [];
-
-async function pathExists(p: string): Promise<boolean> {
-  try { await stat(p); return true; } catch { return false; }
-}
-
-function isCardFile(name: string): boolean { return name.endsWith(".card"); }
-
-async function walk(dir: string, out: string[]): Promise<void> {
-  let entries;
-  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
-  for (const e of entries) {
-    if (e.name === ".git" || e.name === "node_modules") continue;
-    const full = join(dir, e.name);
-    if (e.isDirectory()) await walk(full, out);
-    else if (e.isFile() && isCardFile(e.name)) out.push(full);
-  }
-}
-
-function typeFromFilename(absPath: string): string | undefined {
-  const m = basename(absPath).match(/^.+\.([^.]+)\.card$/);
-  return m ? m[1] : undefined;
-}
-
-/**
- * Resolve a ref the way cardworks does (subset): absolute = box-root;
- * `attach/...` = source card's <basename>.attach/ scope; everything
- * else = relative to source card's directory.
- */
-interface RefCtx { boxRoot: string; sourceCardAbs: string }
-
-function resolveRefPath(ctx: RefCtx, ref: string): string {
-  const { boxRoot, sourceCardAbs } = ctx;
-  if (ref.startsWith("/")) return join(boxRoot, ref.slice(1));
-  if (ref === "attach" || ref.startsWith("attach/")) {
-    const base = basename(sourceCardAbs).replace(/\.card$/, "");
-    const stem = base.replace(/\.[^.]+$/, "");
-    const attachDir = join(dirname(sourceCardAbs), `${stem}.attach`);
-    const rest = ref === "attach" ? "" : ref.slice("attach/".length);
-    return rest === "" ? attachDir : join(attachDir, rest);
-  }
-  return join(dirname(sourceCardAbs), ref);
-}
-
-interface FrontmatterParts { fmText: string; body: string }
-
-function readCardParts(content: string): FrontmatterParts | null {
-  const split = splitCardContent(content);
-  if (!split.hasFrontmatter) return null;
-  return { fmText: split.frontmatterText, body: split.body };
-}
-
-function writeCardParts(fields: Record<string, unknown>, body: string): string {
-  return `---\n${stringifyYaml(fields)}---\n${body}`;
-}
-
-interface HandleCtx { absPath: string; boxRoot: string; apply: boolean }
-
-async function handleImageCard(ctx: HandleCtx): Promise<void> {
-  const { absPath, boxRoot, apply } = ctx;
-  const content = await readFile(absPath, "utf8");
-  const parts = readCardParts(content);
-  if (parts === null) return;
-  let fields: Record<string, unknown>;
-  try { fields = parseYaml(parts.fmText) as Record<string, unknown>; } catch { return; }
-  if (fields === null) return;
-  const filename = fields["filename"] as { ref?: string } | undefined;
-  if (filename === undefined || typeof filename.ref !== "string") return;
-  const targetPath = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, filename.ref);
-  if (await pathExists(targetPath)) return;
-  actions.push({ kind: "delete-card", file: absPath, detail: `missing ${filename.ref}` });
-  if (apply) await unlink(absPath);
-}
-
-async function handleCaptureSession(ctx: HandleCtx): Promise<void> {
-  const { absPath, boxRoot, apply } = ctx;
-  // Capture-session is legacy XML; photo refs sit on their own lines as
-  // bare paths inside the <photos> block. Match any line that contains
-  // a `*.image.card` token (allowing spaces, accented chars, absolute
-  // and relative forms). Resolve each via the standard ref resolver
-  // and drop the line if the target's gone.
-  const raw = await readFile(absPath, "utf8");
-  // Two forms appear on photo-ref lines:
-  //   <image-ref ref="./photo-001-Foo.image.card"/>   ← XML attr form
-  //   ./photo-001.image.card                          ← bare path on its line
-  // Try the quoted form first (preserves spaces in names), then bare.
-  const lines = raw.split("\n");
-  const kept: string[] = [];
-  let dead = 0;
-  let totalRefs = 0;
-  for (const line of lines) {
-    let ref: string | undefined;
-    const quoted = line.match(/ref=["']([^"']*\.image\.card)["']/);
-    if (quoted !== null) {
-      ref = quoted[1];
-    } else {
-      // eslint-disable-next-line security/detect-unsafe-regex -- bounded by line length, capture-session lines are short
-      const bare = line.match(/^\s*((?:\.{0,2}\/)?[^\s]\S*\.image\.card)\s*$/);
-      if (bare !== null) ref = bare[1];
-    }
-    if (ref === undefined) { kept.push(line); continue; }
-    totalRefs++;
-    const target = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, ref);
-    const exists = await pathExists(target);
-    if (exists) kept.push(line);
-    else dead++;
-  }
-  if (dead === 0) return;
-  const newRaw = kept.join("\n");
-  // If every photo ref is now gone, the session has no work product to
-  // point at — delete it.
-  if (dead === totalRefs) {
-    actions.push({ kind: "delete-card", file: absPath, detail: `no photos remain (was ${String(totalRefs)})` });
-    if (apply) await unlink(absPath);
-    return;
-  }
-  actions.push({ kind: "prune-refs", file: absPath, detail: `dropped ${String(dead)} of ${String(totalRefs)} photo ref line(s)` });
-  if (apply) await writeFile(absPath, newRaw);
-}
-
-async function handleRecord(ctx: HandleCtx): Promise<void> {
-  const { absPath, boxRoot, apply } = ctx;
-  const content = await readFile(absPath, "utf8");
-  const parts = readCardParts(content);
-  if (parts === null) return;
-  let fields: Record<string, unknown>;
-  try { fields = parseYaml(parts.fmText) as Record<string, unknown>; } catch { return; }
-  if (fields === null) return;
-  let mutated = false;
-  const droppedSources: string[] = [];
-  const droppedPersons: string[] = [];
-  const rewrittenPersons: string[] = [];
-
-  const sources = fields["sources"] as Array<{ ref?: string }> | undefined;
-  if (Array.isArray(sources)) {
-    const kept: typeof sources = [];
-    for (const s of sources) {
-      const ref = typeof s.ref === "string" ? s.ref : undefined;
-      if (ref === undefined) { kept.push(s); continue; }
-      const target = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, ref);
-      if (await pathExists(target)) { kept.push(s); continue; }
-      droppedSources.push(ref);
-      mutated = true;
-    }
-    if (kept.length === 0) delete fields["sources"];
-    else fields["sources"] = kept;
-  }
-
-  const persons = fields["persons"] as Array<{ ref?: string; name?: string }> | undefined;
-  if (Array.isArray(persons)) {
-    const kept: typeof persons = [];
-    for (const p of persons) {
-      const ref = typeof p.ref === "string" ? p.ref : undefined;
-      if (ref === undefined) { kept.push(p); continue; }
-      const target = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, ref);
-      if (await pathExists(target)) { kept.push(p); continue; }
-      // Try absolute-rewrite if ref ends in `.person.card`.
-      const personFile = basename(ref);
-      if (personFile.endsWith(".person.card")) {
-        const absAlt = join(boxRoot, "people", personFile);
-        if (await pathExists(absAlt)) {
-          p.ref = `/people/${personFile}`;
-          kept.push(p);
-          rewrittenPersons.push(`${ref} → /people/${personFile}`);
-          mutated = true;
-          continue;
-        }
-      }
-      droppedPersons.push(ref);
-      mutated = true;
-    }
-    if (kept.length === 0) delete fields["persons"];
-    else fields["persons"] = kept;
-  }
-
-  if (!mutated) return;
-  const messages: string[] = [];
-  if (droppedSources.length > 0) messages.push(`dropped ${String(droppedSources.length)} source(s)`);
-  if (droppedPersons.length > 0) messages.push(`dropped ${String(droppedPersons.length)} person(s)`);
-  if (rewrittenPersons.length > 0) messages.push(`rewrote ${String(rewrittenPersons.length)} person ref(s)`);
-  actions.push({ kind: rewrittenPersons.length > 0 ? "rewrite-ref" : "prune-refs", file: absPath, detail: messages.join(", ") });
-  if (apply) await writeFile(absPath, writeCardParts(fields, parts.body));
-}
-
-async function handleJob(ctx: HandleCtx & { listKey: "items" | "changes" }): Promise<void> {
-  const { absPath, boxRoot, apply, listKey } = ctx;
-  const content = await readFile(absPath, "utf8");
-  const parts = readCardParts(content);
-  if (parts === null) return;
-  let fields: Record<string, unknown>;
-  try { fields = parseYaml(parts.fmText) as Record<string, unknown>; } catch { return; }
-  if (fields === null) return;
-  const list = fields[listKey] as Array<{ ref?: string }> | undefined;
-  if (!Array.isArray(list)) return;
-  const kept: typeof list = [];
-  let dropped = 0;
-  for (const item of list) {
-    const ref = typeof item.ref === "string" ? item.ref : undefined;
-    if (ref === undefined) { kept.push(item); continue; }
-    const target = resolveRefPath({ boxRoot, sourceCardAbs: absPath }, ref);
-    if (await pathExists(target)) { kept.push(item); continue; }
-    dropped++;
-  }
-  if (dropped === 0) return;
-  if (kept.length === 0) {
-    actions.push({ kind: "delete-card", file: absPath, detail: `all ${String(dropped)} ${listKey} dead — deleting job` });
-    if (apply) await unlink(absPath);
-    return;
-  }
-  fields[listKey] = kept;
-  actions.push({ kind: "prune-refs", file: absPath, detail: `dropped ${String(dropped)} dead ${listKey}` });
-  if (apply) await writeFile(absPath, writeCardParts(fields, parts.body));
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxRoot = positional[0];
-  if (boxRoot === undefined) {
-    console.error("Usage: clean-broken-refs <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const abs = resolve(boxRoot);
-  const cards: string[] = [];
-  await walk(abs, cards);
-  console.log(`Scanning ${String(cards.length)} cards under ${abs}${apply ? " (APPLY)" : " (dry-run)"}`);
-
-  for (const card of cards) {
-    const type = typeFromFilename(card);
-    if (type === undefined) continue;
-    try {
-      switch (type) {
-        case "image":
-          await handleImageCard({ absPath: card, boxRoot: abs, apply });
-          break;
-        case "capture-session":
-          await handleCaptureSession({ absPath: card, boxRoot: abs, apply });
-          break;
-        case "record":
-          await handleRecord({ absPath: card, boxRoot: abs, apply });
-          break;
-        case "intake-job":
-        case "question-followup-job":
-          await handleJob({ absPath: card, boxRoot: abs, apply, listKey: "items" });
-          break;
-        case "calendar-review-job":
-          await handleJob({ absPath: card, boxRoot: abs, apply, listKey: "changes" });
-          break;
-        default:
-          break;
-      }
-    } catch (e) {
-      unhandled.push(`${relative(abs, card)}: ${(e as Error).message}`);
-    }
-  }
-
-  const grouped: Record<string, number> = {};
-  for (const a of actions) {
-    const key = `${a.kind} (${typeFromFilename(a.file) ?? "?"})`;
-    grouped[key] = (grouped[key] ?? 0) + 1;
-  }
-  console.log("\nSummary:");
-  for (const [k, v] of Object.entries(grouped).sort()) {
-    console.log(`  ${String(v).padStart(4)}  ${k}`);
-  }
-  if (unhandled.length > 0) {
-    console.log(`\n${String(unhandled.length)} error(s):`);
-    for (const u of unhandled.slice(0, 20)) console.log(`  ${u}`);
-  }
-  if (!apply) console.log("\nDry run. Pass --apply to perform.");
-}
-
-main().catch((e) => { console.error(e); process.exit(1); });
+console.log("retired (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/_warnings.ts b/callback-box/scripts/migrate/_warnings.ts
index 765a0bee..e9f6bd72 100644
--- a/callback-box/scripts/migrate/_warnings.ts
+++ b/callback-box/scripts/migrate/_warnings.ts
@@ -15,7 +15,19 @@
  */
 
 import { relative } from "node:path";
-import type { ElementNode } from "cardworks";
+
+/**
+ * Minimal XML element shape — the subset the field-loss checker walks. The
+ * (now-retired) XML migrators that call `checkElement` passed structurally
+ * matching nodes; defining it locally keeps this shared helper free of the
+ * deleted `cardworks` package.
+ */
+interface ElementNode {
+  tagName: string;
+  attrs: Record<string, unknown>;
+  children: ElementNode[];
+  text?: string;
+}
 
 export interface Warning {
   file: string;
diff --git a/callback-box/scripts/migrate/audio.ts b/callback-box/scripts/migrate/audio.ts
index 8d67864a..9d9dfe60 100644
--- a/callback-box/scripts/migrate/audio.ts
+++ b/callback-box/scripts/migrate/audio.ts
@@ -1,160 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Phase 2 (per-schema): migrate `.audio.card` files from Phase 1
- * frontmatter-with-XML-body to flat frontmatter.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Usage:
- *   pnpm exec tsx scripts/migrate/audio.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/audio.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, readdir, writeFile } from "node:fs/promises";
-import { join, relative, resolve } from "node:path";
-import { parseCard, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const SPEC: ElementSpec = {
-  attrs: ["status", "version"],
-  children: {
-    filename: { attrs: ["ref", "recorded", "source", "duration"] },
-    summary: { attrs: [] },
-    transcript: { attrs: [] },
-    "transcription-error": { attrs: ["permanent", "code", "attempted-at"] },
-  },
-};
-
-const warnings = new WarningCollector();
-
-async function findCards(root: string): Promise<string[]> {
-  const out: string[] = [];
-  async function walk(dir: string): Promise<void> {
-    let entries;
-    try {
-      entries = await readdir(dir, { withFileTypes: true });
-    } catch (e) {
-      const err = e as NodeJS.ErrnoException;
-      if (err.code === "ENOENT") return;
-      throw e;
-    }
-    for (const entry of entries) {
-      if (entry.name === ".git" || entry.name === "node_modules") continue;
-      const full = join(dir, entry.name);
-      if (entry.isDirectory()) {
-        await walk(full);
-      } else if (entry.isFile() && entry.name.endsWith(".audio.card")) {
-        out.push(full);
-      }
-    }
-  }
-  await walk(root);
-  return out;
-}
-
-function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
-  return node.children.find((c) => c.tagName === tagName);
-}
-
-function convertOne(node: ElementNode, source: string): Record<string, unknown> {
-  if (node.tagName !== "audio") {
-    throw new Error(`${source}: expected <audio> root, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = {
-    type: "audio",
-    status: node.attrs["status"] ?? "new",
-  };
-  const filenameEl = firstChild(node, "filename");
-  if (filenameEl === undefined) {
-    throw new Error(`${source}: missing <filename>`);
-  }
-  const ref = filenameEl.attrs["ref"];
-  const recorded = filenameEl.attrs["recorded"];
-  const fSource = filenameEl.attrs["source"];
-  if (ref === undefined || recorded === undefined || fSource === undefined) {
-    throw new Error(`${source}: <filename> missing ref/recorded/source`);
-  }
-  const filename: Record<string, unknown> = { ref, recorded, source: fSource };
-  if (filenameEl.attrs["duration"] !== undefined) {
-    filename["duration"] = filenameEl.attrs["duration"];
-  }
-  fields["filename"] = filename;
-
-  const summaryEl = firstChild(node, "summary");
-  if (summaryEl !== undefined && summaryEl.text !== undefined && summaryEl.text !== "") {
-    fields["summary"] = summaryEl.text;
-  }
-
-  const transcriptEl = firstChild(node, "transcript");
-  if (transcriptEl !== undefined && transcriptEl.text !== undefined && transcriptEl.text !== "") {
-    fields["transcript"] = transcriptEl.text;
-  }
-
-  const errorEl = firstChild(node, "transcription-error");
-  if (errorEl !== undefined && errorEl.text !== undefined && errorEl.text !== "") {
-    const err: Record<string, unknown> = {
-      permanent: errorEl.attrs["permanent"] === "true",
-      message: errorEl.text,
-    };
-    if (errorEl.attrs["code"] !== undefined) err["code"] = errorEl.attrs["code"];
-    if (errorEl.attrs["attempted-at"] !== undefined) err["attempted-at"] = errorEl.attrs["attempted-at"];
-    fields["transcription-error"] = err;
-  }
-
-  return fields;
-}
-
-async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
-  const raw = await readFile(absPath, "utf8");
-  // Already frontmatter (or empty/degenerate) — only an XML card starts with "<".
-  if (!raw.trimStart().startsWith("<")) {
-    return "already-migrated";
-  }
-  const node = await parseCard(raw, { source: absPath });
-  checkElement({ node, source: absPath, spec: SPEC, warnings });
-  const fields = convertOne(node, absPath);
-  const yamlText = stringifyYaml(fields);
-  await writeFile(absPath, `---\n${yamlText}---\n`);
-  return "converted";
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxRoot = positional[0];
-  if (boxRoot === undefined) {
-    console.error("Usage: migrate-audio <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const absRoot = resolve(boxRoot);
-  const cards = await findCards(absRoot);
-  console.log(`Found ${String(cards.length)} *.audio.card files under ${absRoot}`);
-  if (!apply) {
-    console.log("Dry run. Pass --apply to convert.");
-    return;
-  }
-  let converted = 0;
-  let already = 0;
-  const failed: Array<{ file: string; error: string }> = [];
-  for (const f of cards) {
-    try {
-      const r = await migrateFile(f);
-      if (r === "converted") converted++;
-      else already++;
-    } catch (e) {
-      failed.push({ file: f, error: (e as Error).message });
-    }
-  }
-  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
-  for (const f of failed) {
-    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
-  }
-  warnings.dump(absRoot);
-  if (failed.length > 0) process.exit(2);
-}
-
-main().catch((e) => {
-  console.error(e);
-  process.exit(1);
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/bill.ts b/callback-box/scripts/migrate/bill.ts
index 9f2ece6c..9d9dfe60 100644
--- a/callback-box/scripts/migrate/bill.ts
+++ b/callback-box/scripts/migrate/bill.ts
@@ -1,193 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Migrate box-local `*.bill.card` files from the XML body format to all-YAML
- * frontmatter. `bill` is an ledger box-local card type (its schema lives in the
- * box at `config/schemas/bill.ts`).
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Old (XML body):
- *   ---
- *   content-type: application/x-card+xml
- *   ---
- *   <bill status="paid">
- *     <vendor>Fairview Health Services</vendor>
- *     <amount value="3038.95" currency="USD"/>
- *     <due value="upon-receipt"/>
- *     <auto-pay>false</auto-pay>
- *     <account>4690929</account>
- *     <service-address>…</service-address>
- *     <payment><date value="2026-03-19"/><method>check</method><check-number>8010</check-number></payment>
- *     <sources><source ref="…">desc</source></sources>
- *     <notes>…</notes>
- *   </bill>
- *
- * New (frontmatter): status/vendor/amount/currency/due/auto-pay/account/
- *   service-address/payment/sources/notes as flat YAML fields.
- *
- * Usage:
- *   pnpm exec tsx scripts/migrate/bill.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/bill.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, writeFile } from "node:fs/promises";
-import { parseCard, splitCardContent, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { runMigration } from "./_harness.js";
-import { checkElement, type ElementSpec } from "./_warnings.js";
-
-const SPEC: ElementSpec = {
-  attrs: ["status"],
-  children: {
-    vendor: { attrs: [] },
-    amount: { attrs: ["value", "currency"] },
-    due: { attrs: ["value"] },
-    "auto-pay": { attrs: [] },
-    account: { attrs: [] },
-    "service-address": { attrs: [] },
-    payment: {
-      attrs: [],
-      children: {
-        date: { attrs: ["value"] },
-        method: { attrs: [] },
-        "check-number": { attrs: [] },
-        amount: { attrs: ["value", "currency"] },
-        source: { attrs: ["ref"] },
-      },
-    },
-    sources: {
-      attrs: [],
-      children: { source: { attrs: ["ref"] } },
-    },
-    notes: { attrs: [] },
-  },
-};
-
-function text(el: ElementNode): string {
-  return typeof el.text === "string" ? el.text.trim() : "";
-}
-function child(el: ElementNode, tag: string): ElementNode | undefined {
-  return el.children.find((c) => c.tagName === tag);
-}
-function attr(el: ElementNode, name: string): string | undefined {
-  const v = el.attrs[name];
-  return typeof v === "string" && v !== "" ? v : undefined;
-}
-
-function convertSources(el: ElementNode): Array<Record<string, unknown>> {
-  const out: Array<Record<string, unknown>> = [];
-  for (const s of el.children.filter((c) => c.tagName === "source")) {
-    const ref = attr(s, "ref");
-    if (ref === undefined) continue;
-    const entry: Record<string, unknown> = { ref };
-    const note = text(s);
-    if (note !== "") entry.note = note;
-    out.push(entry);
-  }
-  return out;
-}
-
-function convertPayment(el: ElementNode): Record<string, unknown> {
-  const out: Record<string, unknown> = {};
-  const dateEl = child(el, "date");
-  if (dateEl !== undefined) {
-    const v = attr(dateEl, "value");
-    if (v !== undefined) out.date = v;
-  }
-  const methodEl = child(el, "method");
-  if (methodEl !== undefined) {
-    const t = text(methodEl);
-    if (t !== "") out.method = t;
-  }
-  const checkEl = child(el, "check-number");
-  if (checkEl !== undefined) {
-    const t = text(checkEl);
-    if (t !== "") out["check-number"] = t;
-  }
-  const amountEl = child(el, "amount");
-  if (amountEl !== undefined) {
-    const v = attr(amountEl, "value");
-    if (v !== undefined) out.amount = v;
-  }
-  const sourceEl = child(el, "source");
-  if (sourceEl !== undefined) {
-    const r = attr(sourceEl, "ref");
-    if (r !== undefined) out.source = { ref: r };
-  }
-  return out;
-}
-
-await runMigration({
-  description: "Convert box-local *.bill.card XML body → all-YAML frontmatter.",
-  match: (name) => name.endsWith(".bill.card"),
-  convert: async (absPath, { warnings, apply }) => {
-    const content = await readFile(absPath, "utf-8");
-    const split = splitCardContent(content);
-    const isXml = /(^|\n)content-type:\s*application\/x-card\+xml/.test(split.frontmatterText);
-    if (split.hasFrontmatter && !isXml) {
-      // Already frontmatter (no XML content-type marker).
-      return "already";
-    }
-
-    const root = await parseCard(content, { source: absPath });
-    if (root.tagName !== "bill") {
-      throw new Error(`expected <bill> root, got <${root.tagName}>`);
-    }
-    checkElement({ node: root, source: absPath, spec: SPEC, warnings });
-
-    const fields: Record<string, unknown> = {};
-    const status = attr(root, "status");
-    fields.status = status === undefined ? "unpaid" : status;
-
-    const vendorEl = child(root, "vendor");
-    if (vendorEl !== undefined) {
-      const t = text(vendorEl);
-      if (t !== "") fields.vendor = t;
-    }
-    const amountEl = child(root, "amount");
-    if (amountEl !== undefined) {
-      const v = attr(amountEl, "value");
-      if (v !== undefined) fields.amount = v;
-      const c = attr(amountEl, "currency");
-      if (c !== undefined) fields.currency = c;
-    }
-    const dueEl = child(root, "due");
-    if (dueEl !== undefined) {
-      const v = attr(dueEl, "value");
-      if (v !== undefined) fields.due = v;
-    }
-    const autoPayEl = child(root, "auto-pay");
-    if (autoPayEl !== undefined) {
-      const t = text(autoPayEl);
-      if (t !== "") fields["auto-pay"] = t === "true";
-    }
-    const accountEl = child(root, "account");
-    if (accountEl !== undefined) {
-      const t = text(accountEl);
-      if (t !== "") fields.account = t;
-    }
-    const addrEl = child(root, "service-address");
-    if (addrEl !== undefined) {
-      const t = text(addrEl);
-      if (t !== "") fields["service-address"] = t;
-    }
-    const paymentEl = child(root, "payment");
-    if (paymentEl !== undefined) {
-      const p = convertPayment(paymentEl);
-      if (Object.keys(p).length > 0) fields.payment = p;
-    }
-    const sourcesEl = child(root, "sources");
-    if (sourcesEl !== undefined) {
-      const s = convertSources(sourcesEl);
-      if (s.length > 0) fields.sources = s;
-    }
-    const notesEl = child(root, "notes");
-    if (notesEl !== undefined) {
-      const t = text(notesEl);
-      if (t !== "") fields.notes = t;
-    }
-
-    const out = `---\n${stringifyYaml(fields)}---\n`;
-    if (apply) await writeFile(absPath, out, "utf-8");
-    return "converted";
-  },
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/briefing.ts b/callback-box/scripts/migrate/briefing.ts
index 4aaf1527..9d9dfe60 100644
--- a/callback-box/scripts/migrate/briefing.ts
+++ b/callback-box/scripts/migrate/briefing.ts
@@ -1,248 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Phase 2 (per-schema): migrate `briefing.briefing.card` files from
- * Phase 1 frontmatter-with-XML-body to flat frontmatter + markdown body.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Usage:
- *   pnpm exec tsx scripts/migrate/briefing.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/briefing.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, readdir, writeFile } from "node:fs/promises";
-import { join, relative, resolve } from "node:path";
-import { parseCard, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const SPEC: ElementSpec = {
-  attrs: ["version"],
-  children: {
-    purpose: { attrs: [] },
-    "key-people": {
-      attrs: [],
-      children: { person: { attrs: ["name", "called", "role", "ref"] } },
-    },
-    "project-phase": { attrs: ["date"] },
-    corrections: {
-      attrs: [],
-      children: {
-        correction: {
-          attrs: [],
-          children: {
-            instruction: { attrs: [] },
-            test: { attrs: [] },
-          },
-        },
-      },
-    },
-    legal: { attrs: [] },
-    properties: {
-      attrs: [],
-      children: {
-        property: { attrs: ["name", "address", "address-uncertain"] },
-      },
-    },
-    finances: { attrs: [] },
-    "agent-needs-to-know": { attrs: [] },
-  },
-};
-
-const warnings = new WarningCollector();
-
-interface PersonEntry {
-  name: string;
-  called?: string;
-  role?: string;
-  ref?: string;
-  description?: string;
-}
-
-interface PropertyEntry {
-  name?: string;
-  address?: string;
-  "address-uncertain"?: boolean;
-  description?: string;
-}
-
-interface BriefingOut {
-  type: "briefing";
-  purpose?: string;
-  "key-people"?: PersonEntry[];
-  "project-phase"?: { date: string; text: string };
-  corrections?: Array<{ instruction: string; test?: string }>;
-  legal?: string;
-  properties?: PropertyEntry[];
-  finances?: string;
-}
-
-async function findBriefingCards(root: string): Promise<string[]> {
-  const out: string[] = [];
-  async function walk(dir: string): Promise<void> {
-    let entries;
-    try {
-      entries = await readdir(dir, { withFileTypes: true });
-    } catch (e) {
-      const err = e as NodeJS.ErrnoException;
-      if (err.code === "ENOENT") return;
-      throw e;
-    }
-    for (const entry of entries) {
-      if (entry.name === ".git" || entry.name === "node_modules") continue;
-      const full = join(dir, entry.name);
-      if (entry.isDirectory()) {
-        await walk(full);
-      } else if (entry.isFile() && entry.name.endsWith(".briefing.card")) {
-        out.push(full);
-      }
-    }
-  }
-  await walk(root);
-  return out;
-}
-
-function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
-  return node.children.find((c) => c.tagName === tagName);
-}
-
-function convertOne(node: ElementNode, source: string): { fields: BriefingOut; body: string } {
-  if (node.tagName !== "briefing") {
-    throw new Error(`${source}: expected <briefing> root, got <${node.tagName}>`);
-  }
-  const fields: BriefingOut = { type: "briefing" };
-
-  const purposeEl = firstChild(node, "purpose");
-  if (purposeEl !== undefined && purposeEl.text !== undefined && purposeEl.text !== "") {
-    fields.purpose = purposeEl.text;
-  }
-
-  const keyPeopleEl = firstChild(node, "key-people");
-  if (keyPeopleEl !== undefined && keyPeopleEl.children.length > 0) {
-    const people: PersonEntry[] = [];
-    for (const p of keyPeopleEl.children) {
-      if (p.tagName !== "person") continue;
-      const entry: PersonEntry = { name: p.attrs["name"] ?? "" };
-      if (entry.name === "") continue;
-      if (p.attrs["called"] !== undefined) entry.called = p.attrs["called"];
-      if (p.attrs["role"] !== undefined) entry.role = p.attrs["role"];
-      if (p.attrs["ref"] !== undefined) entry.ref = p.attrs["ref"];
-      if (p.text !== undefined && p.text !== "") entry.description = p.text;
-      people.push(entry);
-    }
-    if (people.length > 0) fields["key-people"] = people;
-  }
-
-  const phaseEl = firstChild(node, "project-phase");
-  if (phaseEl !== undefined) {
-    const date = phaseEl.attrs["date"];
-    if (date !== undefined && phaseEl.text !== undefined) {
-      fields["project-phase"] = { date, text: phaseEl.text };
-    }
-  }
-
-  const correctionsEl = firstChild(node, "corrections");
-  if (correctionsEl !== undefined && correctionsEl.children.length > 0) {
-    const out: Array<{ instruction: string; test?: string }> = [];
-    for (const c of correctionsEl.children) {
-      if (c.tagName !== "correction") continue;
-      const instr = firstChild(c, "instruction");
-      const testEl = firstChild(c, "test");
-      if (instr !== undefined && instr.text !== undefined && instr.text !== "") {
-        const entry: { instruction: string; test?: string } = { instruction: instr.text };
-        if (testEl !== undefined && testEl.text !== undefined && testEl.text !== "") {
-          entry.test = testEl.text;
-        }
-        out.push(entry);
-      }
-    }
-    if (out.length > 0) fields.corrections = out;
-  }
-
-  const legalEl = firstChild(node, "legal");
-  if (legalEl !== undefined && legalEl.text !== undefined && legalEl.text.trim() !== "") {
-    fields.legal = legalEl.text.trim();
-  }
-
-  const propertiesEl = firstChild(node, "properties");
-  if (propertiesEl !== undefined && propertiesEl.children.length > 0) {
-    const props: PropertyEntry[] = [];
-    for (const p of propertiesEl.children) {
-      if (p.tagName !== "property") continue;
-      const entry: PropertyEntry = {};
-      if (p.attrs["name"] !== undefined) entry.name = p.attrs["name"];
-      if (p.attrs["address"] !== undefined) entry.address = p.attrs["address"];
-      if (p.attrs["address-uncertain"] === "true") entry["address-uncertain"] = true;
-      if (p.text !== undefined && p.text.trim() !== "") entry.description = p.text.trim();
-      if (Object.keys(entry).length > 0) props.push(entry);
-    }
-    if (props.length > 0) fields.properties = props;
-  }
-
-  const financesEl = firstChild(node, "finances");
-  if (financesEl !== undefined && financesEl.text !== undefined && financesEl.text.trim() !== "") {
-    fields.finances = financesEl.text.trim();
-  }
-
-  const needsToKnow = firstChild(node, "agent-needs-to-know");
-  const body = needsToKnow !== undefined && needsToKnow.text !== undefined ? needsToKnow.text : "";
-
-  return { fields, body };
-}
-
-async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
-  const raw = await readFile(absPath, "utf8");
-  // Already frontmatter (or empty/degenerate) — only an XML card starts with "<".
-  if (!raw.trimStart().startsWith("<")) {
-    return "already-migrated";
-  }
-  const node = await parseCard(raw, { source: absPath });
-  checkElement({ node, source: absPath, spec: SPEC, warnings });
-  const { fields, body } = convertOne(node, absPath);
-  const yamlText = stringifyYaml(fields);
-  const bodyTail = body === "" ? "" : `${body}${body.endsWith("\n") ? "" : "\n"}`;
-  await writeFile(absPath, `---\n${yamlText}---\n${bodyTail}`);
-  return "converted";
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxRoot = positional[0];
-  if (boxRoot === undefined) {
-    console.error("Usage: migrate-briefing <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const absRoot = resolve(boxRoot);
-  const cards = await findBriefingCards(absRoot);
-  console.log(`Found ${String(cards.length)} *.briefing.card files under ${absRoot}`);
-
-  if (!apply) {
-    console.log("Dry run. Pass --apply to convert.");
-    return;
-  }
-
-  let converted = 0;
-  let already = 0;
-  const failed: Array<{ file: string; error: string }> = [];
-  for (const f of cards) {
-    try {
-      const r = await migrateFile(f);
-      if (r === "converted") converted++;
-      else already++;
-    } catch (e) {
-      failed.push({ file: f, error: (e as Error).message });
-    }
-  }
-  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
-  for (const f of failed) {
-    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
-  }
-  warnings.dump(absRoot);
-  if (failed.length > 0) process.exit(2);
-}
-
-main().catch((e) => {
-  console.error(e);
-  process.exit(1);
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/capture-session.ts b/callback-box/scripts/migrate/capture-session.ts
index 5a7c4f4b..9d9dfe60 100644
--- a/callback-box/scripts/migrate/capture-session.ts
+++ b/callback-box/scripts/migrate/capture-session.ts
@@ -1,122 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Migrate `.capture-session.card` files from the XML body format to Phase-2
- * frontmatter + a Markdoc transcript body.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Frontmatter: status, session-id, time, and the image/audio/file
- * manifests. Body: the transcript timeline — `<text>` runs become
- * paragraphs, `<image>` becomes `{% image ref="…" /%}` (reference-only;
- * description/filename now come from the image card), `<silence>` becomes
- * `{% silence duration="…" /%}`.
- *
- * Usage:
- *   pnpm exec tsx scripts/migrate/capture-session.ts <root>           # dry-run
- *   pnpm exec tsx scripts/migrate/capture-session.ts <root> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, writeFile } from "node:fs/promises";
-import { parseCard, splitCardContent, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { runMigration } from "./_harness.js";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const SPEC: ElementSpec = {
-  attrs: ["status", "session-id"],
-  children: {
-    time: { attrs: ["start", "end", "duration"] },
-    images: { attrs: [], children: { "image-ref": { attrs: ["ref"] } } },
-    "audio-clips": { attrs: [], children: { "audio-ref": { attrs: ["ref"] } } },
-    files: { attrs: [], children: { "file-ref": { attrs: ["ref"] } } },
-    purpose: { attrs: [] }, // legacy, dropped
-    transcript: {
-      attrs: [],
-      children: {
-        text: { attrs: [] },
-        image: { attrs: ["ref", "description", "filename"] },
-        silence: { attrs: ["duration"] },
-      },
-    },
-  },
-};
-
-function text(el: ElementNode): string {
-  return typeof el.text === "string" ? el.text.trim() : "";
-}
-
-function child(el: ElementNode, tag: string): ElementNode | undefined {
-  return el.children.find((c) => c.tagName === tag);
-}
-
-function refList(el: ElementNode | undefined, childTag: string): string[] {
-  if (el === undefined) return [];
-  const out: string[] = [];
-  for (const c of el.children) {
-    if (c.tagName !== childTag) continue;
-    const ref = c.attrs["ref"];
-    if (typeof ref === "string" && ref !== "") out.push(ref);
-  }
-  return out;
-}
-
-function buildTranscriptBody(transcript: ElementNode | undefined): string {
-  if (transcript === undefined) return "";
-  const parts: string[] = [];
-  for (const node of transcript.children) {
-    if (node.tagName === "text") {
-      const t = text(node);
-      if (t !== "") parts.push(t);
-    } else if (node.tagName === "image") {
-      const ref = node.attrs["ref"];
-      if (typeof ref === "string" && ref !== "") parts.push(`{% image ref="${ref}" /%}`);
-    } else if (node.tagName === "silence") {
-      const duration = node.attrs["duration"];
-      if (typeof duration === "string" && duration !== "") parts.push(`{% silence duration="${duration}" /%}`);
-    }
-  }
-  return parts.join("\n\n");
-}
-
-await runMigration({
-  description: "Convert *.capture-session.card XML body → frontmatter + Markdoc transcript.",
-  match: (name) => name.endsWith(".capture-session.card"),
-  convert: async (absPath, { warnings, apply }) => {
-    const content = await readFile(absPath, "utf-8");
-    const split = splitCardContent(content);
-    const isXml = /(^|\n)content-type:\s*application\/x-card\+xml/.test(split.frontmatterText);
-    if (split.hasFrontmatter && !isXml) return "already";
-
-    const root = await parseCard(content, { source: absPath });
-    if (root.tagName !== "capture-session") {
-      throw new Error(`expected <capture-session> root, got <${root.tagName}>`);
-    }
-    checkElement({ node: root, source: absPath, spec: SPEC, warnings });
-
-    const fields: Record<string, unknown> = {
-      status: root.attrs["status"] ?? "new",
-      "session-id": root.attrs["session-id"] ?? "",
-    };
-
-    const timeEl = child(root, "time");
-    if (timeEl) {
-      const time: Record<string, string> = {};
-      for (const k of ["start", "end", "duration"]) {
-        const v = timeEl.attrs[k];
-        if (typeof v === "string" && v !== "") time[k] = v;
-      }
-      if (Object.keys(time).length > 0) fields.time = time;
-    }
-
-    const images = refList(child(root, "images"), "image-ref");
-    if (images.length > 0) fields.images = images;
-    const audioClips = refList(child(root, "audio-clips"), "audio-ref");
-    if (audioClips.length > 0) fields["audio-clips"] = audioClips;
-    const files = refList(child(root, "files"), "file-ref");
-    if (files.length > 0) fields.files = files;
-
-    const body = buildTranscriptBody(child(root, "transcript"));
-    const out = body === "" ? `---\n${stringifyYaml(fields)}---\n` : `---\n${stringifyYaml(fields)}---\n${body}\n`;
-    if (apply) await writeFile(absPath, out, "utf-8");
-    return "converted";
-  },
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/chat-thread.ts b/callback-box/scripts/migrate/chat-thread.ts
index 76160dc6..9d9dfe60 100644
--- a/callback-box/scripts/migrate/chat-thread.ts
+++ b/callback-box/scripts/migrate/chat-thread.ts
@@ -1,190 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Phase 2: migrate `.chat-thread.card` files from XML to YAML frontmatter.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Usage:
- *   pnpm exec tsx scripts/migrate/chat-thread.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/chat-thread.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, readdir, writeFile } from "node:fs/promises";
-import { join, relative, resolve } from "node:path";
-import { parseCard, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-
-const KNOWN_ATTRS = new Set(["chat-id", "connector"]);
-const KNOWN_CHILDREN = new Set(["description", "participants", "message", "seen"]);
-const KNOWN_PARTICIPANTS_CHILDREN = new Set(["person"]);
-const KNOWN_MESSAGE_ATTRS = new Set(["id", "sender", "sender-id", "time", "sent"]);
-const KNOWN_SEEN_ATTRS = new Set(["callback-in", "wait-for"]);
-
-interface Warning { file: string; message: string }
-const warnings: Warning[] = [];
-
-function checkUnknown(node: ElementNode, source: string): void {
-  for (const attr of Object.keys(node.attrs)) {
-    if (!KNOWN_ATTRS.has(attr)) {
-      warnings.push({ file: source, message: `unknown attr on <chat-thread>: ${attr}="${String(node.attrs[attr])}"` });
-    }
-  }
-  for (const child of node.children) {
-    if (!KNOWN_CHILDREN.has(child.tagName)) {
-      warnings.push({ file: source, message: `unknown child element: <${child.tagName}>` });
-      continue;
-    }
-    if (child.tagName === "participants") {
-      for (const sub of child.children) {
-        if (!KNOWN_PARTICIPANTS_CHILDREN.has(sub.tagName)) {
-          warnings.push({ file: source, message: `unknown <participants> child: <${sub.tagName}>` });
-        }
-      }
-    } else if (child.tagName === "message") {
-      for (const a of Object.keys(child.attrs)) {
-        if (!KNOWN_MESSAGE_ATTRS.has(a)) {
-          warnings.push({ file: source, message: `unknown attr on <message>: ${a}` });
-        }
-      }
-    } else if (child.tagName === "seen") {
-      for (const a of Object.keys(child.attrs)) {
-        if (!KNOWN_SEEN_ATTRS.has(a)) {
-          warnings.push({ file: source, message: `unknown attr on <seen>: ${a}` });
-        }
-      }
-    }
-  }
-}
-
-async function findCards(root: string): Promise<string[]> {
-  const out: string[] = [];
-  async function walk(dir: string): Promise<void> {
-    let entries;
-    try {
-      entries = await readdir(dir, { withFileTypes: true });
-    } catch (e) {
-      const err = e as NodeJS.ErrnoException;
-      if (err.code === "ENOENT") return;
-      throw e;
-    }
-    for (const entry of entries) {
-      if (entry.name === ".git" || entry.name === "node_modules") continue;
-      const full = join(dir, entry.name);
-      if (entry.isDirectory()) {
-        await walk(full);
-      } else if (entry.isFile() && entry.name.endsWith(".chat-thread.card")) {
-        out.push(full);
-      }
-    }
-  }
-  await walk(root);
-  return out;
-}
-
-function childText(node: ElementNode, tagName: string): string | undefined {
-  const c = node.children.find((c) => c.tagName === tagName);
-  if (c === undefined) return undefined;
-  const t = c.text;
-  return t === undefined || t === "" ? undefined : t;
-}
-
-function convertOne(node: ElementNode, source: string): Record<string, unknown> {
-  if (node.tagName !== "chat-thread") {
-    throw new Error(`${source}: expected <chat-thread>, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = {
-    type: "chat-thread",
-    "chat-id": node.attrs["chat-id"] ?? "",
-    connector: node.attrs["connector"] ?? "",
-  };
-
-  const description = childText(node, "description");
-  if (description !== undefined) fields["description"] = description;
-
-  const participantsEl = node.children.find((c) => c.tagName === "participants");
-  if (participantsEl !== undefined) {
-    const people = participantsEl.children
-      .filter((c) => c.tagName === "person")
-      .map((c) => ({ ref: c.attrs["ref"] ?? "" }))
-      .filter((p) => p.ref !== "");
-    if (people.length > 0) fields["participants"] = people;
-  }
-
-  const entries: Array<Record<string, unknown>> = [];
-  for (const child of node.children) {
-    if (child.tagName === "message") {
-      const entry: Record<string, unknown> = { kind: "message" };
-      if (child.attrs["id"] !== undefined) entry["id"] = child.attrs["id"];
-      entry["sender"] = child.attrs["sender"] ?? "";
-      if (child.attrs["sender-id"] !== undefined) entry["sender-id"] = child.attrs["sender-id"];
-      if (child.attrs["time"] !== undefined) entry["time"] = child.attrs["time"];
-      if (child.attrs["sent"] !== undefined) entry["sent"] = child.attrs["sent"];
-      entry["text"] = child.text ?? "";
-      entries.push(entry);
-    } else if (child.tagName === "seen") {
-      const entry: Record<string, unknown> = { kind: "seen" };
-      if (child.attrs["callback-in"] !== undefined) entry["callback-in"] = child.attrs["callback-in"];
-      if (child.attrs["wait-for"] !== undefined) entry["wait-for"] = child.attrs["wait-for"];
-      if (child.text !== undefined && child.text !== "") entry["text"] = child.text;
-      entries.push(entry);
-    }
-  }
-  fields["entries"] = entries;
-
-  return fields;
-}
-
-async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
-  const raw = await readFile(absPath, "utf8");
-  // Already frontmatter (or empty/degenerate) — only an XML card starts with "<".
-  if (!raw.trimStart().startsWith("<")) {
-    return "already-migrated";
-  }
-  const node = await parseCard(raw, { source: absPath });
-  checkUnknown(node, absPath);
-  const fields = convertOne(node, absPath);
-  await writeFile(absPath, `---\n${stringifyYaml(fields)}---\n`);
-  return "converted";
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxRoot = positional[0];
-  if (boxRoot === undefined) {
-    console.error("Usage: migrate-chat-thread <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const absRoot = resolve(boxRoot);
-  const cards = await findCards(absRoot);
-  console.log(`Found ${String(cards.length)} *.chat-thread.card files under ${absRoot}`);
-  if (!apply) return;
-  let converted = 0;
-  let already = 0;
-  const failed: Array<{ file: string; error: string }> = [];
-  for (const f of cards) {
-    try {
-      const r = await migrateFile(f);
-      if (r === "converted") converted++;
-      else already++;
-    } catch (e) {
-      failed.push({ file: f, error: (e as Error).message });
-    }
-  }
-  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
-  for (const f of failed) {
-    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
-  }
-  if (warnings.length > 0) {
-    console.log(`\n${String(warnings.length)} warning(s) about unrecognized fields:`);
-    for (const w of warnings) {
-      console.log(`  ${relative(absRoot, w.file)}: ${w.message}`);
-    }
-  }
-  if (failed.length > 0) process.exit(2);
-}
-
-main().catch((e) => {
-  console.error(e);
-  process.exit(1);
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/doc-sheet.ts b/callback-box/scripts/migrate/doc-sheet.ts
index 4669847a..9d9dfe60 100644
--- a/callback-box/scripts/migrate/doc-sheet.ts
+++ b/callback-box/scripts/migrate/doc-sheet.ts
@@ -1,225 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Phase 2 (per-schema): migrate `.doc.card` and `.sheet.card` files from
- * Phase 1 frontmatter-with-XML-body to flat frontmatter. Both schemas are
- * pure metadata — no body content.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Usage:
- *   pnpm exec tsx scripts/migrate/doc-sheet.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/doc-sheet.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, readdir, writeFile } from "node:fs/promises";
-import { join, relative, resolve } from "node:path";
-import { parseCard, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const DOC_SPEC: ElementSpec = {
-  attrs: ["drive-id", "status", "version"],
-  children: {
-    title: { attrs: [] },
-    modified: { attrs: [] },
-    revision: { attrs: [] },
-    link: { attrs: [] },
-    owner: { attrs: [] },
-    content: { attrs: ["ref"] },
-    lossy: { attrs: [], children: { item: { attrs: ["type", "count"] } } },
-  },
-};
-
-const SHEET_SPEC: ElementSpec = {
-  attrs: ["drive-id", "status", "version"],
-  children: {
-    title: { attrs: [] },
-    modified: { attrs: [] },
-    link: { attrs: [] },
-    owner: { attrs: [] },
-    sheets: {
-      attrs: [],
-      children: { "sheet-tab": { attrs: ["ref", "title", "gid"] } },
-    },
-  },
-};
-
-const warnings = new WarningCollector();
-
-async function findCards(root: string, suffix: string): Promise<string[]> {
-  const out: string[] = [];
-  async function walk(dir: string): Promise<void> {
-    let entries;
-    try {
-      entries = await readdir(dir, { withFileTypes: true });
-    } catch (e) {
-      const err = e as NodeJS.ErrnoException;
-      if (err.code === "ENOENT") return;
-      throw e;
-    }
-    for (const entry of entries) {
-      if (entry.name === ".git" || entry.name === "node_modules") continue;
-      const full = join(dir, entry.name);
-      if (entry.isDirectory()) {
-        await walk(full);
-      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
-        out.push(full);
-      }
-    }
-  }
-  await walk(root);
-  return out;
-}
-
-function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
-  return node.children.find((c) => c.tagName === tagName);
-}
-
-function childText(node: ElementNode, tagName: string): string | undefined {
-  return firstChild(node, tagName)?.text;
-}
-
-function convertDoc(node: ElementNode, source: string): Record<string, unknown> {
-  if (node.tagName !== "doc") {
-    throw new Error(`${source}: expected <doc> root, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = {
-    type: "doc",
-    "drive-id": node.attrs["drive-id"] ?? "",
-  };
-  if (node.attrs["status"] !== undefined) fields["status"] = node.attrs["status"];
-  const title = childText(node, "title");
-  if (title !== undefined) fields["title"] = title;
-  const modified = childText(node, "modified");
-  if (modified !== undefined) fields["modified"] = modified;
-  const revision = childText(node, "revision");
-  if (revision !== undefined) fields["revision"] = revision;
-  const link = childText(node, "link");
-  if (link !== undefined) fields["link"] = link;
-  const owner = childText(node, "owner");
-  if (owner !== undefined) fields["owner"] = owner;
-  const contentEl = firstChild(node, "content");
-  if (contentEl !== undefined && contentEl.attrs["ref"] !== undefined) {
-    fields["content"] = { ref: contentEl.attrs["ref"] };
-  }
-  const lossyEl = firstChild(node, "lossy");
-  if (lossyEl !== undefined && lossyEl.children.length > 0) {
-    const items: Array<{ type: string; count: number }> = [];
-    for (const item of lossyEl.children) {
-      if (item.tagName !== "item") continue;
-      const t = item.attrs["type"];
-      const c = item.attrs["count"];
-      if (t === undefined || c === undefined) continue;
-      const n = Number(c);
-      if (!Number.isFinite(n)) continue;
-      items.push({ type: t, count: n });
-    }
-    if (items.length > 0) fields["lossy"] = items;
-  }
-  return fields;
-}
-
-function convertSheet(node: ElementNode, source: string): Record<string, unknown> {
-  if (node.tagName !== "sheet") {
-    throw new Error(`${source}: expected <sheet> root, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = {
-    type: "sheet",
-    "drive-id": node.attrs["drive-id"] ?? "",
-  };
-  if (node.attrs["status"] !== undefined) fields["status"] = node.attrs["status"];
-  const title = childText(node, "title");
-  if (title !== undefined) fields["title"] = title;
-  const modified = childText(node, "modified");
-  if (modified !== undefined) fields["modified"] = modified;
-  const link = childText(node, "link");
-  if (link !== undefined) fields["link"] = link;
-  const owner = childText(node, "owner");
-  if (owner !== undefined) fields["owner"] = owner;
-  const sheetsEl = firstChild(node, "sheets");
-  if (sheetsEl !== undefined && sheetsEl.children.length > 0) {
-    const tabs: Array<{ ref: string; title: string; gid: string }> = [];
-    for (const tab of sheetsEl.children) {
-      if (tab.tagName !== "sheet-tab") continue;
-      const ref = tab.attrs["ref"];
-      const tabTitle = tab.attrs["title"];
-      const gid = tab.attrs["gid"];
-      if (ref === undefined || tabTitle === undefined || gid === undefined) continue;
-      tabs.push({ ref, title: tabTitle, gid });
-    }
-    fields["sheets"] = tabs;
-  } else {
-    fields["sheets"] = [];
-  }
-  return fields;
-}
-
-async function migrateFile(
-  absPath: string,
-  kind: "doc" | "sheet"
-): Promise<"converted" | "already-migrated"> {
-  const raw = await readFile(absPath, "utf8");
-  // Already frontmatter (or empty/degenerate) — only an XML card starts with "<".
-  // Drive-synced sheets are frontmatter without a `type:` field, so a
-  // type-keyed check would mis-flag them; key on "is it XML" instead.
-  if (!raw.trimStart().startsWith("<")) {
-    return "already-migrated";
-  }
-  const node = await parseCard(raw, { source: absPath });
-  checkElement({ node, source: absPath, spec: kind === "doc" ? DOC_SPEC : SHEET_SPEC, warnings });
-  const fields = kind === "doc" ? convertDoc(node, absPath) : convertSheet(node, absPath);
-  const yamlText = stringifyYaml(fields);
-  await writeFile(absPath, `---\n${yamlText}---\n`);
-  return "converted";
-}
-
-async function migrateKind(input: {
-  absRoot: string;
-  kind: "doc" | "sheet";
-  apply: boolean;
-}): Promise<void> {
-  const { absRoot, kind, apply } = input;
-  const suffix = `.${kind}.card`;
-  const cards = await findCards(absRoot, suffix);
-  console.log(`Found ${String(cards.length)} *${suffix} files under ${absRoot}`);
-  if (!apply) {
-    console.log(`Dry run for ${kind}. Pass --apply to convert.`);
-    return;
-  }
-  let converted = 0;
-  let already = 0;
-  const failed: Array<{ file: string; error: string }> = [];
-  for (const f of cards) {
-    try {
-      const r = await migrateFile(f, kind);
-      if (r === "converted") converted++;
-      else already++;
-    } catch (e) {
-      failed.push({ file: f, error: (e as Error).message });
-    }
-  }
-  console.log(`${kind}: converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
-  for (const f of failed) {
-    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
-  }
-  if (failed.length > 0) process.exit(2);
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxRoot = positional[0];
-  if (boxRoot === undefined) {
-    console.error("Usage: migrate-doc-sheet <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const absRoot = resolve(boxRoot);
-  await migrateKind({ absRoot, kind: "doc", apply });
-  await migrateKind({ absRoot, kind: "sheet", apply });
-  warnings.dump(absRoot);
-}
-
-main().catch((e) => {
-  console.error(e);
-  process.exit(1);
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/email-message.ts b/callback-box/scripts/migrate/email-message.ts
index b43389c6..9d9dfe60 100644
--- a/callback-box/scripts/migrate/email-message.ts
+++ b/callback-box/scripts/migrate/email-message.ts
@@ -1,244 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Phase 2 (per-schema): migrate `*.email-message.card` files from the Phase 1
- * frontmatter-with-XML-body shape to the flat frontmatter shape.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Before:
- *   ---
- *   content-type: application/x-card+xml
- *   ---
- *   <email-message message-id="..." thread-id="...">
- *     <from>alice@example.com</from>
- *     <to>bob@example.com</to>
- *     <cc>...</cc>
- *     <date>2026-02-15T10:00:00Z</date>
- *     <subject>...</subject>
- *     <snippet>...</snippet>
- *     <body-file>attach/msg-001.body.txt</body-file>
- *     <attachments>
- *       <attachment ref="attach/file.pdf" content-type="application/pdf" size="123"/>
- *     </attachments>
- *   </email-message>
- *
- * After:
- *   ---
- *   type: email-message
- *   message-id: ...
- *   thread-id: ...
- *   from: alice@example.com
- *   to: bob@example.com
- *   date: 2026-02-15T10:00:00Z
- *   subject: ...
- *   body-file:
- *     ref: attach/msg-001.body.txt
- *   attachments:
- *     - ref: attach/file.pdf
- *       content-type: application/pdf
- *       size: 123
- *   ---
- *
- * Usage:
- *   pnpm exec tsx scripts/migrate/email-message.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/email-message.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, readdir, writeFile } from "node:fs/promises";
-import { join, relative, resolve } from "node:path";
-import { parseCard, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const SPEC: ElementSpec = {
-  attrs: ["message-id", "thread-id", "version"],
-  children: {
-    from: { attrs: [] },
-    to: { attrs: [] },
-    cc: { attrs: [] },
-    date: { attrs: [] },
-    subject: { attrs: [] },
-    snippet: { attrs: [] },
-    "body-file": { attrs: [] },
-    attachments: {
-      attrs: [],
-      children: {
-        attachment: { attrs: ["ref", "content-type", "size"] },
-      },
-    },
-  },
-};
-
-const warnings = new WarningCollector();
-
-interface AttachmentEntry {
-  ref: string;
-  "content-type": string;
-  size?: number;
-}
-
-interface MessageFields {
-  type: "email-message";
-  "message-id": string;
-  "thread-id": string;
-  from: string;
-  to?: string;
-  cc?: string;
-  date: string;
-  subject: string;
-  snippet?: string;
-  "body-file": { ref: string };
-  attachments?: AttachmentEntry[];
-}
-
-async function findMessageCards(root: string): Promise<string[]> {
-  const out: string[] = [];
-  async function walk(dir: string): Promise<void> {
-    let entries;
-    try {
-      entries = await readdir(dir, { withFileTypes: true });
-    } catch (e) {
-      const err = e as NodeJS.ErrnoException;
-      if (err.code === "ENOENT") return;
-      throw e;
-    }
-    for (const entry of entries) {
-      if (entry.name === ".git" || entry.name === "node_modules") continue;
-      const full = join(dir, entry.name);
-      if (entry.isDirectory()) {
-        await walk(full);
-      } else if (entry.isFile() && entry.name.endsWith(".email-message.card")) {
-        out.push(full);
-      }
-    }
-  }
-  await walk(root);
-  return out;
-}
-
-function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
-  return node.children.find((c) => c.tagName === tagName);
-}
-
-function childText(node: ElementNode, tagName: string): string | undefined {
-  const child = firstChild(node, tagName);
-  return child === undefined ? undefined : child.text;
-}
-
-function convertOne(node: ElementNode, source: string): MessageFields {
-  if (node.tagName !== "email-message") {
-    throw new Error(`${source}: expected <email-message> root, got <${node.tagName}>`);
-  }
-  const messageId = node.attrs["message-id"];
-  const threadId = node.attrs["thread-id"];
-  if (messageId === undefined) throw new Error(`${source}: missing message-id`);
-  if (threadId === undefined) throw new Error(`${source}: missing thread-id`);
-
-  const from = childText(node, "from");
-  if (from === undefined) throw new Error(`${source}: missing <from>`);
-
-  const date = childText(node, "date");
-  if (date === undefined) throw new Error(`${source}: missing <date>`);
-
-  const subject = childText(node, "subject");
-  if (subject === undefined) throw new Error(`${source}: missing <subject>`);
-
-  const bodyFile = childText(node, "body-file");
-  if (bodyFile === undefined) throw new Error(`${source}: missing <body-file>`);
-
-  const fields: MessageFields = {
-    type: "email-message",
-    "message-id": messageId,
-    "thread-id": threadId,
-    from,
-    date,
-    subject,
-    "body-file": { ref: bodyFile },
-  };
-
-  const to = childText(node, "to");
-  if (to !== undefined && to !== "") fields.to = to;
-
-  const cc = childText(node, "cc");
-  if (cc !== undefined && cc !== "") fields.cc = cc;
-
-  const snippet = childText(node, "snippet");
-  if (snippet !== undefined && snippet !== "") fields.snippet = snippet;
-
-  const attachmentsNode = firstChild(node, "attachments");
-  if (attachmentsNode !== undefined && attachmentsNode.children.length > 0) {
-    const list: AttachmentEntry[] = [];
-    for (const item of attachmentsNode.children) {
-      if (item.tagName !== "attachment") continue;
-      const ref = item.attrs["ref"];
-      const contentType = item.attrs["content-type"];
-      if (ref === undefined || contentType === undefined) continue;
-      const entry: AttachmentEntry = { ref, "content-type": contentType };
-      const sizeAttr = item.attrs["size"];
-      if (sizeAttr !== undefined) {
-        const n = Number(sizeAttr);
-        if (Number.isFinite(n)) entry.size = n;
-      }
-      list.push(entry);
-    }
-    if (list.length > 0) fields.attachments = list;
-  }
-
-  return fields;
-}
-
-async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
-  const raw = await readFile(absPath, "utf8");
-  // Already frontmatter (or empty/degenerate) — only an XML card starts with "<".
-  if (!raw.trimStart().startsWith("<")) {
-    return "already-migrated";
-  }
-  const node = await parseCard(raw, { source: absPath });
-  checkElement({ node, source: absPath, spec: SPEC, warnings });
-  const fields = convertOne(node, absPath);
-  const yamlText = stringifyYaml(fields);
-  await writeFile(absPath, `---\n${yamlText}---\n`);
-  return "converted";
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxRoot = positional[0];
-  if (boxRoot === undefined) {
-    console.error("Usage: migrate-email-message <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const absRoot = resolve(boxRoot);
-  const cards = await findMessageCards(absRoot);
-  console.log(`Found ${String(cards.length)} *.email-message.card files under ${absRoot}`);
-
-  if (!apply) {
-    console.log("Dry run. Pass --apply to convert.");
-    return;
-  }
-
-  let converted = 0;
-  let already = 0;
-  const failed: Array<{ file: string; error: string }> = [];
-  for (const f of cards) {
-    try {
-      const r = await migrateFile(f);
-      if (r === "converted") converted++;
-      else already++;
-    } catch (e) {
-      failed.push({ file: f, error: (e as Error).message });
-    }
-  }
-  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
-  for (const f of failed) {
-    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
-  }
-  warnings.dump(absRoot);
-  if (failed.length > 0) process.exit(2);
-}
-
-main().catch((e) => {
-  console.error(e);
-  process.exit(1);
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/email-thread.ts b/callback-box/scripts/migrate/email-thread.ts
index ecefe49f..9d9dfe60 100644
--- a/callback-box/scripts/migrate/email-thread.ts
+++ b/callback-box/scripts/migrate/email-thread.ts
@@ -1,241 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Phase 2 (per-schema): migrate `*.email-thread.card` files from the Phase 1
- * frontmatter-with-XML-body shape to the flat frontmatter shape.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Before:
- *   ---
- *   content-type: application/x-card+xml
- *   ---
- *   <email-thread thread-id="abc" status="new" version="1.0.0">
- *     <subject>...</subject>
- *     <participants><participant>a@x</participant></participants>
- *     <date-range start="..." end="..."/>
- *     <labels><label>inbox</label></labels>
- *     <messages><message-ref ref="attach/msg-001.email-message.card"/></messages>
- *   </email-thread>
- *
- * After:
- *   ---
- *   type: email-thread
- *   thread-id: abc
- *   status: new
- *   subject: ...
- *   participants:
- *     - a@x
- *   date-range:
- *     start: ...
- *     end: ...
- *   labels:
- *     - inbox
- *   messages:
- *     - attach/msg-001.email-message.card
- *   ---
- *
- * Usage:
- *   pnpm exec tsx scripts/migrate/email-thread.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/email-thread.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, readdir, writeFile } from "node:fs/promises";
-import { join, relative, resolve } from "node:path";
-import { parseCard, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const SPEC: ElementSpec = {
-  attrs: ["thread-id", "status", "version"],
-  children: {
-    subject: { attrs: [] },
-    participants: { attrs: [], children: { participant: { attrs: [] } } },
-    "date-range": { attrs: ["start", "end"] },
-    labels: { attrs: [], children: { label: { attrs: [] } } },
-    messages: { attrs: [], children: { "message-ref": { attrs: ["ref"] } } },
-  },
-};
-
-const warnings = new WarningCollector();
-
-interface ThreadFields {
-  type: "email-thread";
-  "thread-id": string;
-  status?: string;
-  subject: string;
-  participants: string[];
-  "date-range": { start: string; end: string };
-  labels?: string[];
-  messages: Array<{ ref: string }>;
-}
-
-async function findThreadCards(root: string): Promise<string[]> {
-  const out: string[] = [];
-  async function walk(dir: string): Promise<void> {
-    let entries;
-    try {
-      entries = await readdir(dir, { withFileTypes: true });
-    } catch (e) {
-      const err = e as NodeJS.ErrnoException;
-      if (err.code === "ENOENT") return;
-      throw e;
-    }
-    for (const entry of entries) {
-      if (entry.name === ".git" || entry.name === "node_modules") continue;
-      const full = join(dir, entry.name);
-      if (entry.isDirectory()) {
-        await walk(full);
-      } else if (entry.isFile() && entry.name.endsWith(".email-thread.card")) {
-        out.push(full);
-      }
-    }
-  }
-  await walk(root);
-  return out;
-}
-
-function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
-  return node.children.find((c) => c.tagName === tagName);
-}
-
-function childText(node: ElementNode, tagName: string): string | undefined {
-  const child = firstChild(node, tagName);
-  return child === undefined ? undefined : child.text;
-}
-
-function childList(
-  parent: ElementNode,
-  spec: {
-    containerTag: string;
-    itemTag: string;
-    pluck: (item: ElementNode) => string | undefined;
-  }
-): string[] {
-  const container = firstChild(parent, spec.containerTag);
-  if (container === undefined) return [];
-  const out: string[] = [];
-  for (const item of container.children) {
-    if (item.tagName !== spec.itemTag) continue;
-    const value = spec.pluck(item);
-    if (value !== undefined) out.push(value);
-  }
-  return out;
-}
-
-function convertOne(node: ElementNode, source: string): ThreadFields {
-  if (node.tagName !== "email-thread") {
-    throw new Error(`${source}: expected <email-thread> root, got <${node.tagName}>`);
-  }
-  const threadId = node.attrs["thread-id"];
-  if (threadId === undefined) throw new Error(`${source}: missing thread-id`);
-
-  const subject = childText(node, "subject");
-  if (subject === undefined) throw new Error(`${source}: missing <subject>`);
-
-  const participants = childList(node, {
-    containerTag: "participants",
-    itemTag: "participant",
-    pluck: (p) => p.text,
-  });
-
-  const dateRange = firstChild(node, "date-range");
-  if (dateRange === undefined) throw new Error(`${source}: missing <date-range>`);
-  const start = dateRange.attrs["start"];
-  const end = dateRange.attrs["end"];
-  if (start === undefined || end === undefined) {
-    throw new Error(`${source}: <date-range> missing start/end`);
-  }
-
-  const labels = childList(node, {
-    containerTag: "labels",
-    itemTag: "label",
-    pluck: (l) => l.text,
-  });
-  const messageRefs = childList(node, {
-    containerTag: "messages",
-    itemTag: "message-ref",
-    pluck: (m) => m.attrs["ref"],
-  });
-  const messages = messageRefs.map((ref) => ({ ref }));
-
-  const fields: ThreadFields = {
-    type: "email-thread",
-    "thread-id": threadId,
-    subject,
-    participants,
-    "date-range": { start, end },
-    messages,
-  };
-  if (node.attrs["status"] !== undefined) {
-    fields.status = node.attrs["status"];
-  }
-  if (labels.length > 0) {
-    fields.labels = labels;
-  }
-  return fields;
-}
-
-async function migrateFile(absPath: string): Promise<"converted" | "already-migrated" | "skipped"> {
-  const raw = await readFile(absPath, "utf8");
-  // Already frontmatter (or empty/degenerate) — only an XML card starts with "<".
-  if (!raw.trimStart().startsWith("<")) {
-    return "already-migrated";
-  }
-  const node = await parseCard(raw, { source: absPath });
-  checkElement({ node, source: absPath, spec: SPEC, warnings });
-  const fields = convertOne(node, absPath);
-  const yamlText = stringifyYaml(fields);
-  await writeFile(absPath, `---\n${yamlText}---\n`);
-  return "converted";
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxRoot = positional[0];
-  if (boxRoot === undefined) {
-    console.error("Usage: migrate-email-thread <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const absRoot = resolve(boxRoot);
-  const cards = await findThreadCards(absRoot);
-  console.log(`Found ${String(cards.length)} *.email-thread.card files under ${absRoot}`);
-
-  if (!apply) {
-    console.log("Dry run. Pass --apply to convert.");
-    if (cards.length > 0) {
-      console.log("\nFirst few files:");
-      for (const f of cards.slice(0, 10)) {
-        console.log("  " + relative(absRoot, f));
-      }
-      if (cards.length > 10) {
-        console.log(`  ... and ${String(cards.length - 10)} more`);
-      }
-    }
-    return;
-  }
-
-  let converted = 0;
-  let alreadyMigrated = 0;
-  const failed: Array<{ file: string; error: string }> = [];
-  for (const f of cards) {
-    try {
-      const result = await migrateFile(f);
-      if (result === "converted") converted++;
-      else if (result === "already-migrated") alreadyMigrated++;
-    } catch (e) {
-      failed.push({ file: f, error: (e as Error).message });
-    }
-  }
-  console.log(`Converted ${String(converted)}, already migrated ${String(alreadyMigrated)}, failed ${String(failed.length)}.`);
-  for (const f of failed) {
-    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
-  }
-  warnings.dump(absRoot);
-  if (failed.length > 0) process.exit(2);
-}
-
-main().catch((e) => {
-  console.error(e);
-  process.exit(1);
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/file.ts b/callback-box/scripts/migrate/file.ts
index 336dc3e6..9d9dfe60 100644
--- a/callback-box/scripts/migrate/file.ts
+++ b/callback-box/scripts/migrate/file.ts
@@ -1,151 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Phase 2 (per-schema): migrate `.file.card` files from Phase 1
- * frontmatter-with-XML-body to flat frontmatter.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Usage:
- *   pnpm exec tsx scripts/migrate/file.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/file.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, readdir, writeFile } from "node:fs/promises";
-import { join, relative, resolve } from "node:path";
-import { parseCard, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const SPEC: ElementSpec = {
-  attrs: ["status", "version"],
-  children: {
-    filename: { attrs: ["ref", "captured", "source", "original-name", "mime-type", "size"] },
-    description: { attrs: [] },
-  },
-};
-
-const warnings = new WarningCollector();
-
-async function findCards(root: string): Promise<string[]> {
-  const out: string[] = [];
-  async function walk(dir: string): Promise<void> {
-    let entries;
-    try {
-      entries = await readdir(dir, { withFileTypes: true });
-    } catch (e) {
-      const err = e as NodeJS.ErrnoException;
-      if (err.code === "ENOENT") return;
-      throw e;
-    }
-    for (const entry of entries) {
-      if (entry.name === ".git" || entry.name === "node_modules") continue;
-      const full = join(dir, entry.name);
-      if (entry.isDirectory()) {
-        await walk(full);
-      } else if (entry.isFile() && entry.name.endsWith(".file.card")) {
-        out.push(full);
-      }
-    }
-  }
-  await walk(root);
-  return out;
-}
-
-function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
-  return node.children.find((c) => c.tagName === tagName);
-}
-
-function convertOne(node: ElementNode, source: string): Record<string, unknown> {
-  if (node.tagName !== "file") {
-    throw new Error(`${source}: expected <file> root, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = {
-    type: "file",
-    status: node.attrs["status"] ?? "new",
-  };
-  const filenameEl = firstChild(node, "filename");
-  if (filenameEl === undefined) {
-    throw new Error(`${source}: missing <filename>`);
-  }
-  const ref = filenameEl.attrs["ref"];
-  const captured = filenameEl.attrs["captured"];
-  const fSource = filenameEl.attrs["source"];
-  if (ref === undefined || captured === undefined || fSource === undefined) {
-    throw new Error(`${source}: <filename> missing ref/captured/source`);
-  }
-  const filename: Record<string, unknown> = {
-    ref,
-    captured,
-    source: fSource,
-  };
-  if (filenameEl.attrs["original-name"] !== undefined) {
-    filename["original-name"] = filenameEl.attrs["original-name"];
-  }
-  if (filenameEl.attrs["mime-type"] !== undefined) {
-    filename["mime-type"] = filenameEl.attrs["mime-type"];
-  }
-  if (filenameEl.attrs["size"] !== undefined) {
-    const n = Number(filenameEl.attrs["size"]);
-    if (Number.isFinite(n)) filename["size"] = n;
-  }
-  fields["filename"] = filename;
-  const descEl = firstChild(node, "description");
-  if (descEl !== undefined && descEl.text !== undefined && descEl.text !== "") {
-    fields["description"] = descEl.text;
-  }
-  return fields;
-}
-
-async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
-  const raw = await readFile(absPath, "utf8");
-  // Already frontmatter (or empty/degenerate) — only an XML card starts with "<".
-  if (!raw.trimStart().startsWith("<")) {
-    return "already-migrated";
-  }
-  const node = await parseCard(raw, { source: absPath });
-  checkElement({ node, source: absPath, spec: SPEC, warnings });
-  const fields = convertOne(node, absPath);
-  const yamlText = stringifyYaml(fields);
-  await writeFile(absPath, `---\n${yamlText}---\n`);
-  return "converted";
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxRoot = positional[0];
-  if (boxRoot === undefined) {
-    console.error("Usage: migrate-file <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const absRoot = resolve(boxRoot);
-  const cards = await findCards(absRoot);
-  console.log(`Found ${String(cards.length)} *.file.card files under ${absRoot}`);
-  if (!apply) {
-    console.log("Dry run. Pass --apply to convert.");
-    return;
-  }
-  let converted = 0;
-  let already = 0;
-  const failed: Array<{ file: string; error: string }> = [];
-  for (const f of cards) {
-    try {
-      const r = await migrateFile(f);
-      if (r === "converted") converted++;
-      else already++;
-    } catch (e) {
-      failed.push({ file: f, error: (e as Error).message });
-    }
-  }
-  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
-  for (const f of failed) {
-    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
-  }
-  warnings.dump(absRoot);
-  if (failed.length > 0) process.exit(2);
-}
-
-main().catch((e) => {
-  console.error(e);
-  process.exit(1);
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/guide.ts b/callback-box/scripts/migrate/guide.ts
index 25ea4d68..9d9dfe60 100644
--- a/callback-box/scripts/migrate/guide.ts
+++ b/callback-box/scripts/migrate/guide.ts
@@ -1,195 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Migrate `.guide.card` files from the XML body format to Phase-2
- * frontmatter (pure YAML, no body).
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Everything in a guide is structured metadata, so the XML elements map
- * directly onto YAML fields: triage rules with their per-rule
- * confidence/source, named actions, experiments (with observations),
- * reactions, and context notes.
- *
- * Usage:
- *   pnpm exec tsx scripts/migrate/guide.ts <root>           # dry-run
- *   pnpm exec tsx scripts/migrate/guide.ts <root> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, writeFile } from "node:fs/promises";
-import { parseCard, splitCardContent, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { runMigration } from "./_harness.js";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const SPEC: ElementSpec = {
-  attrs: ["version", "job-types"],
-  children: {
-    "applies-to": { attrs: [] },
-    triage: {
-      attrs: [],
-      children: {
-        rule: { attrs: ["confidence", "source", "ref", "action"] },
-        "default-action": { attrs: ["action"] },
-      },
-    },
-    actions: {
-      attrs: [],
-      children: { action: { attrs: ["name"], children: { when: { attrs: [] }, instructions: { attrs: [] } } } },
-    },
-    experiments: {
-      attrs: [],
-      children: {
-        experiment: {
-          attrs: ["id", "status", "created-at", "updated-at"],
-          children: {
-            hypothesis: { attrs: [] },
-            approach: { attrs: [] },
-            "tested-in": { attrs: ["ref", "date"] },
-            observation: { attrs: ["ref", "date"] },
-            conclusion: { attrs: [] },
-          },
-        },
-      },
-    },
-    reactions: { attrs: [], children: { reaction: { attrs: ["id", "sentiment"] } } },
-    "context-notes": { attrs: [], children: { context: { attrs: ["duration", "added-at"] } } },
-  },
-};
-
-function text(el: ElementNode): string {
-  return typeof el.text === "string" ? el.text.trim() : "";
-}
-
-function child(el: ElementNode, tag: string): ElementNode | undefined {
-  return el.children.find((c) => c.tagName === tag);
-}
-
-function childText(el: ElementNode, tag: string): string | undefined {
-  const found = child(el, tag);
-  if (found === undefined) return undefined;
-  const t = text(found);
-  return t === "" ? undefined : t;
-}
-
-function strAttr(el: ElementNode, name: string): string | undefined {
-  const v = el.attrs[name];
-  return typeof v === "string" && v !== "" ? v : undefined;
-}
-
-function put(obj: Record<string, unknown>, key: string, value: string | undefined): void {
-  if (value !== undefined) obj[key] = value;
-}
-
-function convertRule(r: ElementNode): Record<string, unknown> {
-  const out: Record<string, unknown> = { text: text(r) };
-  put(out, "confidence", strAttr(r, "confidence"));
-  put(out, "source", strAttr(r, "source"));
-  put(out, "ref", strAttr(r, "ref"));
-  put(out, "action", strAttr(r, "action"));
-  return out;
-}
-
-function convertExperiment(e: ElementNode): Record<string, unknown> {
-  const out: Record<string, unknown> = {};
-  put(out, "id", strAttr(e, "id"));
-  put(out, "status", strAttr(e, "status"));
-  put(out, "created-at", strAttr(e, "created-at"));
-  put(out, "updated-at", strAttr(e, "updated-at"));
-  put(out, "hypothesis", childText(e, "hypothesis"));
-  put(out, "approach", childText(e, "approach"));
-  const observations = e.children
-    .filter((c) => c.tagName === "observation")
-    .map((o) => {
-      const obs: Record<string, unknown> = { text: text(o) };
-      put(obs, "ref", strAttr(o, "ref"));
-      put(obs, "date", strAttr(o, "date"));
-      return obs;
-    });
-  if (observations.length > 0) out.observations = observations;
-  put(out, "conclusion", childText(e, "conclusion"));
-  return out;
-}
-
-await runMigration({
-  description: "Convert *.guide.card XML body → frontmatter (pure YAML).",
-  match: (name) => name.endsWith(".guide.card"),
-  convert: async (absPath, { warnings, apply }) => {
-    const content = await readFile(absPath, "utf-8");
-    const split = splitCardContent(content);
-    const isXml = /(^|\n)content-type:\s*application\/x-card\+xml/.test(split.frontmatterText);
-    if (split.hasFrontmatter && !isXml) return "already";
-
-    const root = await parseCard(content, { source: absPath });
-    if (root.tagName !== "guide") {
-      throw new Error(`expected <guide> root, got <${root.tagName}>`);
-    }
-    checkElement({ node: root, source: absPath, spec: SPEC, warnings });
-
-    const fields: Record<string, unknown> = { version: strAttr(root, "version") ?? "1.0.0" };
-    const jobTypes = strAttr(root, "job-types");
-    if (jobTypes !== undefined) fields["job-types"] = jobTypes.split(/\s+/).filter(Boolean);
-    put(fields, "applies-to", childText(root, "applies-to"));
-
-    const triage = child(root, "triage");
-    if (triage) {
-      const rules = triage.children.filter((c) => c.tagName === "rule").map(convertRule);
-      if (rules.length > 0) fields["triage-rules"] = rules;
-      const da = child(triage, "default-action");
-      if (da) {
-        const out: Record<string, unknown> = {};
-        put(out, "action", strAttr(da, "action"));
-        if (text(da) !== "") out.text = text(da);
-        fields["default-action"] = out;
-      }
-    }
-
-    const actionsEl = child(root, "actions");
-    if (actionsEl) {
-      const actions = actionsEl.children
-        .filter((c) => c.tagName === "action")
-        .map((a) => {
-          const out: Record<string, unknown> = {};
-          put(out, "name", strAttr(a, "name"));
-          put(out, "when", childText(a, "when"));
-          put(out, "instructions", childText(a, "instructions"));
-          return out;
-        });
-      if (actions.length > 0) fields.actions = actions;
-    }
-
-    const experimentsEl = child(root, "experiments");
-    if (experimentsEl) {
-      const experiments = experimentsEl.children.filter((c) => c.tagName === "experiment").map(convertExperiment);
-      if (experiments.length > 0) fields.experiments = experiments;
-    }
-
-    const reactionsEl = child(root, "reactions");
-    if (reactionsEl) {
-      const reactions = reactionsEl.children
-        .filter((c) => c.tagName === "reaction")
-        .map((r) => {
-          const out: Record<string, unknown> = { text: text(r) };
-          put(out, "id", strAttr(r, "id"));
-          put(out, "sentiment", strAttr(r, "sentiment"));
-          return out;
-        });
-      if (reactions.length > 0) fields.reactions = reactions;
-    }
-
-    const contextNotesEl = child(root, "context-notes");
-    if (contextNotesEl) {
-      const notes = contextNotesEl.children
-        .filter((c) => c.tagName === "context")
-        .map((c) => {
-          const out: Record<string, unknown> = { text: text(c) };
-          put(out, "duration", strAttr(c, "duration"));
-          put(out, "added-at", strAttr(c, "added-at"));
-          return out;
-        });
-      if (notes.length > 0) fields["context-notes"] = notes;
-    }
-
-    const out = `---\n${stringifyYaml(fields)}---\n`;
-    if (apply) await writeFile(absPath, out, "utf-8");
-    return "converted";
-  },
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/image.ts b/callback-box/scripts/migrate/image.ts
index 3552893f..9d9dfe60 100644
--- a/callback-box/scripts/migrate/image.ts
+++ b/callback-box/scripts/migrate/image.ts
@@ -1,207 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Phase 2 (per-schema): migrate `.image.card` files from Phase 1
- * frontmatter-with-XML-body to flat frontmatter.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Usage:
- *   pnpm exec tsx scripts/migrate/image.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/image.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, readdir, writeFile } from "node:fs/promises";
-import { join, relative, resolve } from "node:path";
-import { parseCard, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const SPEC: ElementSpec = {
-  attrs: ["status", "has-text", "rotation"],
-  children: {
-    filename: { attrs: ["ref", "captured", "source"] },
-    description: { attrs: [] },
-    creation: { attrs: [] },
-    text: { attrs: ["source"] },
-    exif: { attrs: ["date", "camera", "gps", "width", "height"] },
-    "subject-bbox": { attrs: ["y1", "x1", "y2", "x2"] },
-    document: {
-      attrs: ["kind", "from"],
-      children: { date: { attrs: ["label"] } },
-    },
-  },
-};
-
-const warnings = new WarningCollector();
-
-async function findCards(root: string): Promise<string[]> {
-  const out: string[] = [];
-  async function walk(dir: string): Promise<void> {
-    let entries;
-    try {
-      entries = await readdir(dir, { withFileTypes: true });
-    } catch (e) {
-      const err = e as NodeJS.ErrnoException;
-      if (err.code === "ENOENT") return;
-      throw e;
-    }
-    for (const entry of entries) {
-      if (entry.name === ".git" || entry.name === "node_modules") continue;
-      const full = join(dir, entry.name);
-      if (entry.isDirectory()) {
-        await walk(full);
-      } else if (entry.isFile() && entry.name.endsWith(".image.card")) {
-        out.push(full);
-      }
-    }
-  }
-  await walk(root);
-  return out;
-}
-
-function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
-  return node.children.find((c) => c.tagName === tagName);
-}
-
-function convertOne(node: ElementNode, source: string): Record<string, unknown> {
-  if (node.tagName !== "image") {
-    throw new Error(`${source}: expected <image> root, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = {
-    type: "image",
-    status: node.attrs["status"] ?? "new",
-  };
-  if (node.attrs["has-text"] !== undefined) {
-    fields["has-text"] = node.attrs["has-text"] === "true";
-  }
-  if (node.attrs["rotation"] !== undefined) {
-    fields["rotation"] = node.attrs["rotation"];
-  }
-
-  const filenameEl = firstChild(node, "filename");
-  if (filenameEl === undefined) {
-    throw new Error(`${source}: missing <filename>`);
-  }
-  const ref = filenameEl.attrs["ref"];
-  const captured = filenameEl.attrs["captured"];
-  const fSource = filenameEl.attrs["source"];
-  if (ref === undefined || captured === undefined || fSource === undefined) {
-    throw new Error(`${source}: <filename> missing ref/captured/source`);
-  }
-  fields["filename"] = { ref, captured, source: fSource };
-
-  const descEl = firstChild(node, "description");
-  if (descEl !== undefined && descEl.text !== undefined && descEl.text !== "") {
-    fields["description"] = descEl.text;
-  }
-
-  const creationEl = firstChild(node, "creation");
-  if (creationEl !== undefined && creationEl.text !== undefined && creationEl.text !== "") {
-    fields["creation"] = creationEl.text;
-  }
-
-  const textBlocks: Array<{ source?: string; content: string }> = [];
-  for (const c of node.children) {
-    if (c.tagName !== "text") continue;
-    if (c.text === undefined || c.text === "") continue;
-    const entry: { source?: string; content: string } = { content: c.text };
-    if (c.attrs["source"] !== undefined) entry.source = c.attrs["source"];
-    textBlocks.push(entry);
-  }
-  if (textBlocks.length > 0) fields["text"] = textBlocks;
-
-  const exifEl = firstChild(node, "exif");
-  if (exifEl !== undefined) {
-    const exif: Record<string, string> = {};
-    for (const k of ["date", "camera", "gps", "width", "height"]) {
-      const v = exifEl.attrs[k];
-      if (v !== undefined) exif[k] = v;
-    }
-    if (Object.keys(exif).length > 0) fields["exif"] = exif;
-  }
-
-  const bboxEl = firstChild(node, "subject-bbox");
-  if (bboxEl !== undefined) {
-    const y1 = bboxEl.attrs["y1"];
-    const x1 = bboxEl.attrs["x1"];
-    const y2 = bboxEl.attrs["y2"];
-    const x2 = bboxEl.attrs["x2"];
-    if (y1 !== undefined && x1 !== undefined && y2 !== undefined && x2 !== undefined) {
-      fields["subject-bbox"] = { y1, x1, y2, x2 };
-    }
-  }
-
-  const docEl = firstChild(node, "document");
-  if (docEl !== undefined) {
-    const doc: Record<string, unknown> = {};
-    if (docEl.attrs["kind"] !== undefined) doc["kind"] = docEl.attrs["kind"];
-    if (docEl.attrs["from"] !== undefined) doc["from"] = docEl.attrs["from"];
-    const dates: Array<{ label: string; value: string }> = [];
-    for (const d of docEl.children) {
-      if (d.tagName !== "date") continue;
-      const label = d.attrs["label"];
-      const value = d.text;
-      if (label !== undefined && value !== undefined) {
-        dates.push({ label, value });
-      }
-    }
-    if (dates.length > 0) doc["dates"] = dates;
-    fields["document"] = doc;
-  }
-
-  return fields;
-}
-
-async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
-  const raw = await readFile(absPath, "utf8");
-  // Already frontmatter (or empty/degenerate) — only an XML card starts with "<".
-  if (!raw.trimStart().startsWith("<")) {
-    return "already-migrated";
-  }
-  const node = await parseCard(raw, { source: absPath });
-  checkElement({ node, source: absPath, spec: SPEC, warnings });
-  const fields = convertOne(node, absPath);
-  const yamlText = stringifyYaml(fields);
-  await writeFile(absPath, `---\n${yamlText}---\n`);
-  return "converted";
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxRoot = positional[0];
-  if (boxRoot === undefined) {
-    console.error("Usage: migrate-image <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const absRoot = resolve(boxRoot);
-  const cards = await findCards(absRoot);
-  console.log(`Found ${String(cards.length)} *.image.card files under ${absRoot}`);
-  if (!apply) {
-    console.log("Dry run. Pass --apply to convert.");
-    return;
-  }
-  let converted = 0;
-  let already = 0;
-  const failed: Array<{ file: string; error: string }> = [];
-  for (const f of cards) {
-    try {
-      const r = await migrateFile(f);
-      if (r === "converted") converted++;
-      else already++;
-    } catch (e) {
-      failed.push({ file: f, error: (e as Error).message });
-    }
-  }
-  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
-  for (const f of failed) {
-    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
-  }
-  warnings.dump(absRoot);
-  if (failed.length > 0) process.exit(2);
-}
-
-main().catch((e) => {
-  console.error(e);
-  process.exit(1);
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/jobs.ts b/callback-box/scripts/migrate/jobs.ts
index 78c751dd..9d9dfe60 100644
--- a/callback-box/scripts/migrate/jobs.ts
+++ b/callback-box/scripts/migrate/jobs.ts
@@ -1,259 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Phase 2: migrate the four remaining job schemas to flat frontmatter.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- *   .intake.job.card
- *   .calendar-review.job.card  (filename uses ".calendar-review-job.card" in some boxes)
- *   .question-followup.job.card / .question-followup-job.card
- *   .chat-job.card / .chat.job.card
- *
- * Usage:
- *   pnpm exec tsx scripts/migrate/jobs.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/jobs.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, readdir, writeFile } from "node:fs/promises";
-import { join, relative, resolve } from "node:path";
-import { parseCard, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const INTAKE_SPEC: ElementSpec = {
-  attrs: ["status", "created", "source", "priority", "version"],
-  children: {
-    description: { attrs: [] },
-    item: { attrs: ["ref"] },
-  },
-};
-
-const CALENDAR_SPEC: ElementSpec = {
-  attrs: ["status", "created", "source", "priority", "version"],
-  children: {
-    description: { attrs: [] },
-    change: {
-      attrs: ["action", "ref"],
-      children: { ics: { attrs: [] } },
-    },
-  },
-};
-
-const CHAT_JOB_SPEC: ElementSpec = {
-  attrs: ["status", "created", "source", "version"],
-  children: {
-    description: { attrs: [] },
-    thread: { attrs: ["ref"] },
-  },
-};
-
-const QFU_SPEC: ElementSpec = {
-  attrs: ["status", "created", "source", "version"],
-  children: {
-    description: { attrs: [] },
-    "question-ref": { attrs: ["ref"] },
-    directive: { attrs: [] },
-    answer: { attrs: [] },
-  },
-};
-
-const SPECS: Record<Kind, ElementSpec> = {
-  "intake-job": INTAKE_SPEC,
-  "calendar-review-job": CALENDAR_SPEC,
-  "chat-job": CHAT_JOB_SPEC,
-  "question-followup-job": QFU_SPEC,
-};
-
-const warnings = new WarningCollector();
-
-type Kind = "intake-job" | "calendar-review-job" | "chat-job" | "question-followup-job";
-
-const SUFFIXES: Record<Kind, string[]> = {
-  "intake-job": [".intake.job.card"],
-  "calendar-review-job": [".calendar-review.job.card", ".calendar-review-job.card"],
-  "chat-job": [".chat-job.card", ".chat.job.card"],
-  "question-followup-job": [".question-followup.job.card", ".question-followup-job.card"],
-};
-
-async function findCards(root: string, suffixes: string[]): Promise<string[]> {
-  const out: string[] = [];
-  async function walk(dir: string): Promise<void> {
-    let entries;
-    try {
-      entries = await readdir(dir, { withFileTypes: true });
-    } catch (e) {
-      const err = e as NodeJS.ErrnoException;
-      if (err.code === "ENOENT") return;
-      throw e;
-    }
-    for (const entry of entries) {
-      if (entry.name === ".git" || entry.name === "node_modules") continue;
-      const full = join(dir, entry.name);
-      if (entry.isDirectory()) {
-        await walk(full);
-      } else if (entry.isFile() && suffixes.some((s) => entry.name.endsWith(s))) {
-        out.push(full);
-      }
-    }
-  }
-  await walk(root);
-  return out;
-}
-
-function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
-  return node.children.find((c) => c.tagName === tagName);
-}
-
-function childText(node: ElementNode, tagName: string): string | undefined {
-  const c = firstChild(node, tagName);
-  if (c === undefined) return undefined;
-  const t = c.text;
-  return t === undefined || t === "" ? undefined : t;
-}
-
-function convertIntakeJob(node: ElementNode, source: string): Record<string, unknown> {
-  if (node.tagName !== "intake-job") {
-    throw new Error(`${source}: expected <intake-job> root, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = {
-    type: "intake-job",
-    status: node.attrs["status"] ?? "pending",
-    created: node.attrs["created"] ?? "",
-    source: node.attrs["source"] ?? "",
-    priority: node.attrs["priority"] ?? "normal",
-    description: childText(node, "description") ?? "",
-  };
-  const items: Array<{ ref: string }> = [];
-  for (const c of node.children) {
-    if (c.tagName !== "item") continue;
-    const ref = c.attrs["ref"];
-    if (ref !== undefined) items.push({ ref });
-  }
-  fields["items"] = items;
-  return fields;
-}
-
-function convertCalendarReviewJob(node: ElementNode, source: string): Record<string, unknown> {
-  if (node.tagName !== "calendar-review-job") {
-    throw new Error(`${source}: expected <calendar-review-job> root, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = {
-    type: "calendar-review-job",
-    status: node.attrs["status"] ?? "pending",
-    created: node.attrs["created"] ?? "",
-    source: node.attrs["source"] ?? "",
-    priority: node.attrs["priority"] ?? "normal",
-    description: childText(node, "description") ?? "",
-  };
-  const changes: Array<Record<string, unknown>> = [];
-  for (const c of node.children) {
-    if (c.tagName !== "change") continue;
-    const action = c.attrs["action"];
-    if (action === undefined) continue;
-    const entry: Record<string, unknown> = {
-      action,
-      summary: (c.text ?? "").trim(),
-    };
-    if (c.attrs["ref"] !== undefined) entry["ref"] = c.attrs["ref"];
-    const icsEl = firstChild(c, "ics");
-    if (icsEl !== undefined && icsEl.text !== undefined) entry["ics"] = icsEl.text;
-    changes.push(entry);
-  }
-  fields["changes"] = changes;
-  return fields;
-}
-
-function convertChatJob(node: ElementNode, source: string): Record<string, unknown> {
-  if (node.tagName !== "chat-job") {
-    throw new Error(`${source}: expected <chat-job> root, got <${node.tagName}>`);
-  }
-  const threadEl = firstChild(node, "thread");
-  const threadRef = threadEl?.attrs["ref"] ?? "";
-  return {
-    type: "chat-job",
-    status: node.attrs["status"] ?? "pending",
-    created: node.attrs["created"] ?? "",
-    source: node.attrs["source"] ?? "",
-    description: childText(node, "description") ?? "",
-    thread: { ref: threadRef },
-  };
-}
-
-function convertQuestionFollowupJob(node: ElementNode, source: string): Record<string, unknown> {
-  if (node.tagName !== "question-followup-job") {
-    throw new Error(`${source}: expected <question-followup-job> root, got <${node.tagName}>`);
-  }
-  const qrefEl = firstChild(node, "question-ref");
-  return {
-    type: "question-followup-job",
-    status: node.attrs["status"] ?? "pending",
-    created: node.attrs["created"] ?? "",
-    source: node.attrs["source"] ?? "question-answer",
-    description: childText(node, "description") ?? "",
-    "question-ref": { ref: qrefEl?.attrs["ref"] ?? "" },
-    directive: childText(node, "directive") ?? "",
-    answer: childText(node, "answer") ?? "",
-  };
-}
-
-const CONVERTERS: Record<Kind, (n: ElementNode, src: string) => Record<string, unknown>> = {
-  "intake-job": convertIntakeJob,
-  "calendar-review-job": convertCalendarReviewJob,
-  "chat-job": convertChatJob,
-  "question-followup-job": convertQuestionFollowupJob,
-};
-
-async function migrateFile(absPath: string, kind: Kind): Promise<"converted" | "already-migrated"> {
-  const raw = await readFile(absPath, "utf8");
-  // Already frontmatter (or empty/degenerate) — only an XML card starts with "<".
-  if (!raw.trimStart().startsWith("<")) return "already-migrated";
-  const node = await parseCard(raw, { source: absPath });
-  checkElement({ node, source: absPath, spec: SPECS[kind], warnings });
-  const fields = CONVERTERS[kind](node, absPath);
-  await writeFile(absPath, `---\n${stringifyYaml(fields)}---\n`);
-  return "converted";
-}
-
-async function migrateKind(input: { absRoot: string; kind: Kind; apply: boolean }): Promise<void> {
-  const { absRoot, kind, apply } = input;
-  const suffixes = SUFFIXES[kind];
-  const cards = await findCards(absRoot, suffixes);
-  console.log(`Found ${String(cards.length)} ${kind} cards under ${absRoot}`);
-  if (!apply) return;
-  let converted = 0;
-  let already = 0;
-  const failed: Array<{ file: string; error: string }> = [];
-  for (const f of cards) {
-    try {
-      const r = await migrateFile(f, kind);
-      if (r === "converted") converted++;
-      else already++;
-    } catch (e) {
-      failed.push({ file: f, error: (e as Error).message });
-    }
-  }
-  console.log(`${kind}: converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
-  for (const f of failed.slice(0, 10)) {
-    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
-  }
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxRoot = positional[0];
-  if (boxRoot === undefined) {
-    console.error("Usage: migrate-jobs <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const absRoot = resolve(boxRoot);
-  for (const kind of Object.keys(SUFFIXES) as Kind[]) {
-    await migrateKind({ absRoot, kind, apply });
-  }
-  warnings.dump(absRoot);
-}
-
-main().catch((e) => {
-  console.error(e);
-  process.exit(1);
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/landmark.ts b/callback-box/scripts/migrate/landmark.ts
index 7f8ebaac..9d9dfe60 100644
--- a/callback-box/scripts/migrate/landmark.ts
+++ b/callback-box/scripts/migrate/landmark.ts
@@ -1,219 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Migrate `.landmark.card` files from the XML body format to all-YAML
- * frontmatter.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Old (XML):
- *   ---
- *   content-type: application/x-card+xml
- *   ---
- *   <landmark>
- *     <navigation>
- *       <label>Recipes</label>
- *       <symbol>🍳</symbol>
- *       <link ref="Bread.recipe.card">the bread</link>
- *       <expand query="*.recipe.card" order="modified-desc">
- *         <link template-ref="${path}">${title}</link>
- *       </expand>
- *     </navigation>
- *     <destination for="triage">
- *       <rules>…</rules>
- *       <procedure ref="archive-recipe.procedure.card"/>
- *     </destination>
- *   </landmark>
- *
- * New (frontmatter):
- *   ---
- *   navigation:
- *     label: Recipes
- *     symbol: 🍳
- *     links:
- *       - { ref: Bread.recipe.card, label: the bread }
- *     expand:
- *       - { query: "*.recipe.card", order: modified-desc, template-ref: "${path}", template-label: "${title}" }
- *   destinations:
- *     - for: [triage]
- *       rules: "…"
- *       procedure-ref: archive-recipe.procedure.card
- *   ---
- *
- * Usage:
- *   pnpm exec tsx scripts/migrate/landmark.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/landmark.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, writeFile } from "node:fs/promises";
-import { parseCard, splitCardContent, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { runMigration } from "./_harness.js";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const SPEC: ElementSpec = {
-  attrs: [],
-  children: {
-    navigation: {
-      attrs: [],
-      children: {
-        label: { attrs: [] },
-        symbol: { attrs: ["src"] },
-        link: { attrs: ["ref", "template-ref"] },
-        expand: {
-          attrs: ["query", "order"],
-          children: { link: { attrs: ["ref", "template-ref"] } },
-        },
-        "chat-app": { attrs: ["narration", "prose"] },
-      },
-    },
-    destination: {
-      attrs: ["for"],
-      children: { rules: { attrs: [] }, procedure: { attrs: ["ref"] } },
-    },
-    "triage-destination": {
-      attrs: [],
-      children: { rules: { attrs: [] }, procedure: { attrs: ["ref"] } },
-    },
-  },
-};
-
-function text(el: ElementNode): string {
-  return typeof el.text === "string" ? el.text.trim() : "";
-}
-
-function child(el: ElementNode, tag: string): ElementNode | undefined {
-  return el.children.find((c) => c.tagName === tag);
-}
-
-function children(el: ElementNode, tag: string): ElementNode[] {
-  return el.children.filter((c) => c.tagName === tag);
-}
-
-interface LinkObj {
-  ref: string;
-  label?: string;
-}
-
-interface ExpandObj {
-  query: string;
-  order?: string;
-  "template-ref"?: string;
-  "template-label"?: string;
-}
-
-function convertNavigation(nav: ElementNode, source: string, warnings: WarningCollector): Record<string, unknown> | undefined {
-  const out: Record<string, unknown> = {};
-  const labelEl = child(nav, "label");
-  if (labelEl && text(labelEl) !== "") out.label = text(labelEl);
-
-  const symbolEl = child(nav, "symbol");
-  if (symbolEl) {
-    const src = symbolEl.attrs["src"];
-    if (typeof src === "string" && src !== "") out.symbol = { src };
-    else if (text(symbolEl) !== "") out.symbol = text(symbolEl);
-  }
-
-  const links: LinkObj[] = [];
-  for (const linkEl of children(nav, "link")) {
-    const ref = linkEl.attrs["ref"];
-    if (typeof ref !== "string" || ref === "") {
-      warnings.push(source, `<navigation> <link> without ref (template-ref="${String(linkEl.attrs["template-ref"])}") dropped`);
-      continue;
-    }
-    const label = text(linkEl);
-    links.push(label === "" ? { ref } : { ref, label });
-  }
-  if (links.length > 0) out.links = links;
-
-  const expands: ExpandObj[] = [];
-  for (const expandEl of children(nav, "expand")) {
-    const query = expandEl.attrs["query"];
-    if (typeof query !== "string" || query === "") {
-      warnings.push(source, "<expand> without query dropped");
-      continue;
-    }
-    const expand: ExpandObj = { query };
-    const order = expandEl.attrs["order"];
-    if (typeof order === "string" && order !== "" && order !== "alphabetical") expand.order = order;
-    const tplLinks = children(expandEl, "link");
-    if (tplLinks.length > 1) {
-      warnings.push(source, `<expand query="${query}"> has ${String(tplLinks.length)} template links; only the first is kept`);
-    }
-    const tpl = tplLinks[0];
-    if (tpl) {
-      const tplRef = tpl.attrs["template-ref"];
-      if (typeof tplRef === "string" && tplRef !== "" && tplRef !== "${path}") expand["template-ref"] = tplRef;
-      const tplLabel = text(tpl);
-      if (tplLabel !== "") expand["template-label"] = tplLabel;
-    }
-    expands.push(expand);
-  }
-  if (expands.length > 0) out.expand = expands;
-
-  const chatAppEl = child(nav, "chat-app");
-  if (chatAppEl) {
-    const chatApp: Record<string, string> = {};
-    for (const [k, v] of Object.entries(chatAppEl.attrs)) {
-      if (typeof v === "string") chatApp[k] = v;
-    }
-    if (Object.keys(chatApp).length > 0) out["chat-app"] = chatApp;
-  }
-
-  return Object.keys(out).length > 0 ? out : undefined;
-}
-
-function convertDestination(el: ElementNode): Record<string, unknown> {
-  const out: Record<string, unknown> = {};
-  if (el.tagName === "triage-destination") {
-    out.for = ["triage"];
-  } else {
-    const forAttr = el.attrs["for"];
-    const kinds = typeof forAttr === "string" ? forAttr.trim().split(/\s+/).filter((t) => t !== "") : [];
-    out.for = kinds;
-  }
-  const rulesEl = child(el, "rules");
-  if (rulesEl && text(rulesEl) !== "") out.rules = text(rulesEl);
-  const procEl = child(el, "procedure");
-  if (procEl) {
-    const ref = procEl.attrs["ref"];
-    if (typeof ref === "string" && ref !== "") out["procedure-ref"] = ref;
-  }
-  return out;
-}
-
-await runMigration({
-  description: "Convert *.landmark.card XML body → all-YAML frontmatter.",
-  match: (name) => name.endsWith(".landmark.card"),
-  convert: async (absPath, { warnings, apply }) => {
-    const content = await readFile(absPath, "utf-8");
-    const split = splitCardContent(content);
-    const contentType = /(^|\n)content-type:\s*application\/x-card\+xml/.test(split.frontmatterText);
-    if (split.hasFrontmatter && !contentType) {
-      // Already frontmatter (no XML content-type marker).
-      return "already";
-    }
-
-    const root = await parseCard(content, { source: absPath });
-    if (root.tagName !== "landmark") {
-      throw new Error(`expected <landmark> root, got <${root.tagName}>`);
-    }
-    checkElement({ node: root, source: absPath, spec: SPEC, warnings });
-
-    const fields: Record<string, unknown> = {};
-    const navEl = child(root, "navigation");
-    if (navEl) {
-      const navigation = convertNavigation(navEl, absPath, warnings);
-      if (navigation) fields.navigation = navigation;
-    }
-    const destinations: Record<string, unknown>[] = [];
-    for (const el of root.children) {
-      if (el.tagName === "destination" || el.tagName === "triage-destination") {
-        destinations.push(convertDestination(el));
-      }
-    }
-    if (destinations.length > 0) fields.destinations = destinations;
-
-    const out = `---\n${stringifyYaml(fields)}---\n`;
-    if (apply) await writeFile(absPath, out, "utf-8");
-    return "converted";
-  },
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/memo.ts b/callback-box/scripts/migrate/memo.ts
index 7a716cf2..9d9dfe60 100644
--- a/callback-box/scripts/migrate/memo.ts
+++ b/callback-box/scripts/migrate/memo.ts
@@ -1,171 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Phase 2 (per-schema): migrate `.memo.card` files from Phase 1
- * frontmatter-with-XML-body to flat frontmatter + markdown body.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Usage:
- *   pnpm exec tsx scripts/migrate/memo.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/memo.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, readdir, writeFile } from "node:fs/promises";
-import { join, relative, resolve } from "node:path";
-import { parseCard, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const SPEC: ElementSpec = {
-  attrs: ["status", "version"],
-  children: {
-    created: { attrs: [] },
-    source: { attrs: [] },
-    context: { attrs: ["url", "title"] },
-    transcription: { attrs: ["language", "transcribed-at"] },
-    "transcription-error": { attrs: ["permanent", "code", "attempted-at"] },
-    content: { attrs: [] },
-  },
-};
-
-const warnings = new WarningCollector();
-
-async function findCards(root: string): Promise<string[]> {
-  const out: string[] = [];
-  async function walk(dir: string): Promise<void> {
-    let entries;
-    try {
-      entries = await readdir(dir, { withFileTypes: true });
-    } catch (e) {
-      const err = e as NodeJS.ErrnoException;
-      if (err.code === "ENOENT") return;
-      throw e;
-    }
-    for (const entry of entries) {
-      if (entry.name === ".git" || entry.name === "node_modules") continue;
-      const full = join(dir, entry.name);
-      if (entry.isDirectory()) {
-        await walk(full);
-      } else if (entry.isFile() && entry.name.endsWith(".memo.card")) {
-        out.push(full);
-      }
-    }
-  }
-  await walk(root);
-  return out;
-}
-
-function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
-  return node.children.find((c) => c.tagName === tagName);
-}
-
-function childText(node: ElementNode, tagName: string): string | undefined {
-  const c = firstChild(node, tagName);
-  if (c === undefined) return undefined;
-  const t = c.text;
-  return t === undefined || t === "" ? undefined : t;
-}
-
-function convertOne(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
-  if (node.tagName !== "memo") {
-    throw new Error(`${source}: expected <memo> root, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = {
-    type: "memo",
-    status: node.attrs["status"] ?? "new",
-  };
-
-  const created = childText(node, "created");
-  if (created === undefined) throw new Error(`${source}: missing <created>`);
-  fields["created"] = created;
-
-  const memoSource = childText(node, "source");
-  if (memoSource !== undefined) fields["source"] = memoSource;
-
-  const contextEl = firstChild(node, "context");
-  if (contextEl !== undefined) {
-    const ctx: Record<string, unknown> = {};
-    if (contextEl.attrs["url"] !== undefined) ctx["url"] = contextEl.attrs["url"];
-    if (contextEl.attrs["title"] !== undefined) ctx["title"] = contextEl.attrs["title"];
-    if (contextEl.text !== undefined && contextEl.text !== "") ctx["text"] = contextEl.text;
-    if (Object.keys(ctx).length > 0) fields["context"] = ctx;
-  }
-
-  const transEl = firstChild(node, "transcription");
-  if (transEl !== undefined && transEl.text !== undefined && transEl.text !== "") {
-    const t: Record<string, unknown> = { text: transEl.text };
-    if (transEl.attrs["language"] !== undefined) t["language"] = transEl.attrs["language"];
-    if (transEl.attrs["transcribed-at"] !== undefined) t["transcribed-at"] = transEl.attrs["transcribed-at"];
-    fields["transcription"] = t;
-  }
-
-  const errEl = firstChild(node, "transcription-error");
-  if (errEl !== undefined && errEl.text !== undefined && errEl.text !== "") {
-    const e: Record<string, unknown> = {
-      permanent: errEl.attrs["permanent"] === "true",
-      message: errEl.text,
-    };
-    if (errEl.attrs["code"] !== undefined) e["code"] = errEl.attrs["code"];
-    if (errEl.attrs["attempted-at"] !== undefined) e["attempted-at"] = errEl.attrs["attempted-at"];
-    fields["transcription-error"] = e;
-  }
-
-  const content = childText(node, "content");
-  const body = content === undefined ? "" : content;
-  return { fields, body };
-}
-
-async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
-  const raw = await readFile(absPath, "utf8");
-  // Already frontmatter (or empty/degenerate) — only an XML card starts with "<".
-  if (!raw.trimStart().startsWith("<")) {
-    return "already-migrated";
-  }
-  const node = await parseCard(raw, { source: absPath });
-  checkElement({ node, source: absPath, spec: SPEC, warnings });
-  const { fields, body } = convertOne(node, absPath);
-  const yamlText = stringifyYaml(fields);
-  const bodyTail = body === "" ? "" : `${body}${body.endsWith("\n") ? "" : "\n"}`;
-  await writeFile(absPath, `---\n${yamlText}---\n${bodyTail}`);
-  return "converted";
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxRoot = positional[0];
-  if (boxRoot === undefined) {
-    console.error("Usage: migrate-memo <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const absRoot = resolve(boxRoot);
-  const cards = await findCards(absRoot);
-  console.log(`Found ${String(cards.length)} *.memo.card files under ${absRoot}`);
-  if (!apply) {
-    console.log("Dry run. Pass --apply to convert.");
-    return;
-  }
-  let converted = 0;
-  let already = 0;
-  const failed: Array<{ file: string; error: string }> = [];
-  for (const f of cards) {
-    try {
-      const r = await migrateFile(f);
-      if (r === "converted") converted++;
-      else already++;
-    } catch (e) {
-      failed.push({ file: f, error: (e as Error).message });
-    }
-  }
-  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
-  for (const f of failed) {
-    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
-  }
-  warnings.dump(absRoot);
-  if (failed.length > 0) process.exit(2);
-}
-
-main().catch((e) => {
-  console.error(e);
-  process.exit(1);
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/misc.ts b/callback-box/scripts/migrate/misc.ts
index 245905f8..9d9dfe60 100644
--- a/callback-box/scripts/migrate/misc.ts
+++ b/callback-box/scripts/migrate/misc.ts
@@ -1,291 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Phase 2 (per-schema): migrate `.todo-list.card`, `.telegram-message.card`,
- * and `.feedback.card` files from Phase 1 frontmatter-with-XML-body to flat
- * frontmatter. Feedback keeps its prose response in a markdown body; the
- * other two are pure frontmatter.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Usage:
- *   pnpm exec tsx scripts/migrate/misc.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/misc.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, readdir, writeFile } from "node:fs/promises";
-import { join, relative, resolve } from "node:path";
-import { parseCard, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const ITEM_SPEC: ElementSpec = {
-  attrs: ["name", "status", "completed"],
-  children: {
-    details: { attrs: [] },
-    "agent-notes": { attrs: [] },
-    // self-recursive via constructor below
-  },
-};
-ITEM_SPEC.children!.item = ITEM_SPEC;
-
-const TODO_SPEC: ElementSpec = {
-  attrs: ["name", "version"],
-  children: {
-    details: { attrs: [] },
-    "agent-notes": { attrs: [] },
-    item: ITEM_SPEC,
-  },
-};
-
-const TELEGRAM_SPEC: ElementSpec = {
-  attrs: ["status", "chat-id", "version"],
-  children: {
-    text: { attrs: [] },
-    "reply-to": { attrs: [] },
-    response: { attrs: ["sent-at", "message-id"] },
-    error: { attrs: [] },
-  },
-};
-
-const FEEDBACK_SPEC: ElementSpec = {
-  attrs: ["type", "version"],
-  children: {
-    target: { attrs: ["ref"] },
-    source: { attrs: [] },
-    timestamp: { attrs: [] },
-    transcription: { attrs: ["language", "transcribed-at"] },
-    "transcription-error": { attrs: ["permanent", "code", "attempted-at"] },
-    response: { attrs: [] },
-    comment: { attrs: [] },
-  },
-};
-
-const SPECS: Record<Kind, ElementSpec> = {
-  "todo-list": TODO_SPEC,
-  "telegram-message": TELEGRAM_SPEC,
-  feedback: FEEDBACK_SPEC,
-};
-
-const warnings = new WarningCollector();
-
-type Kind = "todo-list" | "telegram-message" | "feedback";
-
-async function findCards(root: string, suffix: string): Promise<string[]> {
-  const out: string[] = [];
-  async function walk(dir: string): Promise<void> {
-    let entries;
-    try {
-      entries = await readdir(dir, { withFileTypes: true });
-    } catch (e) {
-      const err = e as NodeJS.ErrnoException;
-      if (err.code === "ENOENT") return;
-      throw e;
-    }
-    for (const entry of entries) {
-      if (entry.name === ".git" || entry.name === "node_modules") continue;
-      const full = join(dir, entry.name);
-      if (entry.isDirectory()) {
-        await walk(full);
-      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
-        out.push(full);
-      }
-    }
-  }
-  await walk(root);
-  return out;
-}
-
-function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
-  return node.children.find((c) => c.tagName === tagName);
-}
-
-function childText(node: ElementNode, tagName: string): string | undefined {
-  const c = firstChild(node, tagName);
-  if (c === undefined) return undefined;
-  const t = c.text;
-  return t === undefined || t === "" ? undefined : t;
-}
-
-function convertItem(node: ElementNode): Record<string, unknown> {
-  const entry: Record<string, unknown> = {
-    name: node.attrs["name"] ?? "",
-    status: node.attrs["status"] ?? "pending",
-  };
-  if (node.attrs["completed"] !== undefined) entry["completed"] = node.attrs["completed"];
-  const details = childText(node, "details");
-  if (details !== undefined) entry["details"] = details;
-  const agentNotes = childText(node, "agent-notes");
-  if (agentNotes !== undefined) entry["agent-notes"] = agentNotes;
-  const subItems: Array<Record<string, unknown>> = [];
-  for (const c of node.children) {
-    if (c.tagName === "item") subItems.push(convertItem(c));
-  }
-  if (subItems.length > 0) entry["items"] = subItems;
-  return entry;
-}
-
-function convertTodoList(node: ElementNode, source: string): Record<string, unknown> {
-  if (node.tagName !== "todo-list") {
-    throw new Error(`${source}: expected <todo-list> root, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = {
-    type: "todo-list",
-    name: node.attrs["name"] ?? "",
-  };
-  const details = childText(node, "details");
-  if (details !== undefined) fields["details"] = details;
-  const agentNotes = childText(node, "agent-notes");
-  if (agentNotes !== undefined) fields["agent-notes"] = agentNotes;
-  const items: Array<Record<string, unknown>> = [];
-  for (const c of node.children) {
-    if (c.tagName === "item") items.push(convertItem(c));
-  }
-  if (items.length > 0) fields["items"] = items;
-  return fields;
-}
-
-function convertTelegramMessage(node: ElementNode, source: string): Record<string, unknown> {
-  if (node.tagName !== "telegram-message") {
-    throw new Error(`${source}: expected <telegram-message> root, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = {
-    type: "telegram-message",
-    status: node.attrs["status"] ?? "pending",
-    "chat-id": node.attrs["chat-id"] ?? "",
-    text: childText(node, "text") ?? "",
-  };
-  const replyTo = childText(node, "reply-to");
-  if (replyTo !== undefined) {
-    const n = Number(replyTo);
-    if (Number.isFinite(n)) fields["reply-to"] = n;
-  }
-  const responseEl = firstChild(node, "response");
-  if (responseEl !== undefined) {
-    const sentAt = responseEl.attrs["sent-at"];
-    const messageId = responseEl.attrs["message-id"];
-    if (sentAt !== undefined && messageId !== undefined) {
-      fields["response"] = { "sent-at": sentAt, "message-id": messageId };
-    }
-  }
-  const errorText = childText(node, "error");
-  if (errorText !== undefined) fields["error"] = errorText;
-  return fields;
-}
-
-function convertFeedback(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
-  if (node.tagName !== "feedback") {
-    throw new Error(`${source}: expected <feedback> root, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = { type: "feedback" };
-  if (node.attrs["type"] !== undefined) fields["type-of-feedback"] = node.attrs["type"];
-
-  const targetEl = firstChild(node, "target");
-  if (targetEl === undefined || targetEl.attrs["ref"] === undefined) {
-    throw new Error(`${source}: missing <target ref="...">`);
-  }
-  fields["target"] = { ref: targetEl.attrs["ref"] };
-
-  const sourceText = childText(node, "source");
-  if (sourceText === undefined) throw new Error(`${source}: missing <source>`);
-  fields["source"] = sourceText;
-
-  const timestamp = childText(node, "timestamp");
-  if (timestamp === undefined) throw new Error(`${source}: missing <timestamp>`);
-  fields["timestamp"] = timestamp;
-
-  const transEl = firstChild(node, "transcription");
-  if (transEl !== undefined && transEl.text !== undefined && transEl.text !== "") {
-    const t: Record<string, unknown> = { text: transEl.text };
-    if (transEl.attrs["language"] !== undefined) t["language"] = transEl.attrs["language"];
-    if (transEl.attrs["transcribed-at"] !== undefined) t["transcribed-at"] = transEl.attrs["transcribed-at"];
-    fields["transcription"] = t;
-  }
-
-  const errEl = firstChild(node, "transcription-error");
-  if (errEl !== undefined && errEl.text !== undefined && errEl.text !== "") {
-    const e: Record<string, unknown> = {
-      permanent: errEl.attrs["permanent"] === "true",
-      message: errEl.text,
-    };
-    if (errEl.attrs["code"] !== undefined) e["code"] = errEl.attrs["code"];
-    if (errEl.attrs["attempted-at"] !== undefined) e["attempted-at"] = errEl.attrs["attempted-at"];
-    fields["transcription-error"] = e;
-  }
-
-  // Body is the user's typed response/comment.
-  const response = childText(node, "response");
-  const comment = childText(node, "comment");
-  const body = response ?? comment ?? "";
-  return { fields, body };
-}
-
-async function migrateFile(absPath: string, kind: Kind): Promise<"converted" | "already-migrated"> {
-  const raw = await readFile(absPath, "utf8");
-  // Already frontmatter (or empty/degenerate) — only an XML card starts with "<".
-  if (!raw.trimStart().startsWith("<")) return "already-migrated";
-  const node = await parseCard(raw, { source: absPath });
-  checkElement({ node, source: absPath, spec: SPECS[kind], warnings });
-  let fields: Record<string, unknown>;
-  let body = "";
-  if (kind === "todo-list") {
-    fields = convertTodoList(node, absPath);
-  } else if (kind === "telegram-message") {
-    fields = convertTelegramMessage(node, absPath);
-  } else {
-    const out = convertFeedback(node, absPath);
-    fields = out.fields;
-    body = out.body;
-  }
-  const yamlText = stringifyYaml(fields);
-  const bodyTail = body === "" ? "" : `${body}${body.endsWith("\n") ? "" : "\n"}`;
-  await writeFile(absPath, `---\n${yamlText}---\n${bodyTail}`);
-  return "converted";
-}
-
-async function migrateKind(input: { absRoot: string; kind: Kind; apply: boolean }): Promise<void> {
-  const { absRoot, kind, apply } = input;
-  const suffix = `.${kind}.card`;
-  const cards = await findCards(absRoot, suffix);
-  console.log(`Found ${String(cards.length)} *${suffix} files under ${absRoot}`);
-  if (!apply) {
-    console.log(`Dry run for ${kind}. Pass --apply to convert.`);
-    return;
-  }
-  let converted = 0;
-  let already = 0;
-  const failed: Array<{ file: string; error: string }> = [];
-  for (const f of cards) {
-    try {
-      const r = await migrateFile(f, kind);
-      if (r === "converted") converted++;
-      else already++;
-    } catch (e) {
-      failed.push({ file: f, error: (e as Error).message });
-    }
-  }
-  console.log(`${kind}: converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
-  for (const f of failed) {
-    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
-  }
-  if (failed.length > 0) process.exit(2);
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxRoot = positional[0];
-  if (boxRoot === undefined) {
-    console.error("Usage: migrate-misc <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const absRoot = resolve(boxRoot);
-  await migrateKind({ absRoot, kind: "todo-list", apply });
-  await migrateKind({ absRoot, kind: "telegram-message", apply });
-  await migrateKind({ absRoot, kind: "feedback", apply });
-  warnings.dump(absRoot);
-}
-
-main().catch((e) => {
-  console.error(e);
-  process.exit(1);
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/personality.ts b/callback-box/scripts/migrate/personality.ts
index 91dc0d2c..9d9dfe60 100644
--- a/callback-box/scripts/migrate/personality.ts
+++ b/callback-box/scripts/migrate/personality.ts
@@ -1,289 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Phase 2: migrate `.personality.card` files from Phase 1
- * frontmatter-with-XML-body to flat frontmatter + markdown body.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Usage:
- *   pnpm exec tsx scripts/migrate/personality.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/personality.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, readdir, writeFile } from "node:fs/promises";
-import { join, relative, resolve } from "node:path";
-import { parseCard, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const EVIDENCE_ATTRS = ["confidence", "source", "ref"];
-
-const EXPERIMENT_SPEC: ElementSpec = {
-  attrs: ["id", "status", "created-at", "updated-at"],
-  children: {
-    hypothesis: { attrs: [] },
-    approach: { attrs: [] },
-    observation: { attrs: ["ref", "date"] },
-    conclusion: { attrs: [] },
-  },
-};
-
-const SPEC: ElementSpec = {
-  attrs: ["version"],
-  children: {
-    "goes-by": { attrs: [] },
-    role: { attrs: [] },
-    boxholder: {
-      attrs: ["ref"],
-      children: {
-        "full-name": { attrs: [] },
-        called: { attrs: [] },
-        relationship: { attrs: EVIDENCE_ATTRS },
-      },
-    },
-    "speaking-voice": {
-      attrs: ["model"],
-      children: { instruction: { attrs: [] } },
-    },
-    tone: {
-      attrs: [],
-      children: { instruction: { attrs: EVIDENCE_ATTRS } },
-    },
-    traits: {
-      attrs: [],
-      children: {
-        trait: { attrs: EVIDENCE_ATTRS },
-        unresolved: { attrs: [], children: { note: { attrs: [] } } },
-        description: { attrs: [] },
-      },
-    },
-    experiments: {
-      attrs: [],
-      children: { experiment: EXPERIMENT_SPEC },
-    },
-    "context-notes": {
-      attrs: [],
-      children: { context: { attrs: ["duration", "added-at"] } },
-    },
-  },
-};
-
-const warnings = new WarningCollector();
-
-async function findCards(root: string): Promise<string[]> {
-  const out: string[] = [];
-  async function walk(dir: string): Promise<void> {
-    let entries;
-    try {
-      entries = await readdir(dir, { withFileTypes: true });
-    } catch (e) {
-      const err = e as NodeJS.ErrnoException;
-      if (err.code === "ENOENT") return;
-      throw e;
-    }
-    for (const entry of entries) {
-      if (entry.name === ".git" || entry.name === "node_modules") continue;
-      const full = join(dir, entry.name);
-      if (entry.isDirectory()) {
-        await walk(full);
-      } else if (entry.isFile() && entry.name.endsWith(".personality.card")) {
-        out.push(full);
-      }
-    }
-  }
-  await walk(root);
-  return out;
-}
-
-function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
-  return node.children.find((c) => c.tagName === tagName);
-}
-
-function childText(node: ElementNode, tagName: string): string | undefined {
-  const c = firstChild(node, tagName);
-  if (c === undefined) return undefined;
-  const t = c.text;
-  return t === undefined || t === "" ? undefined : t;
-}
-
-function convertWithEvidence(node: ElementNode): Record<string, unknown> {
-  const out: Record<string, unknown> = { text: node.text ?? "" };
-  if (node.attrs["confidence"] !== undefined) out["confidence"] = node.attrs["confidence"];
-  if (node.attrs["source"] !== undefined) out["source"] = node.attrs["source"];
-  if (node.attrs["ref"] !== undefined) out["ref"] = node.attrs["ref"];
-  return out;
-}
-
-function convertExperiment(node: ElementNode): Record<string, unknown> {
-  const out: Record<string, unknown> = { id: node.attrs["id"] ?? "" };
-  if (node.attrs["status"] !== undefined) out["status"] = node.attrs["status"];
-  if (node.attrs["created-at"] !== undefined) out["created-at"] = node.attrs["created-at"];
-  if (node.attrs["updated-at"] !== undefined) out["updated-at"] = node.attrs["updated-at"];
-  const hypothesis = childText(node, "hypothesis");
-  if (hypothesis !== undefined) out["hypothesis"] = hypothesis;
-  const approach = childText(node, "approach");
-  if (approach !== undefined) out["approach"] = approach;
-  const observations: Array<Record<string, unknown>> = [];
-  for (const o of node.children) {
-    if (o.tagName !== "observation") continue;
-    const entry: Record<string, unknown> = { text: o.text ?? "" };
-    if (o.attrs["ref"] !== undefined) entry["ref"] = o.attrs["ref"];
-    if (o.attrs["date"] !== undefined) entry["date"] = o.attrs["date"];
-    observations.push(entry);
-  }
-  if (observations.length > 0) out["observations"] = observations;
-  const conclusion = childText(node, "conclusion");
-  if (conclusion !== undefined) out["conclusion"] = conclusion;
-  return out;
-}
-
-function convertOne(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
-  if (node.tagName !== "personality") {
-    throw new Error(`${source}: expected <personality> root, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = {
-    type: "personality",
-    version: node.attrs["version"] ?? "1.0.0",
-  };
-
-  const goesBy = childText(node, "goes-by");
-  if (goesBy !== undefined) fields["goes-by"] = goesBy;
-  const role = childText(node, "role");
-  if (role !== undefined) fields["role"] = role;
-
-  const boxholderEl = firstChild(node, "boxholder");
-  if (boxholderEl !== undefined) {
-    const bh: Record<string, unknown> = {};
-    if (boxholderEl.attrs["ref"] !== undefined) bh["ref"] = boxholderEl.attrs["ref"];
-    const fullName = childText(boxholderEl, "full-name");
-    if (fullName !== undefined) bh["full-name"] = fullName;
-    const called = childText(boxholderEl, "called");
-    if (called !== undefined) bh["called"] = called;
-    const relationships: Array<Record<string, unknown>> = [];
-    for (const r of boxholderEl.children) {
-      if (r.tagName !== "relationship") continue;
-      relationships.push(convertWithEvidence(r));
-    }
-    if (relationships.length > 0) bh["relationships"] = relationships;
-    if (Object.keys(bh).length > 0) fields["boxholder"] = bh;
-  }
-
-  const svEl = firstChild(node, "speaking-voice");
-  if (svEl !== undefined) {
-    const sv: Record<string, unknown> = {};
-    if (svEl.attrs["model"] !== undefined) sv["model"] = svEl.attrs["model"];
-    const instructions: string[] = [];
-    for (const i of svEl.children) {
-      if (i.tagName === "instruction" && i.text !== undefined) instructions.push(i.text);
-    }
-    if (instructions.length > 0) sv["instructions"] = instructions;
-    if (Object.keys(sv).length > 0) fields["speaking-voice"] = sv;
-  }
-
-  const toneEl = firstChild(node, "tone");
-  if (toneEl !== undefined) {
-    const tone: Array<Record<string, unknown>> = [];
-    for (const i of toneEl.children) {
-      if (i.tagName === "instruction") tone.push(convertWithEvidence(i));
-    }
-    if (tone.length > 0) fields["tone"] = tone;
-  }
-
-  const traitsEl = firstChild(node, "traits");
-  let body = "";
-  if (traitsEl !== undefined) {
-    const traits: Array<Record<string, unknown>> = [];
-    for (const t of traitsEl.children) {
-      if (t.tagName === "trait") traits.push(convertWithEvidence(t));
-    }
-    if (traits.length > 0) fields["traits"] = traits;
-    const unresolvedEl = firstChild(traitsEl, "unresolved");
-    if (unresolvedEl !== undefined) {
-      const notes: string[] = [];
-      for (const n of unresolvedEl.children) {
-        if (n.tagName === "note" && n.text !== undefined) notes.push(n.text);
-      }
-      if (notes.length > 0) fields["unresolved"] = notes;
-    }
-    const descEl = firstChild(traitsEl, "description");
-    if (descEl !== undefined && descEl.text !== undefined) {
-      body = descEl.text;
-    }
-  }
-
-  const experimentsEl = firstChild(node, "experiments");
-  if (experimentsEl !== undefined) {
-    const experiments: Array<Record<string, unknown>> = [];
-    for (const e of experimentsEl.children) {
-      if (e.tagName === "experiment") experiments.push(convertExperiment(e));
-    }
-    if (experiments.length > 0) fields["experiments"] = experiments;
-  }
-
-  const contextEl = firstChild(node, "context-notes");
-  if (contextEl !== undefined) {
-    const notes: Array<Record<string, unknown>> = [];
-    for (const c of contextEl.children) {
-      if (c.tagName !== "context") continue;
-      const entry: Record<string, unknown> = { text: c.text ?? "" };
-      if (c.attrs["duration"] !== undefined) entry["duration"] = c.attrs["duration"];
-      if (c.attrs["added-at"] !== undefined) entry["added-at"] = c.attrs["added-at"];
-      notes.push(entry);
-    }
-    if (notes.length > 0) fields["context-notes"] = notes;
-  }
-
-  return { fields, body };
-}
-
-async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
-  const raw = await readFile(absPath, "utf8");
-  // Already frontmatter (or empty/degenerate) — only an XML card starts with "<".
-  if (!raw.trimStart().startsWith("<")) {
-    return "already-migrated";
-  }
-  const node = await parseCard(raw, { source: absPath });
-  checkElement({ node, source: absPath, spec: SPEC, warnings });
-  const { fields, body } = convertOne(node, absPath);
-  const yamlText = stringifyYaml(fields);
-  const bodyTail = body === "" ? "" : `${body}${body.endsWith("\n") ? "" : "\n"}`;
-  await writeFile(absPath, `---\n${yamlText}---\n${bodyTail}`);
-  return "converted";
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxRoot = positional[0];
-  if (boxRoot === undefined) {
-    console.error("Usage: migrate-personality <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const absRoot = resolve(boxRoot);
-  const cards = await findCards(absRoot);
-  console.log(`Found ${String(cards.length)} *.personality.card files under ${absRoot}`);
-  if (!apply) return;
-  let converted = 0;
-  let already = 0;
-  const failed: Array<{ file: string; error: string }> = [];
-  for (const f of cards) {
-    try {
-      const r = await migrateFile(f);
-      if (r === "converted") converted++;
-      else already++;
-    } catch (e) {
-      failed.push({ file: f, error: (e as Error).message });
-    }
-  }
-  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
-  for (const f of failed) {
-    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
-  }
-  warnings.dump(absRoot);
-  if (failed.length > 0) process.exit(2);
-}
-
-main().catch((e) => {
-  console.error(e);
-  process.exit(1);
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/procedure-run.ts b/callback-box/scripts/migrate/procedure-run.ts
index d3dcbe15..9d9dfe60 100644
--- a/callback-box/scripts/migrate/procedure-run.ts
+++ b/callback-box/scripts/migrate/procedure-run.ts
@@ -1,124 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Migrate `run.procedure-run.card` files from the XML body format to
- * Phase-2 frontmatter (pure YAML, no body).
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Run cards are a transient cache (gc deletes them; git history is the
- * archive), so this is mostly for tidiness — unmigrated run cards age out
- * on their own.
- *
- * Usage:
- *   pnpm exec tsx scripts/migrate/procedure-run.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/procedure-run.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, writeFile } from "node:fs/promises";
-import { parseCard, splitCardContent, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { runMigration } from "./_harness.js";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const PHASE_RESULT: ElementSpec = {
-  attrs: [],
-  children: {
-    stdout: { attrs: [] },
-    "session-id": { attrs: [] },
-    "git-ref": { attrs: [] },
-    review: { attrs: [] },
-  },
-};
-
-const SPEC: ElementSpec = {
-  attrs: ["procedure", "status", "started-at", "completed-at", "directive", "expires"],
-  children: {
-    step: {
-      attrs: ["id", "status", "started-at", "completed-at"],
-      children: {
-        precheck: { attrs: ["status"], children: PHASE_RESULT.children },
-        run: { attrs: [], children: PHASE_RESULT.children },
-        validate: { attrs: ["status"], children: PHASE_RESULT.children },
-      },
-    },
-  },
-};
-
-function text(el: ElementNode): string {
-  return typeof el.text === "string" ? el.text.trim() : "";
-}
-
-function childText(el: ElementNode, tag: string): string | undefined {
-  const found = el.children.find((c) => c.tagName === tag);
-  if (found === undefined) return undefined;
-  const t = text(found);
-  return t === "" ? undefined : t;
-}
-
-function copyAttr(from: ElementNode, name: string, into: Record<string, unknown>, key: string): void {
-  const v = from.attrs[name];
-  if (typeof v === "string" && v !== "") into[key] = v;
-}
-
-function convertPhase(phase: ElementNode | undefined, kind: "precheck" | "run" | "validate"): Record<string, unknown> | undefined {
-  if (phase === undefined) return undefined;
-  const out: Record<string, unknown> = {};
-  if (kind !== "run") copyAttr(phase, "status", out, "status");
-  const stdout = childText(phase, "stdout");
-  if (stdout !== undefined) out.stdout = stdout;
-  if (kind === "run") {
-    const sessionId = childText(phase, "session-id");
-    if (sessionId !== undefined) out["session-id"] = sessionId;
-    const gitRef = childText(phase, "git-ref");
-    if (gitRef !== undefined) out["git-ref"] = gitRef;
-  }
-  if (kind === "validate") {
-    const review = childText(phase, "review");
-    if (review !== undefined) out.review = review;
-  }
-  return out;
-}
-
-function convertStep(step: ElementNode): Record<string, unknown> {
-  const out: Record<string, unknown> = {};
-  copyAttr(step, "id", out, "id");
-  copyAttr(step, "status", out, "status");
-  copyAttr(step, "started-at", out, "started-at");
-  copyAttr(step, "completed-at", out, "completed-at");
-  const precheck = convertPhase(step.children.find((c) => c.tagName === "precheck"), "precheck");
-  if (precheck !== undefined) out.precheck = precheck;
-  const run = convertPhase(step.children.find((c) => c.tagName === "run"), "run");
-  if (run !== undefined) out.run = run;
-  const validate = convertPhase(step.children.find((c) => c.tagName === "validate"), "validate");
-  if (validate !== undefined) out.validate = validate;
-  return out;
-}
-
-await runMigration({
-  description: "Convert run.procedure-run.card XML body → frontmatter (pure YAML).",
-  match: (name) => name === "run.procedure-run.card",
-  convert: async (absPath, { warnings, apply }) => {
-    const content = await readFile(absPath, "utf-8");
-    const split = splitCardContent(content);
-    const isXml = /(^|\n)content-type:\s*application\/x-card\+xml/.test(split.frontmatterText);
-    if (split.hasFrontmatter && !isXml) return "already";
-
-    const root = await parseCard(content, { source: absPath });
-    if (root.tagName !== "procedure-run") {
-      throw new Error(`expected <procedure-run> root, got <${root.tagName}>`);
-    }
-    checkElement({ node: root, source: absPath, spec: SPEC, warnings });
-
-    const fields: Record<string, unknown> = {};
-    copyAttr(root, "procedure", fields, "procedure");
-    copyAttr(root, "status", fields, "status");
-    copyAttr(root, "started-at", fields, "started-at");
-    copyAttr(root, "completed-at", fields, "completed-at");
-    copyAttr(root, "directive", fields, "directive");
-    copyAttr(root, "expires", fields, "expires");
-    fields.steps = root.children.filter((c) => c.tagName === "step").map(convertStep);
-
-    const out = `---\n${stringifyYaml(fields)}---\n`;
-    if (apply) await writeFile(absPath, out, "utf-8");
-    return "converted";
-  },
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/procedure.ts b/callback-box/scripts/migrate/procedure.ts
index 409943d4..9d9dfe60 100644
--- a/callback-box/scripts/migrate/procedure.ts
+++ b/callback-box/scripts/migrate/procedure.ts
@@ -1,142 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Migrate `.procedure.card` definition files from the XML body format to
- * Phase-2 frontmatter (pure YAML, no body).
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Each phase (precheck/run/validate) groups its children by kind into
- * `shells` / `agents` / `instructions` / `whys` lists — matching how the
- * engine already consumes them. Multi-line shell scripts and agent prompts
- * become YAML block scalars.
- *
- * Usage:
- *   pnpm exec tsx scripts/migrate/procedure.ts <root>           # dry-run
- *   pnpm exec tsx scripts/migrate/procedure.ts <root> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, writeFile } from "node:fs/promises";
-import { parseCard, splitCardContent, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { dedent } from "../../src/core/procedure/dedent.js";
-import { runMigration } from "./_harness.js";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const PHASE: ElementSpec = {
-  attrs: [],
-  children: {
-    shell: { attrs: [] },
-    agent: { attrs: ["model", "max-turns"] },
-    instruction: { attrs: [] },
-    why: { attrs: [] },
-  },
-};
-
-const SPEC: ElementSpec = {
-  attrs: ["name", "run-expiry", "failed-run-expiry"],
-  children: {
-    description: { attrs: [] },
-    step: {
-      attrs: ["id"],
-      children: {
-        description: { attrs: [] },
-        precheck: { attrs: ["pass-output"], children: PHASE.children },
-        run: { attrs: [], children: PHASE.children },
-        validate: { attrs: ["severity"], children: PHASE.children },
-      },
-    },
-  },
-};
-
-function dtext(el: ElementNode): string {
-  return dedent(typeof el.text === "string" ? el.text : "");
-}
-
-function child(el: ElementNode, tag: string): ElementNode | undefined {
-  return el.children.find((c) => c.tagName === tag);
-}
-
-function convertPhase(phase: ElementNode): Record<string, unknown> {
-  const shells: string[] = [];
-  const agents: Record<string, unknown>[] = [];
-  const instructions: string[] = [];
-  const whys: string[] = [];
-  for (const c of phase.children) {
-    if (c.tagName === "shell") shells.push(dtext(c));
-    else if (c.tagName === "instruction") instructions.push(dtext(c));
-    else if (c.tagName === "why") whys.push(dtext(c));
-    else if (c.tagName === "agent") {
-      const agent: Record<string, unknown> = { prompt: dtext(c) };
-      const model = c.attrs["model"];
-      if (typeof model === "string" && model !== "") agent.model = model;
-      const maxTurns = c.attrs["max-turns"];
-      if (typeof maxTurns === "string" && maxTurns !== "") agent["max-turns"] = Number(maxTurns);
-      agents.push(agent);
-    }
-  }
-  const out: Record<string, unknown> = {};
-  if (shells.length > 0) out.shells = shells;
-  if (agents.length > 0) out.agents = agents;
-  if (instructions.length > 0) out.instructions = instructions;
-  if (whys.length > 0) out.whys = whys;
-  return out;
-}
-
-function convertStep(step: ElementNode): Record<string, unknown> {
-  const out: Record<string, unknown> = { id: step.attrs["id"] ?? "unknown" };
-  const desc = child(step, "description");
-  if (desc && dtext(desc) !== "") out.description = dtext(desc);
-
-  const precheck = child(step, "precheck");
-  if (precheck) {
-    const p = convertPhase(precheck);
-    // pass-output belongs on the precheck. Some templates misplaced it on a
-    // child <shell> (where the engine ignored it) — honor the clear intent
-    // by hoisting it up.
-    const onPrecheck = precheck.attrs["pass-output"] === "true";
-    const onShell = precheck.children.some(
-      (c) => c.tagName === "shell" && c.attrs["pass-output"] === "true",
-    );
-    if (onPrecheck || onShell) p["pass-output"] = true;
-    out.precheck = p;
-  }
-  const run = child(step, "run");
-  if (run) out.run = convertPhase(run);
-  const validate = child(step, "validate");
-  if (validate) {
-    const v = convertPhase(validate);
-    const severity = validate.attrs["severity"];
-    if (typeof severity === "string" && severity !== "" && severity !== "warn") v.severity = severity;
-    out.validate = v;
-  }
-  return out;
-}
-
-await runMigration({
-  description: "Convert *.procedure.card XML body → frontmatter (pure YAML).",
-  match: (name) => name.endsWith(".procedure.card"),
-  convert: async (absPath, { warnings, apply }) => {
-    const content = await readFile(absPath, "utf-8");
-    const split = splitCardContent(content);
-    const isXml = /(^|\n)content-type:\s*application\/x-card\+xml/.test(split.frontmatterText);
-    if (split.hasFrontmatter && !isXml) return "already";
-
-    const root = await parseCard(content, { source: absPath });
-    if (root.tagName !== "procedure") {
-      throw new Error(`expected <procedure> root, got <${root.tagName}>`);
-    }
-    checkElement({ node: root, source: absPath, spec: SPEC, warnings });
-
-    const fields: Record<string, unknown> = { name: root.attrs["name"] ?? "unknown" };
-    const desc = child(root, "description");
-    if (desc && dtext(desc) !== "") fields.description = dtext(desc);
-    const runExpiry = root.attrs["run-expiry"];
-    if (typeof runExpiry === "string" && runExpiry !== "") fields["run-expiry"] = runExpiry;
-    const failedExpiry = root.attrs["failed-run-expiry"];
-    if (typeof failedExpiry === "string" && failedExpiry !== "") fields["failed-run-expiry"] = failedExpiry;
-    fields.steps = root.children.filter((c) => c.tagName === "step").map(convertStep);
-
-    const out = `---\n${stringifyYaml(fields)}---\n`;
-    if (apply) await writeFile(absPath, out, "utf-8");
-    return "converted";
-  },
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/question.ts b/callback-box/scripts/migrate/question.ts
index 53b3f076..9d9dfe60 100644
--- a/callback-box/scripts/migrate/question.ts
+++ b/callback-box/scripts/migrate/question.ts
@@ -1,202 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Phase 2: migrate `.question.card` files from XML to YAML frontmatter.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Usage:
- *   pnpm exec tsx scripts/migrate/question.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/question.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, readdir, writeFile } from "node:fs/promises";
-import { join, relative, resolve } from "node:path";
-import { parseCard, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-
-const KNOWN_ATTRS = new Set(["status", "answered-by"]);
-const KNOWN_CHILDREN = new Set([
-  "memo", "prompt", "input", "directive", "context",
-  "answer", "answered-at", "answered-via",
-]);
-const KNOWN_INPUT_ATTRS = new Set(["type"]);
-const KNOWN_INPUT_CHILDREN = new Set(["option"]);
-
-interface Warning { file: string; message: string }
-const warnings: Warning[] = [];
-
-function checkUnknown(node: ElementNode, source: string): void {
-  for (const attr of Object.keys(node.attrs)) {
-    if (!KNOWN_ATTRS.has(attr)) {
-      warnings.push({ file: source, message: `unknown attr on <question>: ${attr}="${String(node.attrs[attr])}"` });
-    }
-  }
-  for (const child of node.children) {
-    if (!KNOWN_CHILDREN.has(child.tagName)) {
-      warnings.push({ file: source, message: `unknown child element: <${child.tagName}>` });
-      continue;
-    }
-    if (child.tagName === "input") {
-      for (const a of Object.keys(child.attrs)) {
-        if (!KNOWN_INPUT_ATTRS.has(a)) {
-          warnings.push({ file: source, message: `unknown attr on <input>: ${a}` });
-        }
-      }
-      for (const sub of child.children) {
-        if (!KNOWN_INPUT_CHILDREN.has(sub.tagName)) {
-          warnings.push({ file: source, message: `unknown <input> child: <${sub.tagName}>` });
-        }
-      }
-    }
-  }
-}
-
-async function findCards(root: string): Promise<string[]> {
-  const out: string[] = [];
-  async function walk(dir: string): Promise<void> {
-    let entries;
-    try {
-      entries = await readdir(dir, { withFileTypes: true });
-    } catch (e) {
-      const err = e as NodeJS.ErrnoException;
-      if (err.code === "ENOENT") return;
-      throw e;
-    }
-    for (const entry of entries) {
-      if (entry.name === ".git" || entry.name === "node_modules") continue;
-      const full = join(dir, entry.name);
-      if (entry.isDirectory()) {
-        await walk(full);
-      } else if (entry.isFile() && entry.name.endsWith(".question.card")) {
-        out.push(full);
-      }
-    }
-  }
-  await walk(root);
-  return out;
-}
-
-function childText(node: ElementNode, tagName: string): string | undefined {
-  const c = node.children.find((c) => c.tagName === tagName);
-  if (c === undefined) return undefined;
-  const t = c.text;
-  return t === undefined || t === "" ? undefined : t;
-}
-
-function convertOne(node: ElementNode, source: string): Record<string, unknown> {
-  if (node.tagName !== "question") {
-    throw new Error(`${source}: expected <question>, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = { type: "question" };
-
-  fields["status"] = node.attrs["status"] ?? "pending";
-  if (node.attrs["answered-by"] !== undefined) {
-    fields["answered-by"] = node.attrs["answered-by"];
-  }
-
-  const memo = childText(node, "memo");
-  if (memo !== undefined) fields["memo"] = memo;
-
-  const prompt = childText(node, "prompt");
-  if (prompt !== undefined) fields["prompt"] = prompt;
-
-  const inputEl = node.children.find((c) => c.tagName === "input");
-  if (inputEl !== undefined) {
-    const input: Record<string, unknown> = {
-      type: inputEl.attrs["type"] ?? "text",
-    };
-    const options = inputEl.children
-      .filter((c) => c.tagName === "option")
-      .map((c) => ({
-        id: c.attrs["id"] ?? "",
-        label: c.text ?? "",
-      }));
-    if (options.length > 0) input["options"] = options;
-    fields["input"] = input;
-  } else {
-    fields["input"] = { type: "text" };
-  }
-
-  const directive = childText(node, "directive");
-  if (directive !== undefined) fields["directive"] = directive;
-
-  const contexts = node.children.filter((c) => c.tagName === "context");
-  if (contexts.length > 0) {
-    fields["context"] = contexts.map((c) => {
-      const entry: Record<string, unknown> = { ref: c.attrs["ref"] ?? "" };
-      if (c.text !== undefined && c.text !== "") entry["text"] = c.text;
-      return entry;
-    });
-  }
-
-  const answerEl = node.children.find((c) => c.tagName === "answer");
-  if (answerEl !== undefined) {
-    const answer: Record<string, unknown> = {};
-    if (answerEl.text !== undefined && answerEl.text !== "") answer["text"] = answerEl.text;
-    if (answerEl.attrs["selected"] !== undefined) answer["selected"] = answerEl.attrs["selected"];
-    if (Object.keys(answer).length > 0) fields["answer"] = answer;
-  }
-
-  const answeredAt = childText(node, "answered-at");
-  if (answeredAt !== undefined) fields["answered-at"] = answeredAt;
-
-  const answeredVia = childText(node, "answered-via");
-  if (answeredVia !== undefined) fields["answered-via"] = answeredVia;
-
-  return fields;
-}
-
-async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
-  const raw = await readFile(absPath, "utf8");
-  // Already frontmatter (or empty/degenerate) — only an XML card starts with "<".
-  if (!raw.trimStart().startsWith("<")) {
-    return "already-migrated";
-  }
-  const node = await parseCard(raw, { source: absPath });
-  checkUnknown(node, absPath);
-  const fields = convertOne(node, absPath);
-  await writeFile(absPath, `---\n${stringifyYaml(fields)}---\n`);
-  return "converted";
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxRoot = positional[0];
-  if (boxRoot === undefined) {
-    console.error("Usage: migrate-question <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const absRoot = resolve(boxRoot);
-  const cards = await findCards(absRoot);
-  console.log(`Found ${String(cards.length)} *.question.card files under ${absRoot}`);
-  if (!apply) return;
-  let converted = 0;
-  let already = 0;
-  const failed: Array<{ file: string; error: string }> = [];
-  for (const f of cards) {
-    try {
-      const r = await migrateFile(f);
-      if (r === "converted") converted++;
-      else already++;
-    } catch (e) {
-      failed.push({ file: f, error: (e as Error).message });
-    }
-  }
-  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
-  for (const f of failed) {
-    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
-  }
-  if (warnings.length > 0) {
-    console.log(`\n${String(warnings.length)} warning(s) about unrecognized fields:`);
-    for (const w of warnings) {
-      console.log(`  ${relative(absRoot, w.file)}: ${w.message}`);
-    }
-  }
-  if (failed.length > 0) process.exit(2);
-}
-
-main().catch((e) => {
-  console.error(e);
-  process.exit(1);
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/recipe.ts b/callback-box/scripts/migrate/recipe.ts
index 013598ff..9d9dfe60 100644
--- a/callback-box/scripts/migrate/recipe.ts
+++ b/callback-box/scripts/migrate/recipe.ts
@@ -1,174 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Migrate `.recipe.card` files from the XML body format to Phase-2
- * frontmatter + Markdoc-annotated body.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Old (XML):
- *   <recipe>
- *     <title>Classic Beef Stew</title>
- *     <yield amount="6">6 servings</yield>
- *     <notes>- Source: …\n- Prep Time: …</notes>
- *     <section>
- *       <ingredients><ing amount="2" unit="lbs">beef chuck</ing>…</ingredients>
- *       <steps><step>Season the beef…</step>…</steps>
- *     </section>
- *   </recipe>
- *
- * New (frontmatter + Markdoc body):
- *   ---
- *   title: Classic Beef Stew
- *   source: https://example.com/…       # lifted from a "Source:" note, if present
- *   ---
- *   {% yield amount="6" %}6 servings{% /yield %}
- *
- *   ## Ingredients
- *   - {% ingredient amount="2" unit="lbs" %}beef chuck{% /ingredient %}
- *
- *   ## Steps
- *   {% step %}Season the beef…{% /step %}
- *
- *   ## Notes
- *   - Prep Time: …
- *
- * Usage:
- *   pnpm exec tsx scripts/migrate/recipe.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/recipe.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, writeFile } from "node:fs/promises";
-import { parseCard, splitCardContent, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { runMigration } from "./_harness.js";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const SPEC: ElementSpec = {
-  attrs: [],
-  children: {
-    title: { attrs: [] },
-    description: { attrs: [] },
-    source: { attrs: [] },
-    yield: { attrs: ["amount", "unit"] },
-    notes: { attrs: [] },
-    section: {
-      attrs: ["name"],
-      children: {
-        ingredients: { attrs: [], children: { ing: { attrs: ["amount", "unit"] } } },
-        steps: { attrs: [], children: { step: { attrs: [] } } },
-      },
-    },
-  },
-};
-
-function text(el: ElementNode): string {
-  return typeof el.text === "string" ? el.text.trim() : "";
-}
-
-function child(el: ElementNode, tag: string): ElementNode | undefined {
-  return el.children.find((c) => c.tagName === tag);
-}
-
-function attrPart(el: ElementNode, name: string): string {
-  const v = el.attrs[name];
-  if (typeof v !== "string" || v === "") return "";
-  return ` ${name}="${v}"`;
-}
-
-function ingredientTag(ing: ElementNode): string {
-  const attrs = `${attrPart(ing, "amount")}${attrPart(ing, "unit")}`;
-  return `- {% ingredient${attrs} %}${text(ing)}{% /ingredient %}`;
-}
-
-function sectionBody(section: ElementNode): string {
-  const lines: string[] = [];
-  const name = section.attrs["name"];
-  if (typeof name === "string" && name !== "") lines.push(`{% recipe-section name="${name}" %}`, "");
-
-  const ingredients = child(section, "ingredients");
-  if (ingredients) {
-    lines.push("## Ingredients", "");
-    for (const ing of ingredients.children) {
-      if (ing.tagName === "ing") lines.push(ingredientTag(ing));
-    }
-    lines.push("");
-  }
-
-  const steps = child(section, "steps");
-  if (steps) {
-    lines.push("## Steps", "");
-    for (const step of steps.children) {
-      if (step.tagName === "step") lines.push(`{% step %}${text(step)}{% /step %}`, "");
-    }
-  }
-
-  if (typeof name === "string" && name !== "") lines.push("{% /recipe-section %}", "");
-  return lines.join("\n");
-}
-
-const SOURCE_NOTE_RE = /^-?\s*source:\s*(.+)$/i;
-
-/** Split notes into a possible source value and the remaining note lines. */
-function splitNotes(notesText: string): { source: string | undefined; rest: string } {
-  let source: string | undefined;
-  const kept: string[] = [];
-  for (const line of notesText.split("\n")) {
-    const m = SOURCE_NOTE_RE.exec(line.trim());
-    if (m && source === undefined) {
-      source = m[1].trim();
-      continue;
-    }
-    kept.push(line);
-  }
-  return { source, rest: kept.join("\n").trim() };
-}
-
-await runMigration({
-  description: "Convert *.recipe.card XML body → frontmatter + Markdoc body.",
-  match: (name) => name.endsWith(".recipe.card"),
-  convert: async (absPath, { warnings, apply }) => {
-    const content = await readFile(absPath, "utf-8");
-    const split = splitCardContent(content);
-    const isXml = /(^|\n)content-type:\s*application\/x-card\+xml/.test(split.frontmatterText);
-    if (split.hasFrontmatter && !isXml) return "already";
-
-    const root = await parseCard(content, { source: absPath });
-    if (root.tagName !== "recipe") {
-      throw new Error(`expected <recipe> root, got <${root.tagName}>`);
-    }
-    checkElement({ node: root, source: absPath, spec: SPEC, warnings });
-
-    const titleEl = child(root, "title");
-    if (titleEl === undefined || text(titleEl) === "") {
-      throw new Error("recipe is missing <title>");
-    }
-    const fields: Record<string, unknown> = { title: text(titleEl) };
-
-    const descEl = child(root, "description");
-    if (descEl && text(descEl) !== "") fields.description = text(descEl);
-    const sourceEl = child(root, "source");
-    if (sourceEl && text(sourceEl) !== "") fields.source = text(sourceEl);
-
-    const bodyParts: string[] = [];
-
-    const yieldEl = child(root, "yield");
-    if (yieldEl) {
-      bodyParts.push(`{% yield${attrPart(yieldEl, "amount")} %}${text(yieldEl)}{% /yield %}`, "");
-    }
-
-    for (const section of root.children) {
-      if (section.tagName === "section") bodyParts.push(sectionBody(section));
-    }
-
-    const notesEl = child(root, "notes");
-    if (notesEl && text(notesEl) !== "") {
-      const { source, rest } = splitNotes(text(notesEl));
-      if (source !== undefined && fields.source === undefined) fields.source = source;
-      if (rest !== "") bodyParts.push("## Notes", "", rest, "");
-    }
-
-    const body = bodyParts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
-    const out = `---\n${stringifyYaml(fields)}---\n${body}\n`;
-    if (apply) await writeFile(absPath, out, "utf-8");
-    return "converted";
-  },
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/record-person.ts b/callback-box/scripts/migrate/record-person.ts
index 0a1fda88..9d9dfe60 100644
--- a/callback-box/scripts/migrate/record-person.ts
+++ b/callback-box/scripts/migrate/record-person.ts
@@ -1,281 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Phase 2 (per-schema): migrate `.record.card` and `.person.card` files
- * from Phase 1 frontmatter-with-XML-body to flat frontmatter + markdown
- * body.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Usage:
- *   pnpm exec tsx scripts/migrate/record-person.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/record-person.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, readdir, writeFile } from "node:fs/promises";
-import { join, relative, resolve } from "node:path";
-import { parseCard, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const RECORD_SPEC: ElementSpec = {
-  attrs: ["status", "version"],
-  children: {
-    name: { attrs: [] },
-    description: { attrs: [] },
-    sources: {
-      attrs: [],
-      children: { source: { attrs: ["ref", "time"] } },
-    },
-    date: { attrs: ["value"] },
-    person: { attrs: ["name", "ref", "role", "notes"] },
-    location: { attrs: ["ref"] },
-    measure: { attrs: ["value"] },
-    language: { attrs: [] },
-    triage: { attrs: [] },
-    notes: { attrs: [] },
-    content: { attrs: [] },
-  },
-};
-
-const PERSON_SPEC: ElementSpec = {
-  attrs: ["status", "version"],
-  children: {
-    name: { attrs: [] },
-    called: { attrs: [] },
-    role: { attrs: [] },
-    contact: { attrs: [] },
-    notes: { attrs: [] },
-  },
-};
-
-const warnings = new WarningCollector();
-
-async function findCards(root: string, suffix: string): Promise<string[]> {
-  const out: string[] = [];
-  async function walk(dir: string): Promise<void> {
-    let entries;
-    try {
-      entries = await readdir(dir, { withFileTypes: true });
-    } catch (e) {
-      const err = e as NodeJS.ErrnoException;
-      if (err.code === "ENOENT") return;
-      throw e;
-    }
-    for (const entry of entries) {
-      if (entry.name === ".git" || entry.name === "node_modules") continue;
-      const full = join(dir, entry.name);
-      if (entry.isDirectory()) {
-        await walk(full);
-      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
-        out.push(full);
-      }
-    }
-  }
-  await walk(root);
-  return out;
-}
-
-function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
-  return node.children.find((c) => c.tagName === tagName);
-}
-
-function childText(node: ElementNode, tagName: string): string | undefined {
-  const c = firstChild(node, tagName);
-  if (c === undefined) return undefined;
-  const t = c.text;
-  return t === undefined || t === "" ? undefined : t;
-}
-
-function convertRecord(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
-  if (node.tagName !== "record") {
-    throw new Error(`${source}: expected <record> root, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = {
-    type: "record",
-    status: node.attrs["status"] ?? "draft",
-  };
-  const name = childText(node, "name");
-  if (name === undefined) throw new Error(`${source}: missing <name>`);
-  fields["name"] = name;
-
-  const description = childText(node, "description");
-  if (description !== undefined) fields["description"] = description;
-
-  // sources
-  const sourcesEl = firstChild(node, "sources");
-  if (sourcesEl !== undefined && sourcesEl.children.length > 0) {
-    const list: Array<Record<string, unknown>> = [];
-    for (const s of sourcesEl.children) {
-      if (s.tagName !== "source") continue;
-      const ref = s.attrs["ref"];
-      if (ref === undefined) continue;
-      const entry: Record<string, unknown> = { ref };
-      if (s.attrs["time"] !== undefined) entry["time"] = s.attrs["time"];
-      if (s.text !== undefined && s.text !== "") entry["note"] = s.text;
-      list.push(entry);
-    }
-    if (list.length > 0) fields["sources"] = list;
-  }
-
-  // dates (multiple)
-  const dates: Array<Record<string, unknown>> = [];
-  for (const c of node.children) {
-    if (c.tagName !== "date") continue;
-    const value = c.attrs["value"];
-    if (value === undefined) continue;
-    const entry: Record<string, unknown> = { value };
-    if (c.text !== undefined && c.text !== "") entry["note"] = c.text;
-    dates.push(entry);
-  }
-  if (dates.length > 0) fields["dates"] = dates;
-
-  // persons
-  const persons: Array<Record<string, unknown>> = [];
-  for (const c of node.children) {
-    if (c.tagName !== "person") continue;
-    const personName = c.attrs["name"];
-    if (personName === undefined) continue;
-    const entry: Record<string, unknown> = { name: personName };
-    if (c.attrs["ref"] !== undefined) entry["ref"] = c.attrs["ref"];
-    if (c.attrs["role"] !== undefined) entry["role"] = c.attrs["role"];
-    if (c.attrs["notes"] !== undefined) entry["notes"] = c.attrs["notes"];
-    if (c.text !== undefined && c.text !== "") entry["note"] = c.text;
-    persons.push(entry);
-  }
-  if (persons.length > 0) fields["persons"] = persons;
-
-  // location
-  const locationEl = firstChild(node, "location");
-  if (locationEl !== undefined) {
-    const loc: Record<string, unknown> = {};
-    if (locationEl.attrs["ref"] !== undefined) loc["ref"] = locationEl.attrs["ref"];
-    if (locationEl.text !== undefined && locationEl.text !== "") loc["text"] = locationEl.text;
-    if (Object.keys(loc).length > 0) fields["location"] = loc;
-  }
-
-  // measures
-  const measures: Array<Record<string, unknown>> = [];
-  for (const c of node.children) {
-    if (c.tagName !== "measure") continue;
-    const value = c.attrs["value"];
-    if (value === undefined) continue;
-    const entry: Record<string, unknown> = { value };
-    if (c.text !== undefined && c.text !== "") entry["note"] = c.text;
-    measures.push(entry);
-  }
-  if (measures.length > 0) fields["measures"] = measures;
-
-  const language = childText(node, "language");
-  if (language !== undefined) fields["language"] = language;
-
-  const triage = childText(node, "triage");
-  if (triage !== undefined) fields["triage"] = triage;
-
-  const notes = childText(node, "notes");
-  if (notes !== undefined) fields["notes"] = notes;
-
-  const contentText = childText(node, "content");
-  const body = contentText === undefined ? "" : contentText;
-
-  return { fields, body };
-}
-
-function convertPerson(node: ElementNode, source: string): { fields: Record<string, unknown>; body: string } {
-  if (node.tagName !== "person") {
-    throw new Error(`${source}: expected <person> root, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = {
-    type: "person",
-    status: node.attrs["status"] ?? "active",
-  };
-  const name = childText(node, "name");
-  if (name === undefined) throw new Error(`${source}: missing <name>`);
-  fields["name"] = name;
-
-  const calleds: string[] = [];
-  for (const c of node.children) {
-    if (c.tagName !== "called") continue;
-    if (c.text !== undefined && c.text !== "") calleds.push(c.text);
-  }
-  if (calleds.length > 0) fields["called"] = calleds;
-
-  const role = childText(node, "role");
-  if (role !== undefined) fields["role"] = role;
-
-  const contact = childText(node, "contact");
-  if (contact !== undefined) fields["contact"] = contact;
-
-  const notes = childText(node, "notes");
-  const body = notes === undefined ? "" : notes;
-
-  return { fields, body };
-}
-
-async function migrateFile(
-  absPath: string,
-  kind: "record" | "person"
-): Promise<"converted" | "already-migrated"> {
-  const raw = await readFile(absPath, "utf8");
-  // Already frontmatter (or empty/degenerate) — only an XML card starts with "<".
-  if (!raw.trimStart().startsWith("<")) return "already-migrated";
-  const node = await parseCard(raw, { source: absPath });
-  checkElement({ node, source: absPath, spec: kind === "record" ? RECORD_SPEC : PERSON_SPEC, warnings });
-  const { fields, body } = kind === "record"
-    ? convertRecord(node, absPath)
-    : convertPerson(node, absPath);
-  const yamlText = stringifyYaml(fields);
-  const bodyTail = body === "" ? "" : `${body}${body.endsWith("\n") ? "" : "\n"}`;
-  await writeFile(absPath, `---\n${yamlText}---\n${bodyTail}`);
-  return "converted";
-}
-
-async function migrateKind(input: {
-  absRoot: string;
-  kind: "record" | "person";
-  apply: boolean;
-}): Promise<void> {
-  const { absRoot, kind, apply } = input;
-  const suffix = `.${kind}.card`;
-  const cards = await findCards(absRoot, suffix);
-  console.log(`Found ${String(cards.length)} *${suffix} files under ${absRoot}`);
-  if (!apply) {
-    console.log(`Dry run for ${kind}. Pass --apply to convert.`);
-    return;
-  }
-  let converted = 0;
-  let already = 0;
-  const failed: Array<{ file: string; error: string }> = [];
-  for (const f of cards) {
-    try {
-      const r = await migrateFile(f, kind);
-      if (r === "converted") converted++;
-      else already++;
-    } catch (e) {
-      failed.push({ file: f, error: (e as Error).message });
-    }
-  }
-  console.log(`${kind}: converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
-  for (const f of failed) {
-    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
-  }
-  if (failed.length > 0) process.exit(2);
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxRoot = positional[0];
-  if (boxRoot === undefined) {
-    console.error("Usage: migrate-record-person <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const absRoot = resolve(boxRoot);
-  await migrateKind({ absRoot, kind: "record", apply });
-  await migrateKind({ absRoot, kind: "person", apply });
-  warnings.dump(absRoot);
-}
-
-main().catch((e) => {
-  console.error(e);
-  process.exit(1);
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/repair-refs.ts b/callback-box/scripts/migrate/repair-refs.ts
index 40cbfd4f..9d9dfe60 100644
--- a/callback-box/scripts/migrate/repair-refs.ts
+++ b/callback-box/scripts/migrate/repair-refs.ts
@@ -1,350 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Repair broken refs in a box by locating files of matching basename
- * elsewhere in the box.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * For each broken ref discovered via cardworks `extractRefs`:
- *   - Index every file in the box by basename.
- *   - Look up the missing ref's basename.
- *   - 0 candidates -> report "missing".
- *   - 1 candidate -> apply the fix.
- *   - N candidates -> prefer the one closest to the source card by path
- *     distance (siblings beat cousins). If two tie for closest, report
- *     "ambiguous" with the candidate list.
- *
- * Fix shape depends on ref form:
- *   - `attach/<name>`: move the file into the source card's
- *     `<stem>.attach/` scope (create the dir if needed).
- *   - everything else: rewrite the ref to an absolute `/from/box/root`
- *     path pointing at the actual file.
- *
- * Final report groups results into fixed / missing / ambiguous / errors.
- *
- * Idempotent. Default dry-run; pass `--apply` to mutate.
- *
- * Usage:
- *   pnpm exec tsx scripts/migrate/repair-refs.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/repair-refs.ts <boxRoot> --apply
- */
-
-import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
-import { basename, dirname, join, relative, resolve, sep } from "node:path";
-import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
-import { extractRefs, splitCardContent } from "cardworks";
-
-interface RepairOutcome {
-  card: string;
-  refPath: string;
-  ref: string;
-  kind: "fix-rewrite" | "fix-move-attach" | "missing" | "ambiguous" | "error";
-  detail: string;
-}
-
-const outcomes: RepairOutcome[] = [];
-
-async function pathExists(p: string): Promise<boolean> {
-  try { await stat(p); return true; } catch { return false; }
-}
-
-async function walkAllFiles(dir: string, out: string[]): Promise<void> {
-  let entries;
-  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
-  for (const e of entries) {
-    if (e.name === ".git" || e.name === "node_modules") continue;
-    const full = join(dir, e.name);
-    if (e.isDirectory()) await walkAllFiles(full, out);
-    else if (e.isFile()) out.push(full);
-  }
-}
-
-function isCardFile(name: string): boolean { return name.endsWith(".card"); }
-
-function cardStem(cardAbs: string): string {
-  return basename(cardAbs).replace(/\.card$/, "").replace(/\.[^.]+$/, "");
-}
-
-interface RefCtx { boxRoot: string; sourceCardAbs: string }
-
-function resolveRefPath(ctx: RefCtx, ref: string): string {
-  const { boxRoot, sourceCardAbs } = ctx;
-  if (ref.startsWith("/")) return join(boxRoot, ref.slice(1));
-  if (ref === "attach" || ref.startsWith("attach/")) {
-    const attachDir = join(dirname(sourceCardAbs), `${cardStem(sourceCardAbs)}.attach`);
-    const rest = ref === "attach" ? "" : ref.slice("attach/".length);
-    return rest === "" ? attachDir : join(attachDir, rest);
-  }
-  return join(dirname(sourceCardAbs), ref);
-}
-
-/**
- * Path distance between two absolute paths: number of segments that
- * differ after the common prefix (sum from both sides). Same dir = 0.
- */
-function pathDistance(a: string, b: string): number {
-  const as = a.split(sep);
-  const bs = b.split(sep);
-  let i = 0;
-  while (i < as.length && i < bs.length && as[i] === bs[i]) i++;
-  return (as.length - i) + (bs.length - i);
-}
-
-/**
- * How many trailing segments of `ref` (split on `/`) match the tail of
- * `candidatePath`, treating a `.attach` suffix on candidate segments as
- * equivalent to its stem. The basename itself is always one match.
- */
-function refTailMatch(ref: string, candidatePath: string): number {
-  const refSegs = ref.split("/").filter((s) => s !== "" && s !== ".");
-  const candSegs = candidatePath.split(sep);
-  let matches = 0;
-  for (let i = 1; i <= refSegs.length && i <= candSegs.length; i++) {
-    const r = refSegs[refSegs.length - i];
-    const c = candSegs[candSegs.length - i].replace(/\.attach$/, "");
-    if (r === c || r.replace(/\.attach$/, "") === c) matches = i;
-    else break;
-  }
-  return matches;
-}
-
-function pickBestCandidate(
-  candidates: string[],
-  sourceCardAbs: string,
-  ref: string,
-): { winner: string | null; tied: string[] } {
-  if (candidates.length === 1) return { winner: candidates[0], tied: [] };
-  // Primary: longest tail match with the ref (captures dir hints in the
-  // ref like `ledger/Sheet1.json`). Secondary: path distance to
-  // the source card (siblings beat cousins).
-  const scored = candidates
-    .map((p) => ({
-      path: p,
-      tail: refTailMatch(ref, p),
-      dist: pathDistance(p, sourceCardAbs),
-    }))
-    .sort((a, b) => (b.tail - a.tail) || (a.dist - b.dist));
-  const best = scored[0];
-  const tied = scored.filter((s) => s.tail === best.tail && s.dist === best.dist);
-  if (tied.length === 1) return { winner: best.path, tied: [] };
-  return { winner: null, tied: tied.map((c) => c.path) };
-}
-
-interface FrontmatterParts { fmText: string; body: string }
-
-function readCardParts(content: string): FrontmatterParts | null {
-  const split = splitCardContent(content);
-  if (!split.hasFrontmatter) return null;
-  return { fmText: split.frontmatterText, body: split.body };
-}
-
-function writeCardParts(fields: Record<string, unknown>, body: string): string {
-  return `---\n${stringifyYaml(fields)}---\n${body}`;
-}
-
-/**
- * Parse a ref path like `sources[2].ref` or `persons[0].ref` into a
- * sequence of object-key / array-index steps and update the leaf.
- * Returns true if the path resolved and the value was set.
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-function setRefAtPath(
-  fields: Record<string, unknown>,
-  refPath: string,
-  newValue: string,
-): boolean {
-  // eslint-disable-next-line security/detect-unsafe-regex -- bounded by string length, paths are short
-  const tokens = refPath.match(/([a-zA-Z_][a-zA-Z0-9_-]*)|\[(\d+)\]/g);
-  if (tokens === null || tokens.length === 0) return false;
-  let cursor: unknown = fields;
-  for (let i = 0; i < tokens.length - 1; i++) {
-    const tok = tokens[i];
-    cursor = stepInto(cursor, tok);
-    if (cursor === undefined) return false;
-  }
-  const last = tokens[tokens.length - 1];
-  if (last.startsWith("[")) {
-    const idx = Number(last.slice(1, -1));
-    if (!Array.isArray(cursor)) return false;
-    cursor[idx] = newValue;
-    return true;
-  }
-  if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) return false;
-  (cursor as Record<string, unknown>)[last] = newValue;
-  return true;
-}
-
-function stepInto(cursor: unknown, tok: string): unknown {
-  if (tok.startsWith("[")) {
-    const idx = Number(tok.slice(1, -1));
-    if (!Array.isArray(cursor)) return undefined;
-    return cursor[idx];
-  }
-  if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
-  return (cursor as Record<string, unknown>)[tok];
-}
-
-interface RepairCtx {
-  boxRoot: string;
-  apply: boolean;
-  basenameIndex: Map<string, string[]>;
-}
-
-async function repairCard(cardAbs: string, ctx: RepairCtx): Promise<void> {
-  const { boxRoot, apply, basenameIndex } = ctx;
-  let content: string;
-  try { content = await readFile(cardAbs, "utf8"); } catch (e) {
-    outcomes.push({ card: cardAbs, refPath: "", ref: "", kind: "error", detail: `read failed: ${(e as Error).message}` });
-    return;
-  }
-  const parts = readCardParts(content);
-  if (parts === null) return;
-  let fields: Record<string, unknown>;
-  try { fields = parseYaml(parts.fmText) as Record<string, unknown>; } catch (e) {
-    outcomes.push({ card: cardAbs, refPath: "", ref: "", kind: "error", detail: `yaml parse: ${(e as Error).message}` });
-    return;
-  }
-  if (fields === null || typeof fields !== "object") return;
-
-  const refs = extractRefs(fields);
-  if (refs.length === 0) return;
-
-  let mutated = false;
-  for (const { path: refPath, ref } of refs) {
-    const target = resolveRefPath({ boxRoot, sourceCardAbs: cardAbs }, ref);
-    if (await pathExists(target)) continue;
-
-    const base = basename(ref);
-    const candidates = basenameIndex.get(base);
-    if (candidates === undefined || candidates.length === 0) {
-      outcomes.push({ card: cardAbs, refPath, ref, kind: "missing", detail: `no file named ${base} in box` });
-      continue;
-    }
-
-    const { winner, tied } = pickBestCandidate(candidates, cardAbs, ref);
-    if (winner === null) {
-      const list = tied.map((p) => relative(boxRoot, p)).join(", ");
-      outcomes.push({ card: cardAbs, refPath, ref, kind: "ambiguous", detail: `tied: ${list}` });
-      continue;
-    }
-
-    const isAttach = ref === "attach" || ref.startsWith("attach/");
-    if (isAttach) {
-      // Move the file into the card's attach scope. The ref already
-      // names where it should land — derive the destination from the
-      // ref, not from where the file currently sits.
-      const destPath = resolveRefPath({ boxRoot, sourceCardAbs: cardAbs }, ref);
-      if (winner === destPath) continue; // somehow already there
-      const detail = `move ${relative(boxRoot, winner)} -> ${relative(boxRoot, destPath)}`;
-      outcomes.push({ card: cardAbs, refPath, ref, kind: "fix-move-attach", detail });
-      if (apply) {
-        await mkdir(dirname(destPath), { recursive: true });
-        await rename(winner, destPath);
-        // Update the index so a later ref doesn't try to claim the same file.
-        const list = basenameIndex.get(base);
-        if (list !== undefined) {
-          const next = list.filter((p) => p !== winner);
-          next.push(destPath);
-          basenameIndex.set(base, next);
-        }
-      }
-    } else {
-      const absRef = "/" + relative(boxRoot, winner).split(sep).join("/");
-      const ok = setRefAtPath(fields, refPath, absRef);
-      if (!ok) {
-        outcomes.push({ card: cardAbs, refPath, ref, kind: "error", detail: `could not set ref at path ${refPath}` });
-        continue;
-      }
-      outcomes.push({ card: cardAbs, refPath, ref, kind: "fix-rewrite", detail: `${ref} -> ${absRef}` });
-      mutated = true;
-    }
-  }
-
-  if (mutated && apply) {
-    await writeFile(cardAbs, writeCardParts(fields, parts.body));
-  }
-}
-
-function printReport(boxRoot: string, apply: boolean): void {
-  const counts: Record<string, number> = {};
-  for (const o of outcomes) counts[o.kind] = (counts[o.kind] ?? 0) + 1;
-  console.log("\nSummary:");
-  for (const k of ["fix-rewrite", "fix-move-attach", "missing", "ambiguous", "error"]) {
-    console.log(`  ${String(counts[k] ?? 0).padStart(5)}  ${k}`);
-  }
-
-  const fixes = outcomes.filter((o) => o.kind === "fix-rewrite" || o.kind === "fix-move-attach");
-  if (fixes.length > 0) {
-    console.log(`\nFixes (${String(fixes.length)})${apply ? "" : " — preview"}:`);
-    for (const o of fixes.slice(0, 30)) {
-      console.log(`  [${o.kind}] ${relative(boxRoot, o.card)} [${o.refPath}]`);
-      console.log(`    ${o.detail}`);
-    }
-    if (fixes.length > 30) console.log(`  ... and ${String(fixes.length - 30)} more`);
-  }
-
-  const missing = outcomes.filter((o) => o.kind === "missing");
-  if (missing.length > 0) {
-    console.log(`\nMissing refs (${String(missing.length)}):`);
-    for (const o of missing.slice(0, 40)) {
-      console.log(`  ${relative(boxRoot, o.card)} [${o.refPath}] -> ${o.ref}`);
-    }
-    if (missing.length > 40) console.log(`  ... and ${String(missing.length - 40)} more`);
-  }
-
-  const ambig = outcomes.filter((o) => o.kind === "ambiguous");
-  if (ambig.length > 0) {
-    console.log(`\nAmbiguous refs (${String(ambig.length)}):`);
-    for (const o of ambig.slice(0, 40)) {
-      console.log(`  ${relative(boxRoot, o.card)} [${o.refPath}] -> ${o.ref}`);
-      console.log(`    ${o.detail}`);
-    }
-    if (ambig.length > 40) console.log(`  ... and ${String(ambig.length - 40)} more`);
-  }
-
-  const errs = outcomes.filter((o) => o.kind === "error");
-  if (errs.length > 0) {
-    console.log(`\nErrors (${String(errs.length)}):`);
-    for (const o of errs.slice(0, 20)) {
-      console.log(`  ${relative(boxRoot, o.card)}: ${o.detail}`);
-    }
-  }
-
-  if (!apply) console.log("\nDry run. Pass --apply to perform fixes.");
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxArg = positional[0];
-  if (boxArg === undefined) {
-    console.error("Usage: repair-refs <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const boxRoot = resolve(boxArg);
-
-  console.log(`Indexing files under ${boxRoot}...`);
-  const allFiles: string[] = [];
-  await walkAllFiles(boxRoot, allFiles);
-
-  const basenameIndex = new Map<string, string[]>();
-  for (const f of allFiles) {
-    const b = basename(f);
-    const list = basenameIndex.get(b);
-    if (list === undefined) basenameIndex.set(b, [f]);
-    else list.push(f);
-  }
-  const cards = allFiles.filter((p) => isCardFile(basename(p)));
-  console.log(`Indexed ${String(allFiles.length)} files; scanning ${String(cards.length)} cards${apply ? " (APPLY)" : " (dry-run)"}`);
-
-  for (const card of cards) {
-    try {
-      await repairCard(card, { boxRoot, apply, basenameIndex });
-    } catch (e) {
-      outcomes.push({ card, refPath: "", ref: "", kind: "error", detail: (e as Error).message });
-    }
-  }
-
-  printReport(boxRoot, apply);
-}
-
-main().catch((e) => { console.error(e); process.exit(1); });
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/scheduled-script.ts b/callback-box/scripts/migrate/scheduled-script.ts
index dba4760e..9d9dfe60 100644
--- a/callback-box/scripts/migrate/scheduled-script.ts
+++ b/callback-box/scripts/migrate/scheduled-script.ts
@@ -1,206 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Phase 2: migrate `.scheduled-script.card` files from
- * frontmatter-with-XML-body to flat YAML frontmatter.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Usage:
- *   pnpm exec tsx scripts/migrate/scheduled-script.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/scheduled-script.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, readdir, writeFile } from "node:fs/promises";
-import { join, relative, resolve } from "node:path";
-import { parseCard, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-
-const KNOWN_ATTRS = new Set([
-  "cron", "at", "rrule", "until", "not-before", "on-wakeup", "once",
-  "enabled", "budget", "lock-group",
-]);
-const KNOWN_CHILDREN = new Set([
-  "description", "runs", "source", "create-after-success", "requires",
-]);
-const KNOWN_REQUIRES_CHILDREN = new Set(["connector"]);
-
-interface Warning { file: string; message: string }
-const warnings: Warning[] = [];
-
-function checkUnknown(node: ElementNode, source: string): void {
-  for (const attr of Object.keys(node.attrs)) {
-    if (!KNOWN_ATTRS.has(attr)) {
-      warnings.push({ file: source, message: `unknown attr on <scheduled-script>: ${attr}="${String(node.attrs[attr])}"` });
-    }
-  }
-  for (const child of node.children) {
-    if (!KNOWN_CHILDREN.has(child.tagName)) {
-      warnings.push({ file: source, message: `unknown child element: <${child.tagName}>` });
-      continue;
-    }
-    if (child.tagName === "requires") {
-      for (const sub of child.children) {
-        if (!KNOWN_REQUIRES_CHILDREN.has(sub.tagName)) {
-          warnings.push({ file: source, message: `unknown <requires> child: <${sub.tagName}>` });
-        }
-      }
-    }
-  }
-}
-
-async function findCards(root: string): Promise<string[]> {
-  const out: string[] = [];
-  async function walk(dir: string): Promise<void> {
-    let entries;
-    try {
-      entries = await readdir(dir, { withFileTypes: true });
-    } catch (e) {
-      const err = e as NodeJS.ErrnoException;
-      if (err.code === "ENOENT") return;
-      throw e;
-    }
-    for (const entry of entries) {
-      if (entry.name === ".git" || entry.name === "node_modules") continue;
-      const full = join(dir, entry.name);
-      if (entry.isDirectory()) {
-        await walk(full);
-      } else if (entry.isFile() && entry.name.endsWith(".scheduled-script.card")) {
-        out.push(full);
-      }
-    }
-  }
-  await walk(root);
-  return out;
-}
-
-function childText(node: ElementNode, tagName: string): string | undefined {
-  const c = node.children.find((c) => c.tagName === tagName);
-  if (c === undefined) return undefined;
-  const t = c.text;
-  return t === undefined || t === "" ? undefined : t;
-}
-
-function convertOne(node: ElementNode, source: string): Record<string, unknown> {
-  if (node.tagName !== "scheduled-script") {
-    throw new Error(`${source}: expected <scheduled-script>, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = { type: "scheduled-script" };
-
-  const a = node.attrs;
-  if (a["cron"] !== undefined) fields["cron"] = a["cron"];
-  if (a["at"] !== undefined) fields["at"] = a["at"];
-  if (a["rrule"] !== undefined) fields["rrule"] = a["rrule"];
-  if (a["until"] !== undefined) fields["until"] = a["until"];
-  if (a["not-before"] !== undefined) fields["not-before"] = a["not-before"];
-  if (a["on-wakeup"] === "true") fields["on-wakeup"] = true;
-  if (a["once"] === "true") fields["once"] = true;
-  if (a["enabled"] === "false") fields["enabled"] = false;
-  if (a["budget"] !== undefined) fields["budget"] = a["budget"];
-  if (a["lock-group"] !== undefined) fields["lock-group"] = a["lock-group"];
-
-  const description = childText(node, "description");
-  if (description !== undefined) fields["description"] = description;
-
-  const runs = childText(node, "runs");
-  fields["runs"] = runs ?? "";
-
-  const sourceEl = node.children.find((c) => c.tagName === "source");
-  if (sourceEl !== undefined) {
-    const ref = sourceEl.attrs["ref"];
-    const text = sourceEl.text;
-    if (ref !== undefined) {
-      const src: Record<string, string> = { ref };
-      if (text !== undefined && text !== "") src["text"] = text;
-      fields["source"] = src;
-    } else if (text !== undefined && text !== "") {
-      fields["source"] = text;
-    }
-  }
-
-  const chains = node.children.filter((c) => c.tagName === "create-after-success");
-  if (chains.length > 0) {
-    fields["create-after-success"] = chains.map((el) => {
-      const args: Record<string, string> = {};
-      const text = el.text?.trim() ?? "";
-      if (text !== "") {
-        for (const line of text.split("\n")) {
-          const trimmed = line.trim();
-          if (trimmed === "") continue;
-          const eq = trimmed.indexOf("=");
-          if (eq > 0) args[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
-        }
-      }
-      const entry: Record<string, unknown> = { path: el.attrs["path"] };
-      if (Object.keys(args).length > 0) entry["args"] = args;
-      return entry;
-    });
-  }
-
-  const requires = node.children.find((c) => c.tagName === "requires");
-  if (requires !== undefined) {
-    const connectors = requires.children
-      .filter((c) => c.tagName === "connector")
-      .map((c) => c.attrs["name"] as string);
-    if (connectors.length > 0) {
-      fields["requires"] = { connectors };
-    }
-  }
-
-  return fields;
-}
-
-async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
-  const raw = await readFile(absPath, "utf8");
-  // Any frontmatter card is already migrated — the filename is the type
-  // discriminator, and post-strip-type-field cards carry no `type:` line.
-  if (/^---\r?\n/.test(raw)) {
-    return "already-migrated";
-  }
-  const node = await parseCard(raw, { source: absPath });
-  checkUnknown(node, absPath);
-  const fields = convertOne(node, absPath);
-  await writeFile(absPath, `---\n${stringifyYaml(fields)}---\n`);
-  return "converted";
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxRoot = positional[0];
-  if (boxRoot === undefined) {
-    console.error("Usage: migrate-scheduled-script <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const absRoot = resolve(boxRoot);
-  const cards = await findCards(absRoot);
-  console.log(`Found ${String(cards.length)} *.scheduled-script.card files under ${absRoot}`);
-  if (!apply) return;
-  let converted = 0;
-  let already = 0;
-  const failed: Array<{ file: string; error: string }> = [];
-  for (const f of cards) {
-    try {
-      const r = await migrateFile(f);
-      if (r === "converted") converted++;
-      else already++;
-    } catch (e) {
-      failed.push({ file: f, error: (e as Error).message });
-    }
-  }
-  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
-  for (const f of failed) {
-    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
-  }
-  if (warnings.length > 0) {
-    console.log(`\n${String(warnings.length)} warning(s) about unrecognized fields:`);
-    for (const w of warnings) {
-      console.log(`  ${relative(absRoot, w.file)}: ${w.message}`);
-    }
-  }
-  if (failed.length > 0) process.exit(2);
-}
-
-main().catch((e) => {
-  console.error(e);
-  process.exit(1);
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/src/cli/commands/validate.ts b/callback-box/src/cli/commands/validate.ts
index 719c7abc..4d121f3a 100644
--- a/callback-box/src/cli/commands/validate.ts
+++ b/callback-box/src/cli/commands/validate.ts
@@ -12,7 +12,7 @@ import { lint as markdownlint } from "markdownlint/promise";
 import type { LintError } from "markdownlint";
 import { noViewLabelLinks, noBrokenInternalLinks } from "../../core/markdown-lint-rules.js";
 import { requireBoxRoot, isCardFile, isMarkdownFile } from "../lib/paths.js";
-import { createLoader } from "../lib/loader.js";
+import { listBoxCardFiles } from "../../core/list-cards.js";
 import { getStatus } from "../lib/git.js";
 import { lintAttachLayout, type AttachLintError } from "../../lib/attach-lint.js";
 import { lintCardsDispatch } from "../../core/card-lint.js";
@@ -146,11 +146,6 @@ function formatAttachLintErrors(errors: AttachLintError[], { colors }: { colors:
     .join("\n");
 }
 
-interface ValidationContext {
-  loader: Awaited<ReturnType<typeof createLoader>>;
-  ctx: LoadCardContext;
-}
-
 interface ValidationResults {
   cardSummary: LintSummary | null;
   mdSummary: MarkdownLintSummary | null;
@@ -185,9 +180,8 @@ async function runHookMode(): Promise<never> {
     process.exit(0);
   }
   const boxRoot = await requireBoxRoot();
-  const loader = await createLoader(boxRoot);
   const ctx = await buildLoadContext(boxRoot);
-  const summary = await lintCardsDispatch([fp], { loader, ctx });
+  const summary = await lintCardsDispatch([fp], { boxRoot, ctx });
   const stale = await staleContainsWarning(boxRoot, {
     relPath: path.relative(boxRoot, fp),
     ctx,
@@ -206,7 +200,6 @@ async function runHookMode(): Promise<never> {
 
 interface CollectArgs {
   boxRoot: string;
-  loader: ValidationContext["loader"];
   ctx: LoadCardContext;
   resolved: string[];
   json: boolean;
@@ -226,21 +219,21 @@ async function collectResults(
 }
 
 /** Validate the union of git-staged cards and any explicit card paths given. */
-async function collectStagedResults({ boxRoot, loader, ctx, resolved, json }: CollectArgs): Promise<ValidationResults> {
+async function collectStagedResults({ boxRoot, ctx, resolved, json }: CollectArgs): Promise<ValidationResults> {
   const staged = await listStagedCards(boxRoot);
   const explicit = resolved.filter(isCardFile);
   const all = [...staged, ...explicit];
   if (all.length === 0 && !json) {
     console.log("No staged cards to validate.");
   }
-  const cardSummary = all.length > 0 ? await lintCardsDispatch(all, { loader, ctx }) : null;
+  const cardSummary = all.length > 0 ? await lintCardsDispatch(all, { boxRoot, ctx }) : null;
   return { cardSummary, mdSummary: null, attachErrors: [], claudeMdWarnings: [] };
 }
 
 /** Validate every card, markdown file, and attach layout in the box. */
-async function collectAllResults({ boxRoot, loader, ctx }: CollectArgs): Promise<ValidationResults> {
-  const cardPaths = (await loader.listCards()).filter((p) => !isTrashedCard(p));
-  const cardSummary = await lintCardsDispatch(cardPaths, { loader, ctx });
+async function collectAllResults({ boxRoot, ctx }: CollectArgs): Promise<ValidationResults> {
+  const cardPaths = (await listBoxCardFiles(boxRoot)).filter((p) => !isTrashedCard(p));
+  const cardSummary = await lintCardsDispatch(cardPaths, { boxRoot, ctx });
   const mdFiles = await findMarkdownFiles(boxRoot);
   const mdSummary = mdFiles.length > 0 ? await lintMarkdownFiles(mdFiles) : null;
   const attachErrors = await lintAttachLayout(boxRoot);
@@ -249,7 +242,7 @@ async function collectAllResults({ boxRoot, loader, ctx }: CollectArgs): Promise
 }
 
 /** Validate an explicit list of card/markdown paths; exit 1 on unknown types. */
-async function collectExplicitResults({ loader, ctx, resolved }: CollectArgs): Promise<ValidationResults> {
+async function collectExplicitResults({ boxRoot, ctx, resolved }: CollectArgs): Promise<ValidationResults> {
   const cardPaths = resolved.filter(isCardFile);
   const mdPaths = resolved.filter(isMarkdownFile);
   const unknown = resolved.filter((p) => !isCardFile(p) && !isMarkdownFile(p));
@@ -257,7 +250,7 @@ async function collectExplicitResults({ loader, ctx, resolved }: CollectArgs): P
     console.error(`Error: not a card or markdown file: ${unknown.join(", ")}`);
     process.exit(1);
   }
-  const cardSummary = cardPaths.length > 0 ? await lintCardsDispatch(cardPaths, { loader, ctx }) : null;
+  const cardSummary = cardPaths.length > 0 ? await lintCardsDispatch(cardPaths, { boxRoot, ctx }) : null;
   const mdSummary = mdPaths.length > 0 ? await lintMarkdownFiles(mdPaths) : null;
   return { cardSummary, mdSummary, attachErrors: [], claudeMdWarnings: [] };
 }
@@ -336,7 +329,6 @@ export const validateCommand = new Command("validate")
         }
 
         const boxRoot = await requireBoxRoot();
-        const loader = await createLoader(boxRoot);
         const ctx = await buildLoadContext(boxRoot);
         const json = options.json === true;
 
@@ -344,7 +336,7 @@ export const validateCommand = new Command("validate")
           path.isAbsolute(p) ? p : path.join(process.cwd(), p)
         );
 
-        const results = await collectResults(options, { boxRoot, loader, ctx, resolved, json });
+        const results = await collectResults(options, { boxRoot, ctx, resolved, json });
 
         if (json) {
           const payload = { cards: results.cardSummary, markdown: results.mdSummary, attach: results.attachErrors, claudeMd: results.claudeMdWarnings };
diff --git a/callback-box/src/cli/commands/wakeup-steps.ts b/callback-box/src/cli/commands/wakeup-steps.ts
index 04035464..aaf9d060 100644
--- a/callback-box/src/cli/commands/wakeup-steps.ts
+++ b/callback-box/src/cli/commands/wakeup-steps.ts
@@ -12,7 +12,6 @@ import * as fs from "node:fs/promises";
 import * as path from "node:path";
 import { type Connector } from "../../connectors/index.js";
 import { runPreActions } from "../../core/preactions/index.js";
-import { createLoader } from "../lib/loader.js";
 import { getSystemState } from "../../core/state.js";
 import { stageAll, stageFiles, commit, getStatus } from "../lib/git.js";
 import { createNewIntakeJob } from "../../connectors/intake-utils.js";
@@ -28,14 +27,12 @@ export async function runPreprocessors(boxRoot: string): Promise<number> {
   const state = await getSystemState(boxRoot);
   if (state.inbox.length === 0) return 0;
 
-  const loader = await createLoader(boxRoot);
   const actionNotes: string[] = [];
 
   for (const item of state.inbox) {
     try {
       const results = await runPreActions({
         boxRoot,
-        loader,
         cardPath: item.path,
       });
 
diff --git a/callback-box/src/cli/lib/loader.ts b/callback-box/src/cli/lib/loader.ts
deleted file mode 100644
index e9007164..00000000
--- a/callback-box/src/cli/lib/loader.ts
+++ /dev/null
@@ -1,71 +0,0 @@
-/**
- * CardLoader factory for callback box.
- *
- * Creates a configured CardLoader instance with all known schemas.
- */
-
-import { CardLoader, MemoryCardLoader, type CardLoaderOptions } from "cardworks";
-import { createSchemaRegistry } from "../../schemas/registry.js";
-
-export interface CreateLoaderOptions {
-  /** Whether to require version attributes on cards */
-  requireVersion?: boolean;
-  /** Whether to indent serialized XML */
-  indent?: boolean;
-}
-
-/**
- * Create a CardLoader for the given box root.
- *
- * Loads both built-in schemas and any box-local schemas from config/schemas/.
- *
- * @param boxRoot - The root directory of the callback box
- * @param options - Optional configuration
- * @returns A configured CardLoader
- */
-export async function createLoader(
-  boxRoot: string,
-  options?: CreateLoaderOptions
-): Promise<CardLoader> {
-  options = options ?? {};
-  const loaderOptions: CardLoaderOptions = {
-    schemas: await createSchemaRegistry(boxRoot),
-    requireVersion: options.requireVersion ?? false,
-    indent: options.indent ?? false,
-  };
-
-  return new CardLoader(boxRoot, loaderOptions);
-}
-
-/**
- * Parameters for createMemoryLoader
- */
-export interface CreateMemoryLoaderParams {
-  projectRoot: string;
-  files?: Record<string, string>;
-  options?: CreateLoaderOptions;
-}
-
-/**
- * Create an in-memory CardLoader for testing.
- *
- * @param params - Parameters object
- * @returns A configured MemoryCardLoader
- */
-export async function createMemoryLoader(
-  params: CreateMemoryLoaderParams
-): Promise<MemoryCardLoader> {
-  const { projectRoot } = params;
-  const files = params.files ?? {};
-  const options = params.options ?? {};
-  return new MemoryCardLoader(projectRoot, {
-    schemas: await createSchemaRegistry(),
-    requireVersion: options.requireVersion ?? false,
-    indent: options.indent ?? false,
-    files,
-  });
-}
-
-// Re-export CardLoader types for convenience
-export { CardLoader, MemoryCardLoader, ValidationError } from "cardworks";
-export type { ICardLoader, CardLoaderOptions } from "cardworks";
diff --git a/callback-box/src/core/agent-guide/cards.ts b/callback-box/src/core/agent-guide/cards.ts
index a0670a53..7c8a8b69 100644
--- a/callback-box/src/core/agent-guide/cards.ts
+++ b/callback-box/src/core/agent-guide/cards.ts
@@ -3,17 +3,17 @@
  * the user via question cards.
  */
 
-import type { ElementSchema } from "cardworks";
+import type { CardSchema } from "../../cards/index.js";
 import { getAllTemplates } from "../../schemas/templates.js";
 
-export function cardTypesSection(allSchemas: ElementSchema[]): string[] {
+export function cardTypesSection(allCardSchemas: CardSchema[]): string[] {
   const lines: string[] = [
     "## Card Types",
     "",
   ];
-  for (const schema of allSchemas) {
-    const hasDoc = schema.instructions ? ` — see \`docs/generated/card-${schema.tagName}.md\`` : "";
-    lines.push(`- **${schema.tagName}**${hasDoc}`);
+  for (const schema of allCardSchemas) {
+    const hasDoc = schema.instructions ? ` — see \`docs/generated/card-${schema.type}.md\`` : "";
+    lines.push(`- **${schema.type}**${hasDoc}`);
   }
   lines.push("");
   lines.push("New card types can be defined in `config/schemas/` using `cardSchema()` (YAML frontmatter + markdown body) + Zod — see `config/schemas/CLAUDE.md` for how. Run `cb init` after adding a schema to generate rules and docs.");
diff --git a/callback-box/src/core/agent-guide/index.ts b/callback-box/src/core/agent-guide/index.ts
index c713657b..8ee2a763 100644
--- a/callback-box/src/core/agent-guide/index.ts
+++ b/callback-box/src/core/agent-guide/index.ts
@@ -8,8 +8,8 @@
  * file and slot it into the array below.
  */
 
-import type { ElementSchema } from "cardworks";
-import { schemas } from "../../schemas/registry.js";
+import type { CardSchema } from "../../cards/index.js";
+import { cardSchemas } from "../../schemas/registry.js";
 import type { ProcedureSummary, GuideSummary } from "../generate-docs.js";
 
 import { directoryLayoutSection, howItemsEnterSection } from "./box-shape.js";
@@ -47,7 +47,7 @@ import { briefingTagsSection } from "./briefing-tags.js";
 
 export interface AgentGuideOptions {
   procedures: ProcedureSummary[];
-  allSchemas?: ElementSchema[];
+  allCardSchemas?: CardSchema[];
   personalitySection?: string | undefined;
   guides?: GuideSummary[];
 }
@@ -55,7 +55,7 @@ export interface AgentGuideOptions {
 export function generateAgentGuide(options: AgentGuideOptions): string {
   const {
     procedures,
-    allSchemas = schemas,
+    allCardSchemas = cardSchemas,
     personalitySection,
     guides = [],
   } = options;
@@ -79,7 +79,7 @@ export function generateAgentGuide(options: AgentGuideOptions): string {
     ...chatAttachmentsSection(),
     ...selectionsSection(),
     ...viewsSection(),
-    ...cardTypesSection(allSchemas),
+    ...cardTypesSection(allCardSchemas),
     ...creatingCardsSection(),
     ...questionsSection(),
     ...quotesSection(),
diff --git a/callback-box/src/core/box-templates.ts b/callback-box/src/core/box-templates.ts
index 690d3d1f..b6d74c44 100644
--- a/callback-box/src/core/box-templates.ts
+++ b/callback-box/src/core/box-templates.ts
@@ -99,14 +99,10 @@ export default cardSchema("link", {
 ## Available Imports
 
 From \`callback-box/cards\`:
-- \`cardSchema(type, config)\` — define a frontmatter card schema (the default)
+- \`cardSchema(type, config)\` — define a frontmatter card schema
 - \`body(zodSchema)\` — declare the single markdown body field
 - \`type LintIssue\` — the issue type a \`validate\` hook returns (see above)
 
-From \`cardworks\` (legacy — only for \`element()\` XML schemas, see below):
-- \`element(tagName, config)\` — define a legacy XML schema
-- \`escapeText(str)\` / \`escapeAttr(str)\` — XML-escape helpers
-
 From \`zod\`:
 - \`z\` — Zod schema builder (z.string(), z.enum(), z.array(), etc.)
 
@@ -156,30 +152,6 @@ This will:
 
 Schema changes are picked up on the next \`cb\` invocation; a running dev server needs a restart.
 
-## Legacy: XML / \`element()\` schemas
-
-Use \`element()\` only when the card body is Markdoc-shaped inline content — nested, attributed
-inline structure that doesn't fit YAML frontmatter. This is why the built-in \`guide\` and
-\`capture-session\` types still use it. For everything else, prefer \`cardSchema\` above.
-
-\`\`\`typescript
-import { element } from "cardworks";
-import { z } from "zod";
-
-export default element("note", {
-  attrs: {
-    status: z.enum(["draft", "final"]).default("draft"),
-  },
-  children: z.array(z.unknown()),
-  instructions: \\\`# Note Cards
-
-Instructions for the agent on how to handle this card type.\\\`,
-});
-\`\`\`
-
-A legacy template's \`generate\` emits XML instead of YAML, using \`escapeText\` / \`escapeAttr\` for
-interpolated values. See the built-in XML schemas in callback-box's \`src/schemas/\` for examples.
-
 ## Tips
 
 - Keep schema files focused — one card type per file
diff --git a/callback-box/src/core/card-io.ts b/callback-box/src/core/card-io.ts
index 43a40db6..5f4c12bc 100644
--- a/callback-box/src/core/card-io.ts
+++ b/callback-box/src/core/card-io.ts
@@ -11,14 +11,13 @@
  *   ---
  *   markdown body, if the schema declares one
  *
- * The host application (this module) owns YAML parsing so cardworks
- * stays YAML-free. cardworks provides the schema declaration primitives
- * (`cardSchema`, `body`) and the frontmatter splitter (`splitCardContent`).
+ * The card-primitive layer (`src/cards/`) provides the schema declaration
+ * primitives (`cardSchema`, `body`) and the frontmatter splitter
+ * (`splitCardContent`); this module owns the YAML parsing on top of them.
  */
 
 import { readFile } from "node:fs/promises";
 import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
-import { parseCard, type ElementSchema, type ElementNode } from "cardworks";
 import { splitCardContent, type CardSchema } from "../cards/index.js";
 
 const CARD_XML_CONTENT_TYPE = "application/x-card+xml";
@@ -274,10 +273,10 @@ export function serializeCardText(input: {
 }
 
 /**
- * A card loaded via the dispatcher. New (CardSchema) and legacy (XML)
- * schemas coexist; callers narrow on `kind` to access the right shape.
+ * A card loaded via the dispatcher. Every card is markdown-frontmatter now;
+ * the type alias is kept for the many consumers that name it.
  */
-export type LoadedCard = FrontmatterLoadedCard | XmlLoadedCard;
+export type LoadedCard = FrontmatterLoadedCard;
 
 export interface FrontmatterLoadedCard {
   readonly kind: "frontmatter";
@@ -287,28 +286,15 @@ export interface FrontmatterLoadedCard {
   readonly contentType: string | undefined;
 }
 
-export interface XmlLoadedCard {
-  readonly kind: "xml";
-  readonly path: string;
-  readonly schema: ElementSchema | undefined;
-  readonly element: ElementNode;
-}
-
 export interface LoadCardContext {
   /** Schemas keyed by frontmatter `type:` value. */
   cardSchemas: Map<string, CardSchema>;
-  /** XML schemas keyed by root element tag name (cardworks ElementSchema). */
-  elementSchemas: Map<string, ElementSchema>;
 }
 
 /**
- * Load a `.card` file, dispatching on the file's frontmatter:
- *
- * - If the file has a `---` frontmatter block whose YAML carries a
- *   `type:` field matching a registered CardSchema, it's parsed as the
- *   new markdown-frontmatter format.
- * - Otherwise the body is parsed as XML (legacy format) and the root
- *   tag's ElementSchema (if any) is used for validation.
+ * Load a `.card` file. The file must have a `---` frontmatter block whose
+ * filename type (`Foo.<type>.card`) matches a registered CardSchema; anything
+ * else throws a CardIOError.
  */
 export async function loadCardFile(
   absPath: string,
@@ -342,7 +328,9 @@ export function loadCardFromText(input: {
       });
     }
   }
-  return loadXmlCard({ content, source, ctx });
+  return Promise.reject(
+    new CardIOError(source, "not a recognized card: no frontmatter block with a registered type")
+  );
 }
 
 /**
@@ -362,14 +350,4 @@ export function typeFromFilename(source: string): string | undefined {
   return match ? match[1] : undefined;
 }
 
-async function loadXmlCard(input: {
-  content: string;
-  source: string;
-  ctx: LoadCardContext;
-}): Promise<XmlLoadedCard> {
-  const { content, source, ctx } = input;
-  const element = await parseCard(content, { source });
-  const schema = ctx.elementSchemas.get(element.tagName);
-  return { kind: "xml", path: source, schema, element };
-}
 
diff --git a/callback-box/src/core/card-lint.ts b/callback-box/src/core/card-lint.ts
index 1fa137d8..d5a82eae 100644
--- a/callback-box/src/core/card-lint.ts
+++ b/callback-box/src/core/card-lint.ts
@@ -1,12 +1,12 @@
 /**
- * Lint dispatcher for mixed XML / markdown-frontmatter cards.
+ * Lint dispatcher for markdown-frontmatter cards.
  *
  * For each card path, peeks at the frontmatter to decide which path to
- * take: cards declaring a `type:` that matches a registered CardSchema
- * are validated through parseCardText (Zod schema check); everything
- * else falls through to cardworks' existing XML lintCard. Results are
- * merged into a single LintSummary so callers (e.g. cb validate) can
- * format them uniformly.
+ * take: cards declaring a filename `type` that matches a registered
+ * CardSchema are validated through parseCardText (Zod schema check); a
+ * `.card` with no matching schema is surfaced as a non-blocking warning.
+ * Results are merged into a single LintSummary so callers (e.g. cb validate)
+ * can format them uniformly.
  *
  * Ref-checking walks two sides: `extractRefs` (src/cards) over parsed
  * frontmatter fields, and `extractBodyRefs` over the Markdoc body. Both
@@ -15,13 +15,12 @@
  *
  * Type-specific, self-contained validation (rules Zod can't express, e.g.
  * commentary's Markdoc check or extfile's `file:`-URL refinement) is NOT here:
- * it lives on each schema as a `validate` hook (cardworks), invoked generically
- * below. The ref-existence walk stays here because it is box-aware (needs the
- * loader), which the self-contained hook deliberately lacks.
+ * it lives on each schema as a `validate` hook, invoked generically below.
+ * The ref-existence walk stays here because it is box-aware (resolves refs
+ * against the box root), which the self-contained hook deliberately lacks.
  */
 
 import { readFile } from "node:fs/promises";
-import { lintCard, type ICardLoader } from "cardworks";
 import {
   splitCardContent,
   extractRefs,
@@ -33,9 +32,14 @@ import {
 import { parse as parseYaml } from "yaml";
 import { parseCardText, typeFromFilename, type LoadCardContext } from "./card-io.js";
 import { extractBodyRefs } from "./body-refs.js";
+import { resolveRefExists } from "./ref-exists.js";
 
 export interface LintDispatchOptions {
-  loader: ICardLoader;
+  /**
+   * Box root, used to resolve box-root-absolute (`/…`) refs during the
+   * broken-ref walk (see resolveRefExists).
+   */
+  boxRoot: string;
   ctx: LoadCardContext;
 }
 
@@ -85,8 +89,26 @@ async function lintOne(path: string, options: LintDispatchOptions): Promise<Lint
     if (type !== undefined && options.ctx.cardSchemas.has(type)) {
       return lintFrontmatterCard({ path, content, options, type });
     }
+    // Frontmatter present but no registered schema for the filename type: there
+    // is no XML loader anymore. Surface a non-blocking warning so a typo'd or
+    // unknown type is visible without failing the commit hook.
+    return {
+      path,
+      errors: [],
+      warnings: [
+        {
+          type: "schema",
+          severity: "warning",
+          message:
+            type === undefined
+              ? "card filename does not encode a type (expected Name.<type>.card)"
+              : `no schema registered for card type "${type}" — card not validated`,
+        },
+      ],
+    };
   }
-  return lintCard(options.loader, { path });
+  // Not a frontmatter card at all — nothing to validate.
+  return { path, errors: [], warnings: [] };
 }
 
 async function lintFrontmatterCard(input: {
@@ -115,8 +137,8 @@ async function lintFrontmatterCard(input: {
   const warnings: LintIssue[] = [];
   for (const { path: refPath, ref } of [...frontmatterRefs, ...bodyRefs]) {
     try {
-      const resolved = await options.loader.resolveRef(ref, path);
-      if (!resolved.exists) {
+      const exists = await resolveRefExists({ ref, fromPath: path, boxRoot: options.boxRoot });
+      if (!exists) {
         warnings.push({
           type: "reference",
           severity: "warning",
diff --git a/callback-box/src/core/commands/move-operations.ts b/callback-box/src/core/commands/move-operations.ts
index 04d5995d..22e79508 100644
--- a/callback-box/src/core/commands/move-operations.ts
+++ b/callback-box/src/core/commands/move-operations.ts
@@ -13,15 +13,15 @@
 
 import * as fs from "node:fs/promises";
 import * as path from "node:path";
-import { CardLoader } from "cardworks";
 import type { CommandContext } from "../command-runner.js";
 import { attachDirFor } from "../../shared/attach-path.js";
+import { listBoxCardFiles } from "../list-cards.js";
 import {
   rewriteReferrerRefs,
   rewriteMovedCardRefs,
   type Remap,
 } from "../rewrite-card-refs.js";
-import { isPhase2CardPath, movePhase2CardFiles } from "./move-phase2.js";
+import { movePhase2CardFiles } from "./move-phase2.js";
 
 export interface MoveOneResult {
   from: string;
@@ -101,8 +101,7 @@ export async function moveDir(params: MoveDirParams): Promise<MoveDirResult> {
   // Rewrite refs from cards *outside* the moved directory that point into it
   // (relative or absolute), and recompute the moved cards' own *outgoing*
   // relative refs to targets that stayed outside.
-  const loader = new CardLoader(ctx.boxRoot);
-  const allCards = await loader.listCards();
+  const allCards = await listBoxCardFiles(ctx.boxRoot);
   for (const cardPath of allCards) {
     const inside = cardPath === destPath || cardPath.startsWith(destPath + path.sep);
     try {
@@ -149,38 +148,22 @@ export async function moveDir(params: MoveDirParams): Promise<MoveDirResult> {
 }
 
 /**
- * Perform the actual file relocation for a single card, returning the moved
- * files and any references cardworks itself re-serialized.
+ * Perform the actual file relocation for a single card: rename the `.card`
+ * file and its sibling `<basename>.attach/` directory. Every card is
+ * frontmatter, so the substring ref-rewrite pass (rewriteOtherCards) handles
+ * all referrer updates — there's nothing to re-serialize.
  */
 async function relocateCardFiles({
-  ctx,
-  loader,
   sourcePath,
   destPath,
 }: {
-  ctx: CommandContext;
-  loader: CardLoader;
   sourcePath: string;
   destPath: string;
 }): Promise<{
   movedFiles: Array<{ from: string; to: string }>;
   updatedCards: Array<{ path: string; refsUpdated: number }>;
 }> {
-  // Phase-2 cards: cardworks' XML-only loader can't parse them, so handle
-  // the file + attach-dir rename ourselves. XML cards: delegate to cardworks
-  // for the file moves and referrer re-serialization.
-  if (isPhase2CardPath(sourcePath)) {
-    return { movedFiles: await movePhase2CardFiles(sourcePath, destPath), updatedCards: [] };
-  }
-  const card = await loader.load(sourcePath);
-  const { result } = await loader.move(card, destPath);
-  return {
-    movedFiles: result.movedFiles,
-    updatedCards: result.updatedCards.map((u) => ({
-      path: path.relative(ctx.boxRoot, u.path),
-      refsUpdated: u.refsUpdated,
-    })),
-  };
+  return { movedFiles: await movePhase2CardFiles(sourcePath, destPath), updatedCards: [] };
 }
 
 /**
@@ -194,13 +177,11 @@ async function relocateCardFiles({
  */
 async function rewriteOtherCards({
   ctx,
-  loader,
   destPath,
   newAttachAbsDir,
   remap,
 }: {
   ctx: CommandContext;
-  loader: CardLoader;
   destPath: string;
   newAttachAbsDir: string;
   remap: Remap;
@@ -210,7 +191,7 @@ async function rewriteOtherCards({
 }> {
   const extraStaged: string[] = [];
   const extraUpdated: Array<{ path: string; refsUpdated: number }> = [];
-  const allCards = await loader.listCards();
+  const allCards = await listBoxCardFiles(ctx.boxRoot);
   for (const cardPath of allCards) {
     // Skip the moved card (handled separately) and cards that just moved into
     // the new attach scope (their internal refs travelled with them intact).
@@ -315,12 +296,7 @@ export async function moveOne(params: MoveOneParams): Promise<MoveOneResult> {
   const oldAttachAbsDir = attachDirFor(sourcePath);
   const newAttachAbsDir = attachDirFor(destPath);
 
-  // The loader is constructed unconditionally because `listCards()` is
-  // needed for the ref rewrite pass below regardless of card kind.
-  const loader = new CardLoader(ctx.boxRoot);
   const { movedFiles, updatedCards } = await relocateCardFiles({
-    ctx,
-    loader,
     sourcePath,
     destPath,
   });
@@ -338,7 +314,6 @@ export async function moveOne(params: MoveOneParams): Promise<MoveOneResult> {
 
   const { extraStaged, extraUpdated } = await rewriteOtherCards({
     ctx,
-    loader,
     destPath,
     newAttachAbsDir,
     remap,
diff --git a/callback-box/src/core/commands/move-phase2.ts b/callback-box/src/core/commands/move-phase2.ts
index 0a93a5e5..1d7b0332 100644
--- a/callback-box/src/core/commands/move-phase2.ts
+++ b/callback-box/src/core/commands/move-phase2.ts
@@ -8,18 +8,14 @@
  * the move ourselves; the substring rewrite pass in the move command
  * picks up ref updates in every other card regardless of card kind.
  *
- * Detect by extracting the type from the filename and checking it
- * against the registered Phase-2 card schemas. Anything else (XML
- * card, plain file, unknown type) falls through to the cardworks
- * loader path.
+ * Every card is YAML-frontmatter, so a card move is always a file +
+ * attach-dir rename; referrer ref updates are handled by the substring
+ * rewrite pass in move-operations.ts.
  */
 
 import * as fs from "node:fs/promises";
 import * as path from "node:path";
 import { attachDirFor } from "../../shared/attach-path.js";
-import { cardSchemas } from "../../schemas/registry.js";
-
-const PHASE2_TYPES = new Set(cardSchemas.map((s) => s.type));
 
 class AttachDirRenameError extends Error {
   readonly from: string;
@@ -32,22 +28,7 @@ class AttachDirRenameError extends Error {
   }
 }
 
-function cardTypeFromPath(p: string): string | undefined {
-  const base = p.split("/").pop() ?? p;
-  const match = /^.+\.([^.]+)\.card$/.exec(base);
-  if (match === null) return undefined;
-  return match[1];
-}
-
 /**
- * Whether a path names a Phase-2 frontmatter+markdown card (vs. a legacy
- * XML card, plain file, or unknown type).
- */
-export function isPhase2CardPath(p: string): boolean {
-  const type = cardTypeFromPath(p);
-  return type !== undefined && PHASE2_TYPES.has(type);
-}
-
 /**
  * Rename a file and (if present) its sibling `<basename>.attach/`
  * directory atomically — the Phase-2 analogue of what cardworks'
diff --git a/callback-box/src/core/commands/scan-import-cards.ts b/callback-box/src/core/commands/scan-import-cards.ts
index 9820bef1..440b8583 100644
--- a/callback-box/src/core/commands/scan-import-cards.ts
+++ b/callback-box/src/core/commands/scan-import-cards.ts
@@ -17,15 +17,14 @@
 
 import * as fs from "node:fs/promises";
 import * as path from "node:path";
-import type { createLoader } from "../../cli/lib/loader.js";
+import { parseCardText, serializeCardText } from "../card-io.js";
+import { type CardSchema } from "../../cards/index.js";
 import { createImageTemplate } from "../../schemas/image.js";
 import { createTextQuestionTemplate } from "../../schemas/question.js";
 import type { PhotoBundle, OrphanBack, ResolvedPage } from "./scan-import-helpers.js";
 
-type Loader = Awaited<ReturnType<typeof createLoader>>;
-
 interface PhotoBundleEmitContext {
-  loader: Loader;
+  cardSchemas: Map<string, CardSchema>;
   index: number;
   bundle: PhotoBundle;
   startedAt: string;
@@ -39,7 +38,7 @@ interface PhotoBundleEmitContext {
 
 export async function emitPhotoBundle(emitCtx: PhotoBundleEmitContext): Promise<void> {
   const {
-    loader,
+    cardSchemas,
     index,
     bundle,
     startedAt,
@@ -75,7 +74,7 @@ export async function emitPhotoBundle(emitCtx: PhotoBundleEmitContext): Promise<
   });
   const cardPath = path.join(sessionAttachAbsDir, cardFilename);
   await fs.writeFile(cardPath, cardContent);
-  await applyBundleAnalysisToCard(loader, { cardPath, bundle });
+  await applyBundleAnalysisToCard({ cardPath, bundle, cardSchemas });
   filesToStage.push(`${sessionAttachRelDir}/${cardFilename}`);
   imageRefs.push(cardFilename);
 
@@ -165,70 +164,38 @@ export async function emitUnsureQuestion(
 }
 
 async function applyBundleAnalysisToCard(
-  loader: Loader,
-  { cardPath, bundle }: { cardPath: string; bundle: PhotoBundle }
+  { cardPath, bundle, cardSchemas }: { cardPath: string; bundle: PhotoBundle; cardSchemas: Map<string, CardSchema> }
 ): Promise<void> {
-  const card = await loader.load(cardPath);
-  const el = card.element;
+  const content = await fs.readFile(cardPath, "utf-8");
+  const parsed = parseCardText(content, { source: cardPath, schemas: cardSchemas, type: "image" });
+  const fields = { ...parsed.fields };
 
-  el.attrs["status"] = "analyzed";
   const photo = bundle.photo;
   const back = bundle.back;
 
-  const photoTextBlocks = photo.text_blocks.map((b) => ({
-    source: b.source || "photo",
-    text: b.text,
-  }));
+  // The image schema's `text` field is an array of { source, content }.
+  const photoTextBlocks = photo.text_blocks.map((b) => ({ source: b.source || "photo", content: b.text }));
   const backTextBlocks = back
-    ? back.text_blocks.map((b) => ({ source: b.source || "back", text: b.text }))
+    ? back.text_blocks.map((b) => ({ source: b.source || "back", content: b.text }))
     : [];
   const allTextBlocks = [...photoTextBlocks, ...backTextBlocks];
-  const hasText = allTextBlocks.length > 0;
 
-  el.attrs["has-text"] = hasText ? "true" : "false";
-  if (photo.rotation !== 0) {
-    el.attrs["rotation"] = String(photo.rotation);
-  }
+  fields["status"] = "analyzed";
+  fields["has-text"] = allTextBlocks.length > 0;
+  fields["description"] = photo.description;
+  if (photo.rotation !== 0) fields["rotation"] = String(photo.rotation);
 
-  const descChild = el.children.find((c) => c.tagName === "description");
-  if (descChild) descChild.text = photo.description;
-
-  el.children = el.children.filter(
-    (c) =>
-      c.tagName !== "text" &&
-      c.tagName !== "exif" &&
-      c.tagName !== "subject-bbox" &&
-      c.tagName !== "document"
-  );
-
-  for (const block of allTextBlocks) {
-    el.children.push({
-      tagName: "text",
-      attrs: { source: block.source },
-      text: block.text,
-      children: [],
-      comments: {},
-      location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
-      dirty: true,
-    });
-  }
+  if (allTextBlocks.length > 0) fields["text"] = allTextBlocks;
+  else delete fields["text"];
 
   if (photo.subject_bbox && photo.subject_bbox.length === 4) {
-    el.children.push({
-      tagName: "subject-bbox",
-      attrs: {
-        y1: String(photo.subject_bbox[0]),
-        x1: String(photo.subject_bbox[1]),
-        y2: String(photo.subject_bbox[2]),
-        x2: String(photo.subject_bbox[3]),
-      },
-      text: "",
-      children: [],
-      comments: {},
-      location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
-      dirty: true,
-    });
+    fields["subject-bbox"] = {
+      y1: String(photo.subject_bbox[0]),
+      x1: String(photo.subject_bbox[1]),
+      y2: String(photo.subject_bbox[2]),
+      x2: String(photo.subject_bbox[3]),
+    };
   }
 
-  await loader.save(card);
+  await fs.writeFile(cardPath, serializeCardText({ schema: parsed.schema, fields }));
 }
diff --git a/callback-box/src/core/commands/scan-import.ts b/callback-box/src/core/commands/scan-import.ts
index d372e524..bc9649e9 100644
--- a/callback-box/src/core/commands/scan-import.ts
+++ b/callback-box/src/core/commands/scan-import.ts
@@ -37,7 +37,7 @@ import {
   type CommandContext,
   type CommandResult,
 } from "../command-runner.js";
-import { createLoader } from "../../cli/lib/loader.js";
+import { createCardSchemaMap } from "../../schemas/registry.js";
 import { stageFiles, commit } from "../../cli/lib/git.js";
 import { createCaptureSessionTemplate } from "../../schemas/capture-session.js";
 import { createOrAppendIntakeJob } from "../../connectors/intake-utils.js";
@@ -203,13 +203,13 @@ async function runPhotoMode(
     `\nResults: ${bundles.length} photos (${bundles.filter((b) => b.backIndex !== null).length} with backs), ${orphanBacks.length} orphan backs, ${unsurePages.length} unsure, ${blankPages.length} blank`
   );
 
-  const loader = await createLoader(ctx.boxRoot);
+  const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
   const imageRefs: string[] = [];
   const questionPaths: string[] = [];
 
   for (const [i, bundle] of bundles.entries()) {
     await emitPhotoBundle({
-      loader,
+      cardSchemas,
       index: i,
       bundle,
       startedAt,
diff --git a/callback-box/src/core/file-summary.ts b/callback-box/src/core/file-summary.ts
index 83363274..a270d709 100644
--- a/callback-box/src/core/file-summary.ts
+++ b/callback-box/src/core/file-summary.ts
@@ -10,8 +10,6 @@
  * path not to reach into attrs.
  */
 
-import type { ElementNode } from "cardworks";
-
 export interface FileSummary<T = unknown> {
   /** Box-relative path to the file */
   path: string;
@@ -26,17 +24,15 @@ export interface FileSummary<T = unknown> {
 }
 
 /**
- * Input passed to a loader. The server populates `element` for parsed cards
+ * Input passed to a loader. The server populates `fields` for parsed cards
  * and `content` for text files; loaders that don't need either just return
  * a summary keyed on `path`.
  */
 export interface LoaderInput {
   path: string;
-  /** Populated for Phase 1 XML-bodied cards. */
-  element?: ElementNode;
-  /** Populated for Phase 2 frontmatter-bodied cards. */
+  /** Populated for frontmatter cards: the parsed frontmatter fields. */
   fields?: Record<string, unknown>;
-  /** Card type — from `element.tagName` (XML) or `fields.type` (frontmatter). */
+  /** Card type — from the card's `fields.type`. */
   type?: string;
   /** Plain text content for non-card files. */
   content?: string;
diff --git a/callback-box/src/core/generate-docs-compile.ts b/callback-box/src/core/generate-docs-compile.ts
index 6e8c2a1a..ab0e6b3e 100644
--- a/callback-box/src/core/generate-docs-compile.ts
+++ b/callback-box/src/core/generate-docs-compile.ts
@@ -9,7 +9,7 @@
 
 import { join } from "node:path";
 import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
-import { parseCard } from "cardworks";
+import { loadCardFrontmatter } from "./frontmatter-field.js";
 import { parseGuide, parseGuideCard, compileGuide } from "../schemas/guide.js";
 import { compilePersonality, compileSpeakingVoice, type PersonalityFields } from "../schemas/personality.js";
 import { compileBriefing, type BriefingFields } from "../schemas/briefing.js";
@@ -42,26 +42,21 @@ export async function scanProcedures(boxRoot: string): Promise<ProcedureSummary[
   const results: ProcedureSummary[] = [];
 
   for (const filename of cards) {
-    try {
-      const content = await readFile(join(procedureDir, filename), "utf-8");
-      const root = await parseCard(content, { source: filename });
-      const name = root.attrs["name"] ?? filename.replace(".procedure.card", "");
-      const descEl = (root.children ?? []).find(
-        (c: { tagName?: string }) => c.tagName === "description"
-      );
-      const desc = (descEl as { text?: string })?.text?.trim() ?? "";
-      // Take just the first sentence/line for the compact index
-      const shortDesc = desc.split(/\n/)[0]?.replace(/\.\s.*/, ".").trim() || desc;
-      results.push({ name, filename, description: shortDesc });
-    } catch (e) {
-      // Skip unparseable procedure cards — still index them with a placeholder.
-      console.warn(`[generate-docs] could not parse procedure card ${filename}:`, e);
-      results.push({
-        name: filename.replace(".procedure.card", ""),
-        filename,
-        description: "(could not parse)",
-      });
+    const fallbackName = filename.replace(".procedure.card", "");
+    const fields = await loadCardFrontmatter(join(procedureDir, filename));
+    if (fields === null) {
+      // No readable frontmatter — index with a placeholder rather than dropping it.
+      console.warn(`[generate-docs] could not read procedure frontmatter ${filename}`);
+      results.push({ name: fallbackName, filename, description: "(could not parse)" });
+      continue;
     }
+    const nameField = fields["name"];
+    const name = typeof nameField === "string" && nameField !== "" ? nameField : fallbackName;
+    const descField = fields["description"];
+    const desc = typeof descField === "string" ? descField.trim() : "";
+    // Take just the first sentence/line for the compact index.
+    const shortDesc = desc.split(/\n/)[0]?.replace(/\.\s.*/, ".").trim() || desc;
+    results.push({ name, filename, description: shortDesc });
   }
 
   return results;
diff --git a/callback-box/src/core/generate-docs.ts b/callback-box/src/core/generate-docs.ts
index d31c3ead..4f7aedc3 100644
--- a/callback-box/src/core/generate-docs.ts
+++ b/callback-box/src/core/generate-docs.ts
@@ -13,7 +13,7 @@ import { execFile } from "node:child_process";
 import { PACKAGE_ROOT } from "../lib/package-root.js";
 import { promisify } from "node:util";
 import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
-import { schemas, cardSchemas, loadBoxSchemas } from "../schemas/registry.js";
+import { cardSchemas, loadBoxSchemas } from "../schemas/registry.js";
 import { generateViewsDoc } from "./views-doc.js";
 import { generateChatVoiceDoc } from "./chat-voice-doc.js";
 import { generateNarrationModeDoc } from "./narration-mode-doc.js";
@@ -312,7 +312,6 @@ interface DocWritePlan {
   boxRoot: string;
   debug: boolean;
   procedures: ProcedureSummary[];
-  allSchemas: typeof schemas;
   allCardSchemas: typeof cardSchemas;
   personalitySection: string | undefined;
 }
@@ -322,10 +321,10 @@ interface DocWritePlan {
  * connectors, views, voice, per-card-type, etc.) in parallel.
  */
 async function writeStaticDocs(plan: DocWritePlan): Promise<void> {
-  const { boxRoot, debug, procedures, allSchemas, allCardSchemas, personalitySection } = plan;
+  const { boxRoot, debug, procedures, allCardSchemas, personalitySection } = plan;
   await Promise.all([
     writeFile(join(boxRoot, AGENT_GUIDE_DIR, AGENT_GUIDE_FILE),
-      withDocId({ relativePath: `${AGENT_GUIDE_DIR}/${AGENT_GUIDE_FILE}`, content: generateAgentGuide({ procedures, allSchemas, personalitySection }), debug })),
+      withDocId({ relativePath: `${AGENT_GUIDE_DIR}/${AGENT_GUIDE_FILE}`, content: generateAgentGuide({ procedures, allCardSchemas, personalitySection }), debug })),
     writeFile(join(boxRoot, DOCS_DIR, "cb-commands.md"),
       withDocId({ relativePath: `${DOCS_DIR}/cb-commands.md`, content: generateCbCommands(), debug })),
     writeFile(join(boxRoot, DOCS_DIR, "connectors.md"),
@@ -340,27 +339,23 @@ async function writeStaticDocs(plan: DocWritePlan): Promise<void> {
       withDocId({ relativePath: `${DOCS_DIR}/procedures.md`, content: generateProcedureGuide(), debug })),
     writeFile(join(boxRoot, DOCS_DIR, "python-tools.md"),
       withDocId({ relativePath: `${DOCS_DIR}/python-tools.md`, content: generatePythonToolsDoc(), debug })),
-    // Per-schema generated docs cover both legacy XML schemas (ElementSchema
-    // with `tagName`) and phase-2 frontmatter schemas (CardSchema with
-    // `type`). Both expose an optional `instructions` field; only schemas
-    // that supply one get a doc written.
-    ...writeCardDocs({ boxRoot, debug, allSchemas, allCardSchemas }),
+    // Per-schema generated docs: each frontmatter schema with an optional
+    // `instructions` field gets a `card-<type>.md` doc.
+    ...writeCardDocs({ boxRoot, debug, allCardSchemas }),
   ]);
 }
 
 /**
- * Build the per-schema card-doc writes for every schema that supplies
- * `instructions` (both legacy XML and phase-2 frontmatter schemas).
+ * Build the per-schema card-doc writes for every frontmatter schema that
+ * supplies `instructions`.
  */
 function writeCardDocs(params: {
   boxRoot: string;
   debug: boolean;
-  allSchemas: typeof schemas;
   allCardSchemas: typeof cardSchemas;
 }): Array<Promise<void>> {
-  const { boxRoot, debug, allSchemas, allCardSchemas } = params;
+  const { boxRoot, debug, allCardSchemas } = params;
   return [
-    ...allSchemas.map((s) => ({ name: s.tagName, instructions: s.instructions })),
     ...allCardSchemas.map((s) => ({
       name: s.type,
       // Searchable types get the canonical contains: writing rule appended.
@@ -413,24 +408,21 @@ export async function generateDocs(boxRoot: string, options?: GenerateDocsOption
 
   const procedures = await scanProcedures(boxRoot);
 
-  // Load box-local schemas alongside built-in ones. Both formats are
-  // box-aware: legacy XML element schemas join allSchemas, phase-2
-  // frontmatter card schemas join allCardSchemas.
+  // Load box-local frontmatter schemas alongside built-in ones.
   const boxSchemas = await loadBoxSchemas(boxRoot);
-  const allSchemas = [...schemas, ...boxSchemas.elementSchemas];
   const allCardSchemas = [...cardSchemas, ...boxSchemas.cardSchemas];
 
   // Compile personality first so we can include it in the agent guide
   const personalitySection = await compilePersonalities(boxRoot, debug);
 
-  await writeStaticDocs({ boxRoot, debug, procedures, allSchemas, allCardSchemas, personalitySection });
+  await writeStaticDocs({ boxRoot, debug, procedures, allCardSchemas, personalitySection });
 
   // Compile guides and generate job-type rules
   const guides = await compileGuides(boxRoot, debug);
 
   // Rewrite agent guide now that we have guide summaries
   await writeFile(join(boxRoot, AGENT_GUIDE_DIR, AGENT_GUIDE_FILE),
-    withDocId({ relativePath: `${AGENT_GUIDE_DIR}/${AGENT_GUIDE_FILE}`, content: generateAgentGuide({ procedures, allSchemas, personalitySection, guides }), debug }));
+    withDocId({ relativePath: `${AGENT_GUIDE_DIR}/${AGENT_GUIDE_FILE}`, content: generateAgentGuide({ procedures, allCardSchemas, personalitySection, guides }), debug }));
 
   // Compile briefing cards to .md files
   const briefingPaths = await compileBriefings(boxRoot, debug);
diff --git a/callback-box/src/core/init-rules.ts b/callback-box/src/core/init-rules.ts
index 7daf6ab6..5db19802 100644
--- a/callback-box/src/core/init-rules.ts
+++ b/callback-box/src/core/init-rules.ts
@@ -10,7 +10,7 @@
 
 import { join } from "node:path";
 import { mkdir, writeFile, readdir, unlink } from "node:fs/promises";
-import { schemas, cardSchemas, loadBoxSchemas } from "../schemas/registry.js";
+import { cardSchemas, loadBoxSchemas } from "../schemas/registry.js";
 
 export interface ConnectorRule {
   /** Rule filename without .md extension, e.g. "connector-calendar" */
@@ -86,16 +86,12 @@ export async function generateRules(boxRoot: string): Promise<string[]> {
 
   const generated: string[] = [];
 
-  // Load box-local schemas alongside built-in ones. Card rules cover
-  // both legacy XML schemas (ElementSchema with `tagName`) and phase-2
-  // frontmatter schemas (CardSchema with `type`); each gets a
-  // path-conditional rule keyed off its filename glob so the agent
-  // loads the right instructions when it reads or edits a matching
+  // Load box-local schemas alongside built-in ones. Each card type (built-in
+  // or box-local) gets a path-conditional rule keyed off its filename glob so
+  // the agent loads the right instructions when it reads or edits a matching
   // `.<type>.card` file.
   const boxSchemas = await loadBoxSchemas(boxRoot);
   const cardRuleSources: Array<{ name: string; instructions: string | undefined }> = [
-    ...schemas.map((s) => ({ name: s.tagName, instructions: s.instructions })),
-    ...boxSchemas.elementSchemas.map((s) => ({ name: s.tagName, instructions: s.instructions })),
     ...cardSchemas.map((s) => ({ name: s.type, instructions: s.instructions })),
     ...boxSchemas.cardSchemas.map((s) => ({ name: s.type, instructions: s.instructions })),
   ];
diff --git a/callback-box/src/core/list-cards.ts b/callback-box/src/core/list-cards.ts
new file mode 100644
index 00000000..700584f8
--- /dev/null
+++ b/callback-box/src/core/list-cards.ts
@@ -0,0 +1,19 @@
+/**
+ * List the `.card` files in a box.
+ *
+ * Replaces the cardworks `CardLoader.listCards()` — a plain glob for `*.card`
+ * files, returning absolute paths, skipping the usual non-content directories.
+ */
+
+import { glob } from "glob";
+
+const CARD_GLOB_IGNORE = ["node_modules/**", ".git/**", "tmp/**", ".callback-box/**"];
+
+export async function listBoxCardFiles(boxRoot: string): Promise<string[]> {
+  return glob("**/*.card", {
+    cwd: boxRoot,
+    nodir: true,
+    absolute: true,
+    ignore: CARD_GLOB_IGNORE,
+  });
+}
diff --git a/callback-box/src/core/load-context.ts b/callback-box/src/core/load-context.ts
index 0cc2c042..5e0015ae 100644
--- a/callback-box/src/core/load-context.ts
+++ b/callback-box/src/core/load-context.ts
@@ -1,19 +1,12 @@
 /**
- * Build the LoadCardContext for a box: built-in frontmatter schemas plus
- * all element schemas (built-in and box-local). The one shared home for
- * what validate, the sdk hooks, and search each used to duplicate.
+ * Build the LoadCardContext for a box: the frontmatter card schemas (built-in
+ * + box-local), keyed by type. The one shared home for what validate, the sdk
+ * hooks, and search each used to duplicate.
  */
 
-import type { ElementSchema } from "cardworks";
 import type { LoadCardContext } from "./card-io.js";
-import { createCardSchemaMap, createSchemaRegistry } from "../schemas/registry.js";
+import { createCardSchemaMap } from "../schemas/registry.js";
 
 export async function buildLoadContext(boxRoot: string): Promise<LoadCardContext> {
-  const registry = await createSchemaRegistry(boxRoot);
-  const elementSchemas = new Map<string, ElementSchema>();
-  for (const tag of registry.tagNames()) {
-    const schema = registry.get(tag);
-    if (schema) elementSchemas.set(tag, schema as ElementSchema);
-  }
-  return { cardSchemas: await createCardSchemaMap(boxRoot), elementSchemas };
+  return { cardSchemas: await createCardSchemaMap(boxRoot) };
 }
diff --git a/callback-box/src/core/loader-registry.ts b/callback-box/src/core/loader-registry.ts
index f1054ad5..56fa392b 100644
--- a/callback-box/src/core/loader-registry.ts
+++ b/callback-box/src/core/loader-registry.ts
@@ -75,12 +75,12 @@ export const fallbackLoader: FileLoader<unknown> = (raw: LoaderInput) => ({
 
 /**
  * Find the matching loader for a file. Dispatch order:
- *   1. tagName exact match (input.element.tagName)
+ *   1. type exact match (input.type — the card's frontmatter type)
  *   2. path predicate match
  *   3. fallback
  */
 export function resolveLoader(input: LoaderInput): FileLoader<unknown> {
-  const tagName = input.type ?? (input.element ? input.element.tagName : undefined);
+  const tagName = input.type;
   if (tagName) {
     const match = registrations.find(r => r.kind === "tagName" && r.tagName === tagName);
     if (match) return match.loader;
diff --git a/callback-box/src/core/preactions/index.ts b/callback-box/src/core/preactions/index.ts
index ef9d34da..1d8082f8 100644
--- a/callback-box/src/core/preactions/index.ts
+++ b/callback-box/src/core/preactions/index.ts
@@ -7,18 +7,13 @@
  * - Extract text from images (OCR)
  * - Parse email attachments
  *
- * Pre-actions work against both shapes of card:
- * - Phase 1 XML-bodied cards (loaded via cardworks ICardLoader)
- * - Phase 2 frontmatter cards (loaded via card-io)
- *
- * The runner dispatches based on what `loadCardFile` returns; the
- * pre-action's `execute()` branches on `"xml" in ctx` vs
- * `"frontmatter" in ctx`.
+ * Pre-actions work against frontmatter cards (loaded via card-io). The runner
+ * loads the card, builds the context, and persists the (possibly mutated)
+ * fields back to disk when an action reports `modified`.
  */
 
 import { writeFile } from "node:fs/promises";
 import { stringify as stringifyYaml } from "yaml";
-import type { ICardLoader } from "cardworks";
 import type { PreAction, PreActionContext, PreActionResult } from "./types.js";
 import { loadCardFile } from "../card-io.js";
 import { buildLoadContext } from "../load-context.js";
@@ -47,11 +42,10 @@ export function getPreActionsForType(cardType: string): PreAction[] {
  */
 export async function runPreActions(input: {
   boxRoot: string;
-  loader: ICardLoader;
   cardPath: string;
 }): Promise<Array<{ name: string; result: PreActionResult }>> {
-  const { boxRoot, loader, cardPath } = input;
-  const ctx = await buildContext({ boxRoot, loader, cardPath });
+  const { boxRoot, cardPath } = input;
+  const ctx = await buildContext({ boxRoot, cardPath });
   if (ctx === null) return [];
 
   const applicable = getPreActionsForType(ctx.cardType);
@@ -88,31 +82,17 @@ export async function runPreActions(input: {
 
 async function buildContext(input: {
   boxRoot: string;
-  loader: ICardLoader;
   cardPath: string;
 }): Promise<PreActionContext | null> {
-  const { boxRoot, loader, cardPath } = input;
+  const { boxRoot, cardPath } = input;
 
-  // Try frontmatter (Phase 2) first; if the file isn't a CardSchema card
-  // it will fall through to the XML path on its own.
   try {
     const loaded = await loadCardFile(cardPath, await buildLoadContext(boxRoot));
-    if (loaded.kind === "frontmatter") {
-      return {
-        boxRoot,
-        loader,
-        cardPath,
-        cardType: loaded.schema.type,
-        frontmatter: { schema: loaded.schema, fields: loaded.fields },
-      };
-    }
-    // XML branch
     return {
       boxRoot,
-      loader,
       cardPath,
-      cardType: loaded.element.tagName,
-      xml: { card: await loader.load(cardPath) },
+      cardType: loaded.schema.type,
+      frontmatter: { schema: loaded.schema, fields: loaded.fields },
     };
   } catch (e) {
     // Couldn't load as a known card — skip pre-actions for this file.
@@ -122,11 +102,7 @@ async function buildContext(input: {
 }
 
 async function persistContext(ctx: PreActionContext): Promise<void> {
-  if ("xml" in ctx) {
-    await ctx.loader.save(ctx.xml.card);
-    return;
-  }
-  // Frontmatter path: rewrite the file with the (possibly mutated) fields.
+  // Rewrite the file with the (possibly mutated) fields.
   await writeFile(ctx.cardPath, `---\n${stringifyYaml(ctx.frontmatter.fields)}---\n`);
 }
 
diff --git a/callback-box/src/core/preactions/transcribe.ts b/callback-box/src/core/preactions/transcribe.ts
index a284f491..9f69d140 100644
--- a/callback-box/src/core/preactions/transcribe.ts
+++ b/callback-box/src/core/preactions/transcribe.ts
@@ -2,9 +2,8 @@
  * Transcribe voice content pre-action.
  *
  * Looks for cards with audio attachments and transcribes them via OpenAI
- * Whisper. Works on memo (Phase 2 frontmatter) and feedback (still
- * XML); the audio attachment lives as a sibling file sharing the card's
- * basename.
+ * Whisper. Works on memo and feedback cards (both frontmatter); the audio
+ * attachment lives as a sibling file sharing the card's basename.
  *
  * `audio` was historically handled here too; that path is dead now —
  * capture-session audio is transcribed by `cb transcribe-captures`
@@ -15,7 +14,6 @@ import * as fs from "node:fs/promises";
 import * as path from "node:path";
 import type { PreAction, PreActionContext } from "./types.js";
 import { transcribeAudio, type TranscriptionError } from "../transcription.js";
-import type { ElementNode } from "cardworks";
 
 /** Audio file extensions we can transcribe. */
 const AUDIO_EXTENSIONS = [".webm", ".mp3", ".m4a", ".wav", ".ogg", ".flac"];
@@ -40,15 +38,9 @@ export const transcribePreAction: PreAction = {
   async shouldRun(ctx: PreActionContext): Promise<boolean> {
     const audioFile = await findAudioAttachment(ctx.cardPath);
     if (audioFile === null) return false;
-    if ("frontmatter" in ctx) {
-      const fields = ctx.frontmatter.fields;
-      if (fields["transcription"] !== undefined) return false;
-      if (isPermanentError(fields["transcription-error"])) return false;
-      return true;
-    }
-    const element = ctx.xml.card.element;
-    if (hasXmlTranscription(element)) return false;
-    if (hasXmlPermanentError(element)) return false;
+    const fields = ctx.frontmatter.fields;
+    if (fields["transcription"] !== undefined) return false;
+    if (isPermanentError(fields["transcription-error"])) return false;
     return true;
   },
 
@@ -61,9 +53,7 @@ export const transcribePreAction: PreAction = {
     try {
       const audioBuffer = await fs.readFile(audioFile);
       const filename = path.basename(audioFile);
-      const existingContent = "frontmatter" in ctx
-        ? getFrontmatterContent(ctx.frontmatter.fields)
-        : getXmlContent(ctx.xml.card.element);
+      const existingContent = getFrontmatterContent(ctx.frontmatter.fields);
       const result = await transcribeAudio({
         audioBuffer,
         filename,
@@ -71,11 +61,7 @@ export const transcribePreAction: PreAction = {
         boxRoot: ctx.boxRoot,
       });
 
-      if ("frontmatter" in ctx) {
-        applyFrontmatterTranscription({ fields: ctx.frontmatter.fields, text: result.text, language: result.language });
-      } else {
-        applyXmlTranscription({ element: ctx.xml.card.element, text: result.text, language: result.language });
-      }
+      applyFrontmatterTranscription({ fields: ctx.frontmatter.fields, text: result.text, language: result.language });
 
       return {
         modified: true,
@@ -84,21 +70,12 @@ export const transcribePreAction: PreAction = {
     } catch (error) {
       const transcriptionError = error as TranscriptionError;
       const attemptedAt = new Date().toISOString();
-      if ("frontmatter" in ctx) {
-        applyFrontmatterError(ctx.frontmatter.fields, {
-          permanent: transcriptionError.permanent,
-          ...(transcriptionError.code !== undefined && { code: transcriptionError.code }),
-          "attempted-at": attemptedAt,
-          message: transcriptionError.message,
-        });
-      } else {
-        applyXmlError(ctx.xml.card.element, {
-          permanent: transcriptionError.permanent,
-          ...(transcriptionError.code !== undefined && { code: transcriptionError.code }),
-          attemptedAt,
-          message: transcriptionError.message,
-        });
-      }
+      applyFrontmatterError(ctx.frontmatter.fields, {
+        permanent: transcriptionError.permanent,
+        ...(transcriptionError.code !== undefined && { code: transcriptionError.code }),
+        "attempted-at": attemptedAt,
+        message: transcriptionError.message,
+      });
       return { modified: true, error: transcriptionError.message };
     }
   },
@@ -159,69 +136,3 @@ function applyFrontmatterError(
 ): void {
   fields["transcription-error"] = err;
 }
-
-// ─── XML (Phase 1) helpers ──────────────────────────────────────────────────
-
-function hasXmlTranscription(element: ElementNode): boolean {
-  const children = element.children;
-  return children.some((c) => c.tagName === "transcription");
-}
-
-function hasXmlPermanentError(element: ElementNode): boolean {
-  const errEl = element.children.find((c) => c.tagName === "transcription-error");
-  return errEl !== undefined && errEl.attrs["permanent"] === "true";
-}
-
-function getXmlContent(element: ElementNode): string | null {
-  const contentEl = element.children.find((c) => c.tagName === "content");
-  return contentEl?.text === undefined || contentEl.text === "" ? null : contentEl.text;
-}
-
-function applyXmlTranscription(input: {
-  element: ElementNode;
-  text: string;
-  language: string;
-}): void {
-  const { element, text, language } = input;
-  const children = element.children;
-  const errorIndex = children.findIndex((c) => c.tagName === "transcription-error");
-  if (errorIndex !== -1) {
-    children.splice(errorIndex, 1);
-  }
-  children.push({
-    tagName: "transcription",
-    attrs: { language, "transcribed-at": new Date().toISOString() },
-    children: [],
-    text,
-    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
-    comments: {},
-    dirty: true,
-  });
-  element.dirty = true;
-}
-
-function applyXmlError(
-  element: ElementNode,
-  err: { permanent: boolean; code?: string; attemptedAt: string; message: string },
-): void {
-  const children = element.children;
-  const errorIndex = children.findIndex((c) => c.tagName === "transcription-error");
-  if (errorIndex !== -1) {
-    children.splice(errorIndex, 1);
-  }
-  const attrs: Record<string, string> = {
-    permanent: err.permanent ? "true" : "false",
-    code: err.code ?? "unknown",
-    "attempted-at": err.attemptedAt,
-  };
-  children.push({
-    tagName: "transcription-error",
-    attrs,
-    children: [],
-    text: err.message,
-    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
-    comments: {},
-    dirty: true,
-  });
-  element.dirty = true;
-}
diff --git a/callback-box/src/core/preactions/types.ts b/callback-box/src/core/preactions/types.ts
index 480789e6..e686c669 100644
--- a/callback-box/src/core/preactions/types.ts
+++ b/callback-box/src/core/preactions/types.ts
@@ -1,14 +1,10 @@
-import type { Card, ICardLoader } from "cardworks";
 import type { CardSchema } from "../../cards/index.js";
 
 /**
- * Context for a pre-action invocation. Exactly one of `xml` or
- * `frontmatter` is present, depending on whether the card was loaded
- * via cardworks's XML loader (Phase 1) or via the frontmatter card-io
- * dispatcher (Phase 2).
+ * Context for a pre-action invocation. Cards are all frontmatter now, so the
+ * card's parsed schema + fields are always present.
  */
-export type PreActionContext = PreActionContextBase &
-  ({ xml: { card: Card } } | { frontmatter: PreActionFrontmatter });
+export type PreActionContext = PreActionContextBase & { frontmatter: PreActionFrontmatter };
 
 export interface PreActionFrontmatter {
   schema: CardSchema;
@@ -17,7 +13,6 @@ export interface PreActionFrontmatter {
 
 interface PreActionContextBase {
   boxRoot: string;
-  loader: ICardLoader;
   cardPath: string;
   cardType: string;
 }
@@ -42,9 +37,8 @@ export interface PreAction {
   shouldRun(context: PreActionContext): Promise<boolean>;
 
   /**
-   * Execute the pre-action. Implementations branch on
-   * `"xml" in context` vs `"frontmatter" in context` to mutate the
-   * right shape. The runner persists the result.
+   * Execute the pre-action — mutate `context.frontmatter.fields` in place.
+   * The runner persists the result when `modified` is true.
    */
   execute(context: PreActionContext): Promise<PreActionResult>;
 }
diff --git a/callback-box/src/core/reactor/batch-jobs.ts b/callback-box/src/core/reactor/batch-jobs.ts
index 768b5dc1..bb38cf95 100644
--- a/callback-box/src/core/reactor/batch-jobs.ts
+++ b/callback-box/src/core/reactor/batch-jobs.ts
@@ -8,7 +8,7 @@
 
 import * as path from "node:path";
 import * as fs from "node:fs/promises";
-import { schemas } from "../../schemas/registry.js";
+import { cardSchemas } from "../../schemas/registry.js";
 import { ensureAgentCommitted, captureBaseline } from "../agent.js";
 import { buildReactorSystemPrompt, buildReactorUserPrompt } from "./prompts.js";
 import type { ProcessJobsOptions, JobWithContent } from "./types.js";
@@ -121,9 +121,9 @@ function extractRootTag(xmlContent: string): string | null {
 }
 
 /**
- * Look up schema instructions for a given root tag name.
+ * Look up schema instructions for a given card type.
  */
-function getSchemaInstructions(tagName: string): string | null {
-  const schema = schemas.find((s) => s.tagName === tagName);
+function getSchemaInstructions(type: string): string | null {
+  const schema = cardSchemas.find((s) => s.type === type);
   return schema?.instructions ?? null;
 }
diff --git a/callback-box/src/core/ref-exists.ts b/callback-box/src/core/ref-exists.ts
new file mode 100644
index 00000000..721acc8d
--- /dev/null
+++ b/callback-box/src/core/ref-exists.ts
@@ -0,0 +1,79 @@
+/**
+ * Frontmatter-card ref existence check.
+ *
+ * Replaces cardworks' `loader.resolveRef` for the lint broken-ref walk
+ * (card-lint.ts): given a ref string written in a card, resolve it to a
+ * filesystem path and report whether the target exists. The card-lint
+ * dispatcher already extracts the refs itself (`extractRefs` over frontmatter,
+ * `extractBodyRefs` over the Markdoc body); this only answers "does it exist".
+ *
+ * Mirrors cardworks' ref semantics (refs/parse-ref.ts + refs/resolve.ts) so the
+ * broken-ref warnings match what the XML loader produced:
+ *  - a `#fragment` suffix is ignored for existence
+ *  - an `@version`-like suffix (`@1.2.3`, `@v2`) is stripped before resolving
+ *    (a bare `@` mid-filename is left alone)
+ *  - box-root-absolute refs (`/box/…`) resolve against the box root
+ *  - `attach/<rest>` (and bare `attach`) resolve into the referring card's
+ *    `<basename>.attach/` scope
+ *  - everything else resolves relative to the referring card's directory
+ */
+
+import { access } from "node:fs/promises";
+import { dirname, resolve } from "node:path";
+import { isAttachRef, resolveAttachRef } from "../shared/attach-path.js";
+
+interface RefExistsInput {
+  /** The raw ref string as written in the card (may carry `@version`/`#fragment`). */
+  ref: string;
+  /** Absolute path of the card the ref was written in. */
+  fromPath: string;
+  /** Absolute box root, used to resolve box-root-absolute (`/…`) refs. */
+  boxRoot: string;
+}
+
+/**
+ * Strip the `@version` and `#fragment` suffixes, returning the bare path
+ * component — the same split cardworks' parseRef performs. The version is only
+ * stripped when it looks version-like (`@1.x`, `@v2`), so an `@` inside a
+ * filename isn't mistaken for a version delimiter.
+ */
+function refPathComponent(ref: string): string {
+  let remaining = ref;
+  const hashIndex = remaining.indexOf("#");
+  if (hashIndex !== -1) remaining = remaining.slice(0, hashIndex);
+  const atIndex = remaining.lastIndexOf("@");
+  if (atIndex !== -1) {
+    const afterAt = remaining.slice(atIndex + 1);
+    if (/^v?\d/.test(afterAt)) remaining = remaining.slice(0, atIndex);
+  }
+  return remaining;
+}
+
+/** Resolve a ref to the absolute filesystem path it points at. */
+function resolveRefToPath(input: RefExistsInput): string {
+  const refPath = refPathComponent(input.ref);
+  if (refPath.startsWith("/")) return input.boxRoot + refPath;
+  if (isAttachRef(refPath)) {
+    const attachResolved = resolveAttachRef(input.fromPath, refPath);
+    if (attachResolved !== null) return attachResolved;
+  }
+  return resolve(dirname(input.fromPath), refPath);
+}
+
+/**
+ * Whether the card-to-card (or card-to-attachment) ref points at a file that
+ * exists. A non-ENOENT access failure is logged and treated as "does not
+ * exist" — the lint walk surfaces it as a broken-ref warning either way.
+ */
+export async function resolveRefExists(input: RefExistsInput): Promise<boolean> {
+  const target = resolveRefToPath(input);
+  try {
+    await access(target);
+    return true;
+  } catch (e) {
+    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
+      console.warn(`resolveRefExists: access failed for ${target}`, e);
+    }
+    return false;
+  }
+}
diff --git a/callback-box/src/core/sdk-hooks.ts b/callback-box/src/core/sdk-hooks.ts
index 554de313..2a2898cb 100644
--- a/callback-box/src/core/sdk-hooks.ts
+++ b/callback-box/src/core/sdk-hooks.ts
@@ -14,7 +14,6 @@ import type {
 import { formatLintResults } from "../cards/index.js";
 import { lint as markdownlint } from "markdownlint/promise";
 import { noViewLabelLinks, noBrokenInternalLinks } from "./markdown-lint-rules.js";
-import { createLoader } from "../cli/lib/loader.js";
 import { lintCardsDispatch } from "./card-lint.js";
 import { buildLoadContext } from "./load-context.js";
 
@@ -106,9 +105,8 @@ async function runMarkdownLint(filePath: string): Promise<string | null> {
 
 async function runCardLint(cwd: string, filePath: string): Promise<string | null> {
   try {
-    const loader = await createLoader(cwd);
     const ctx = await buildLoadContext(cwd);
-    const summary = await lintCardsDispatch([filePath], { loader, ctx });
+    const summary = await lintCardsDispatch([filePath], { boxRoot: cwd, ctx });
     if (summary.totalErrors === 0 && summary.totalWarnings === 0) return null;
     const formatted = formatLintResults(summary, { colors: false });
     return `Card validation warning for ${filePath}:\n${formatted}`;
diff --git a/callback-box/src/core/search/extract.ts b/callback-box/src/core/search/extract.ts
index e8eaa571..5f264379 100644
--- a/callback-box/src/core/search/extract.ts
+++ b/callback-box/src/core/search/extract.ts
@@ -16,8 +16,7 @@
  * agent-written `contains`.
  */
 
-import type { ElementNode } from "cardworks";
-import type { LoadedCard, FrontmatterLoadedCard, XmlLoadedCard } from "../card-io.js";
+import type { LoadedCard, FrontmatterLoadedCard } from "../card-io.js";
 import { resolveAttachRef } from "../../shared/attach-path.js";
 import { titleFromFilename, truncateTitle } from "../file-summary.js";
 import { splitMarkdownSections } from "./markdown-sections.js";
@@ -75,7 +74,6 @@ export function effectiveContains(kind: string, fields: Record<string, unknown>)
  */
 export function declareInputFiles(input: { path: string; card: LoadedCard }): string[] {
   const { path, card } = input;
-  if (card.kind !== "frontmatter") return [];
   if (card.schema.type !== "gdoc") return [];
   const content = card.fields["content"];
   const ref = isRefObject(content) ? content.ref : undefined;
@@ -100,8 +98,6 @@ export interface ExtractInput {
  */
 export function extractCardDocs(input: ExtractInput): SearchDoc[] {
   const { path, card, contentHash } = input;
-  if (card.kind === "xml") return [xmlDoc(path, { card, contentHash })];
-
   const fields = card.fields;
   const kind = card.schema.type;
   const fold = foldFields(kind, fields);
@@ -266,54 +262,6 @@ function foldFields(kind: string, fields: Record<string, unknown>): FoldResult {
   }
 }
 
-function xmlDoc(path: string, input: { card: XmlLoadedCard; contentHash: string }): SearchDoc {
-  const { card, contentHash } = input;
-  const attrs = card.element.attrs;
-  const title = truncateTitle(
-    firstNonEmpty([str(attrs["title"]), str(attrs["name"]), titleFromFilename(path)]),
-    TITLE_MAX
-  );
-  return {
-    id: docId(path, ""),
-    path,
-    fragment: "",
-    kind: card.element.tagName,
-    title,
-    contains: "",
-    content: normalizeContent(collectElementText(card.element)),
-    created: "",
-    contentHash,
-  };
-}
-
-/** Collect all text content from an XML element tree (text, mixed, children). */
-function collectElementText(node: ElementNode): string {
-  const parts: string[] = [];
-  const visit = (n: ElementNode): void => {
-    if (typeof n.text === "string" && n.text.trim() !== "") parts.push(n.text);
-    if (Array.isArray(n.mixed)) {
-      for (const m of n.mixed) {
-        if (typeof m === "string") parts.push(m);
-        else if (isElementNode(m)) visit(m);
-      }
-    }
-    for (const child of n.children) {
-      if (isElementNode(child)) visit(child);
-    }
-  };
-  visit(node);
-  return parts.join(" ").replace(/\s+/g, " ").trim();
-}
-
-function isElementNode(value: unknown): value is ElementNode {
-  return (
-    typeof value === "object"
-    && value !== null
-    && "tagName" in value
-    && "children" in value
-  );
-}
-
 function isRefObject(value: unknown): value is { ref: string } {
   return (
     typeof value === "object"
diff --git a/callback-box/src/core/state.ts b/callback-box/src/core/state.ts
index abaf1486..f5c082a3 100644
--- a/callback-box/src/core/state.ts
+++ b/callback-box/src/core/state.ts
@@ -88,27 +88,15 @@ async function scanCards(params: ScanCardsParams): Promise<CardInfo[]> {
 
     try {
       const loaded = await loadCardFile(fullPath, ctx);
-      if (loaded.kind === "frontmatter") {
-        cards.push({
-          path: fullPath,
-          relativePath: path.relative(boxRoot, fullPath),
-          name: parsed.name,
-          type: parsed.type,
-          tagName: loaded.schema.type,
-          status: typeof loaded.fields["status"] === "string" ? loaded.fields["status"] : undefined,
-          subdir,
-        });
-      } else {
-        cards.push({
-          path: fullPath,
-          relativePath: path.relative(boxRoot, fullPath),
-          name: parsed.name,
-          type: parsed.type,
-          tagName: loaded.element.tagName,
-          status: loaded.element.attrs["status"],
-          subdir,
-        });
-      }
+      cards.push({
+        path: fullPath,
+        relativePath: path.relative(boxRoot, fullPath),
+        name: parsed.name,
+        type: parsed.type,
+        tagName: loaded.schema.type,
+        status: typeof loaded.fields["status"] === "string" ? loaded.fields["status"] : undefined,
+        subdir,
+      });
     } catch (e) {
       console.warn(`Could not load card ${fullPath}, listing as unknown:`, e);
       cards.push({
diff --git a/callback-box/src/dev/prompt-report.ts b/callback-box/src/dev/prompt-report.ts
index a675549b..930bee6f 100644
--- a/callback-box/src/dev/prompt-report.ts
+++ b/callback-box/src/dev/prompt-report.ts
@@ -10,7 +10,7 @@
 
 import * as fs from "node:fs/promises";
 import * as path from "node:path";
-import { schemas } from "../schemas/registry.js";
+import { cardSchemas } from "../schemas/registry.js";
 import { buildReactorSystemPrompt, buildReactorUserPrompt } from "../core/reactor/prompts.js";
 import { CHAT_SYSTEM_PROMPT } from "../core/chat-session.js";
 import { buildThreadSystemPrompt } from "../core/chat-thread-session.js";
@@ -96,12 +96,12 @@ async function collectPrompts(): Promise<PromptEntry[]> {
 
   // ── 2. Schema instructions ───────────────────────────────────────
 
-  for (const schema of schemas) {
+  for (const schema of cardSchemas) {
     if (!schema.instructions) continue;
     entries.push({
-      title: `Schema: ${schema.tagName}`,
-      source: `src/schemas/ → ${schema.tagName} schema instructions`,
-      scope: `Injected into agent context when processing a \`*.${schema.tagName}.card\` file. Delivered two ways: (1) appended to the job description in batch processing, and (2) auto-loaded as a .claude/rules/ file (generated when \`cb init\` runs) matching \`**/*.${schema.tagName}.card\`.`,
+      title: `Schema: ${schema.type}`,
+      source: `src/schemas/ → ${schema.type} schema instructions`,
+      scope: `Injected into agent context when processing a \`*.${schema.type}.card\` file. Delivered two ways: (1) appended to the job description in batch processing, and (2) auto-loaded as a .claude/rules/ file (generated when \`cb init\` runs) matching \`**/*.${schema.type}.card\`.`,
       text: schema.instructions,
     });
   }
diff --git a/callback-box/src/schemas/index.ts b/callback-box/src/schemas/index.ts
index a3debea7..b00efe4d 100644
--- a/callback-box/src/schemas/index.ts
+++ b/callback-box/src/schemas/index.ts
@@ -4,8 +4,6 @@
 
 // Re-export everything from the registry
 export {
-  schemas,
-  createSchemaRegistry,
   getCardTypes,
   isKnownCardType,
   MemoSchema,
diff --git a/callback-box/src/schemas/registry.ts b/callback-box/src/schemas/registry.ts
index 93937f0a..252c7320 100644
--- a/callback-box/src/schemas/registry.ts
+++ b/callback-box/src/schemas/registry.ts
@@ -11,7 +11,6 @@ import { join } from "node:path";
 import { pathToFileURL } from "node:url";
 import { registerHooks } from "node:module";
 import { PACKAGE_ROOT } from "../lib/package-root.js";
-import { SchemaRegistry, type ElementSchema } from "cardworks";
 import { type CardSchema } from "../cards/index.js";
 import { MemoSchema } from "./memo.js";
 import { QuestionSchema } from "./question.js";
@@ -49,15 +48,8 @@ import { LandmarkSchema } from "./landmark.js";
 import { registerTemplate, type TemplateDefinition } from "./templates.js";
 
 /**
- * Built-in XML (legacy `element()`) card schemas. Now empty — every schema
- * has migrated to the frontmatter form below. The array and the XML loader
- * path remain until cardworks itself is removed in a follow-up.
- */
-export const schemas: ElementSchema[] = [];
-
-/**
- * Phase-2 markdown-frontmatter card schemas. Loaded into a separate
- * Map<type, CardSchema> by createCardSchemaMap below.
+ * Markdown-frontmatter card schemas. Loaded into a Map<type, CardSchema> by
+ * createCardSchemaMap below.
  */
 export const cardSchemas: CardSchema[] = [
   CaptureSessionSchema,
@@ -102,15 +94,13 @@ export const cardSchemas: CardSchema[] = [
  * - `zod` — peer dependency every schema needs.
  * - `yaml` — frontmatter card templates `stringify` their fields with it (the
  *   scaffolding in box-templates.ts shows exactly this).
- * - `cardworks` — legacy alias, still resolvable while boxes migrate their
- *   schema files to `callback-box/cards`; goes away with cardworks itself.
  */
-const SCHEMA_DEPS = new Set(["callback-box", "zod", "yaml", "cardworks"]);
+const SCHEMA_DEPS = new Set(["callback-box", "zod", "yaml"]);
 
 /**
  * Virtual parent URL at callback-box's package root (NOT inside
  * node_modules). Rewriting a box schema's parentURL to this makes Node
- * resolve bare deps (`zod`, `cardworks`) from callback-box's node_modules
+ * resolve bare deps (`zod`, `yaml`) from callback-box's node_modules
  * AND self-references (`callback-box/cards`) via callback-box's own
  * `exports` map. Pointing it *inside* node_modules would break the
  * self-reference: Node's LOOKUP_PACKAGE_SCOPE returns null at a
@@ -121,9 +111,9 @@ const CB_VIRTUAL_PARENT = pathToFileURL(join(PACKAGE_ROOT, "_virtual.js")).href;
 
 /**
  * Register module resolution hooks so that box-local schema files
- * (under config/schemas/) can import `callback-box/cards`, `zod`, and the
- * legacy `cardworks` alias even though none of those resolve from the
- * box's own node_modules.
+ * (under config/schemas/) can import `callback-box/cards`, `zod`, and
+ * `yaml` even though none of those resolve from the box's own
+ * node_modules.
  *
  * Uses Node's synchronous registerHooks API which chains correctly
  * with tsx's async loader hooks.
@@ -172,16 +162,11 @@ async function ensureEsmPackageJson(schemasDir: string): Promise<void> {
 
 /**
  * Box-local schemas, segregated by format. A box's `config/schemas/*.ts`
- * files may default-export either a frontmatter `cardSchema()` (the default
- * for new card types) or a legacy XML `element()` schema; we branch on the
- * discriminator (`.type` vs `.tagName`) and keep the two kinds apart so each
- * flows into the right runtime map.
+ * files default-export a frontmatter `cardSchema()`.
  */
 export interface BoxSchemas {
-  /** Frontmatter card schemas (cardworks CardSchema, keyed by `.type`). */
+  /** Frontmatter card schemas (CardSchema, keyed by `.type`). */
   cardSchemas: CardSchema[];
-  /** Legacy XML element schemas (cardworks ElementSchema, keyed by `.tagName`). */
-  elementSchemas: ElementSchema[];
 }
 
 /**
@@ -199,10 +184,8 @@ const boxSchemaCache = new Map<string, BoxSchemas>();
 /**
  * Load box-local schemas from config/schemas/*.ts.
  *
- * Each file should default-export either a frontmatter `cardSchema()` or a
- * legacy XML `element()` schema. Optionally it can also export a `template`
- * (TemplateDefinition) for `cb create` — registered the same way regardless
- * of schema kind.
+ * Each file should default-export a frontmatter `cardSchema()`. Optionally it
+ * can also export a `template` (TemplateDefinition) for `cb create`.
  *
  * Errors in individual files are logged as warnings, not fatal.
  */
@@ -216,7 +199,7 @@ export async function loadBoxSchemas(boxRoot: string): Promise<BoxSchemas> {
 }
 
 async function loadBoxSchemasUncached(boxRoot: string): Promise<BoxSchemas> {
-  const empty: BoxSchemas = { cardSchemas: [], elementSchemas: [] };
+  const empty: BoxSchemas = { cardSchemas: [] };
   const schemasDir = join(boxRoot, "config/schemas");
   let files: string[];
   try {
@@ -232,11 +215,10 @@ async function loadBoxSchemasUncached(boxRoot: string): Promise<BoxSchemas> {
   if (tsFiles.length === 0) return empty;
 
   const loadedCard: CardSchema[] = [];
-  const loadedElement: ElementSchema[] = [];
 
   // Ensure package.json with "type": "module" so .ts files load as ESM,
-  // and register resolve hooks so bare specifiers (cardworks, zod) resolve
-  // from callback-box's node_modules.
+  // and register resolve hooks so bare specifiers (callback-box/cards, zod,
+  // yaml) resolve from callback-box's node_modules.
   await ensureEsmPackageJson(schemasDir);
   ensureResolveHooks();
 
@@ -246,17 +228,10 @@ async function loadBoxSchemasUncached(boxRoot: string): Promise<BoxSchemas> {
       const mod = await import(pathToFileURL(filePath).href);
       const def: unknown = mod.default;
 
-      // Branch on the discriminator. ElementSchema (legacy XML) is a cardworks
-      // Zod type carrying `.tagName`; check it first, because ElementSchema also
-      // inherits a string `.type` from ZodType, so a `.type`-only check would
-      // misclassify it. CardSchema (frontmatter) is a plain object identified by
-      // its `.frontmatterSchema`.
-      if (isElementSchema(def)) {
-        loadedElement.push(def);
-      } else if (isCardSchema(def)) {
+      if (isCardSchema(def)) {
         loadedCard.push(def);
       } else {
-        console.warn(`Warning: ${file} does not export a default cardSchema() or element(), skipping`);
+        console.warn(`Warning: ${file} does not export a default cardSchema(), skipping`);
         continue;
       }
 
@@ -268,11 +243,7 @@ async function loadBoxSchemasUncached(boxRoot: string): Promise<BoxSchemas> {
     }
   }
 
-  return { cardSchemas: loadedCard, elementSchemas: loadedElement };
-}
-
-function isElementSchema(def: unknown): def is ElementSchema {
-  return typeof def === "object" && def !== null && typeof (def as ElementSchema).tagName === "string";
+  return { cardSchemas: loadedCard };
 }
 
 function isCardSchema(def: unknown): def is CardSchema {
@@ -285,43 +256,10 @@ function isCardSchema(def: unknown): def is CardSchema {
 }
 
 /**
- * Create a SchemaRegistry populated with all known schemas.
- *
- * If boxRoot is provided, also loads box-local schemas from config/schemas/.
- */
-export async function createSchemaRegistry(boxRoot?: string): Promise<SchemaRegistry> {
-  const registry = new SchemaRegistry();
-  for (const schema of schemas) {
-    registry.register(schema);
-  }
-  if (boxRoot) {
-    const { elementSchemas } = await loadBoxSchemas(boxRoot);
-    for (const schema of elementSchemas) {
-      registry.register(schema);
-    }
-  }
-  return registry;
-}
-
-/**
- * Get all schemas (built-in + box-local).
- *
- * If boxRoot is provided, includes box-local schemas.
- */
-export async function getAllSchemas(boxRoot?: string): Promise<ElementSchema[]> {
-  if (!boxRoot) return schemas;
-  const { elementSchemas } = await loadBoxSchemas(boxRoot);
-  return [...schemas, ...elementSchemas];
-}
-
-/**
- * Get the list of known card types.
+ * Get the list of known card types (built-in frontmatter schemas).
  */
 export function getCardTypes(): string[] {
-  return [
-    ...schemas.map(s => s.tagName),
-    ...cardSchemas.map(s => s.type),
-  ];
+  return cardSchemas.map(s => s.type);
 }
 
 /**
@@ -330,23 +268,16 @@ export function getCardTypes(): string[] {
  * when a boxRoot is given (they default to searchable).
  */
 export async function getSearchableTypes(boxRoot?: string): Promise<string[]> {
-  const elementSchemas = await getAllSchemas(boxRoot);
   const boxCardSchemas = boxRoot ? (await loadBoxSchemas(boxRoot)).cardSchemas : [];
   const allCardSchemas = [...cardSchemas, ...boxCardSchemas];
-  return [
-    ...elementSchemas.filter(s => s.searchable !== false).map(s => s.tagName),
-    ...allCardSchemas.filter(s => s.searchable).map(s => s.type),
-  ];
+  return allCardSchemas.filter(s => s.searchable).map(s => s.type);
 }
 
 /**
  * Check if a card type is known.
  */
 export function isKnownCardType(type: string): boolean {
-  return (
-    schemas.some(s => s.tagName === type)
-    || cardSchemas.some(s => s.type === type)
-  );
+  return cardSchemas.some(s => s.type === type);
 }
 
 /**
diff --git a/callback-box/src/webapp/routes/api-browse.ts b/callback-box/src/webapp/routes/api-browse.ts
index d783db62..3d2e7567 100644
--- a/callback-box/src/webapp/routes/api-browse.ts
+++ b/callback-box/src/webapp/routes/api-browse.ts
@@ -9,7 +9,7 @@
 import type { FastifyInstance } from "fastify";
 import * as fs from "node:fs/promises";
 import * as path from "node:path";
-import { createLoader } from "../../cli/lib/loader.js";
+import { loadCardFrontmatter } from "../../core/frontmatter-field.js";
 import { parseCardName } from "../../cli/lib/paths.js";
 
 interface BrowseCard {
@@ -60,8 +60,6 @@ export function registerApiBrowseRoutes(options: RegisterApiBrowseRoutesOptions)
       const dirs: string[] = [];
       const cards: BrowseCard[] = [];
 
-      const loader = await createLoader(boxRoot);
-
       // Build basename → owning-card lookup so we can fold `<basename>.attach/`
       // directories into their owning cards (rendered as navigable cards, not
       // as standalone directories).
@@ -99,26 +97,18 @@ export function registerApiBrowseRoutes(options: RegisterApiBrowseRoutesOptions)
           (e) => e.isDirectory() && e.name === attachDirName,
         );
 
-        try {
-          const card = await loader.load(fullPath);
-          cards.push({
-            relativePath,
-            name: parsed.name,
-            type: parsed.type,
-            tagName: card.element.tagName,
-            status: card.element.attrs["status"],
-            hasAttachments,
-          });
-        } catch (e) {
-          console.warn(`Could not load card for browse listing, marking unknown: ${relativePath}:`, e);
-          cards.push({
-            relativePath,
-            name: parsed.name,
-            type: parsed.type,
-            tagName: "unknown",
-            hasAttachments,
-          });
-        }
+        const fm = await loadCardFrontmatter(fullPath);
+        const status = fm !== null && typeof fm["status"] === "string" ? fm["status"] : undefined;
+        cards.push({
+          relativePath,
+          name: parsed.name,
+          type: parsed.type,
+          // The filename type is the discriminator; a card that won't parse is
+          // marked unknown.
+          tagName: fm === null ? "unknown" : parsed.type,
+          ...(status !== undefined && { status }),
+          hasAttachments,
+        });
       }
 
       dirs.sort();
diff --git a/callback-box/src/webapp/routes/api-card-patch.ts b/callback-box/src/webapp/routes/api-card-patch.ts
deleted file mode 100644
index 741da268..00000000
--- a/callback-box/src/webapp/routes/api-card-patch.ts
+++ /dev/null
@@ -1,48 +0,0 @@
-/**
- * Element-sanitization helper for the REST API's `GET /api/card/*` route.
- *
- * Converts a cardworks `ElementNode` (legacy XML card tree) into a
- * JSON-safe structure for the frontend. The patch helpers that once lived
- * here went away with the unused `card.patch` endpoint.
- */
-
-import type { ElementNode } from "cardworks";
-
-/**
- * JSON-safe element node for the frontend.
- */
-export interface JsonElement {
-  tagName: string;
-  attrs: Record<string, string>;
-  text?: string;
-  children?: JsonElement[];
-}
-
-/**
- * Convert an ElementNode to a JSON-safe structure.
- */
-export function sanitizeElement(el: ElementNode): JsonElement {
-  const result: JsonElement = {
-    tagName: el.tagName,
-    attrs: {},
-  };
-
-  // Copy string attributes only
-  for (const [key, value] of Object.entries(el.attrs)) {
-    if (typeof value === "string") {
-      result.attrs[key] = value;
-    }
-  }
-
-  // Include text if present
-  if (el.text !== undefined && el.text !== null) {
-    result.text = String(el.text).trim();
-  }
-
-  // Recursively process children
-  if (el.children && Array.isArray(el.children) && el.children.length > 0) {
-    result.children = el.children.map((child) => sanitizeElement(child as ElementNode));
-  }
-
-  return result;
-}
diff --git a/callback-box/src/webapp/routes/api-card-routes.ts b/callback-box/src/webapp/routes/api-card-routes.ts
deleted file mode 100644
index 57d717c9..00000000
--- a/callback-box/src/webapp/routes/api-card-routes.ts
+++ /dev/null
@@ -1,64 +0,0 @@
-/**
- * Single-card read route for the REST API.
- *
- * Split out of `api.ts`. Owns the legacy XML read endpoint:
- *
- *   GET /api/card/* — load a card, return its xml + sanitized element tree
- *
- * The element-sanitization helper lives in `api-card-patch.ts`.
- */
-
-import type { FastifyInstance } from "fastify";
-import * as path from "node:path";
-import { createLoader } from "../../cli/lib/loader.js";
-import { sanitizeElement } from "./api-card-patch.js";
-
-interface RegisterApiCardRoutesOptions {
-  server: FastifyInstance;
-  boxRoot: string;
-}
-
-/**
- * Register the `/api/card/*` GET + PATCH routes on the Fastify server.
- */
-export function registerApiCardRoutes(options: RegisterApiCardRoutesOptions): void {
-  const { server, boxRoot } = options;
-
-  // GET /api/card/:path - Get a single card's content
-  server.get<{ Params: { "*": string }; Querystring: { format?: string } }>(
-    "/api/card/*",
-    async (request, reply) => {
-      const cardPath = request.params["*"];
-      if (!cardPath) {
-        return reply.status(400).send({ error: "Card path required" });
-      }
-
-      const fullPath = path.join(boxRoot, cardPath);
-      const loader = await createLoader(boxRoot);
-
-      try {
-        const card = await loader.load(fullPath);
-        const xml = loader.serialize(card.element);
-
-        // Include element tree for tree view rendering
-        const element = sanitizeElement(card.element);
-
-        return {
-          path: cardPath,
-          tagName: card.element.tagName,
-          status: card.element.attrs["status"],
-          version: card.version,
-          xml,
-          element,
-        };
-      } catch (error) {
-        const msg = (error as Error).message;
-        const isNotFound = msg.includes("ENOENT") || msg.includes("no such file");
-        return reply.status(isNotFound ? 404 : 422).send({
-          error: isNotFound ? `Card not found: ${cardPath}` : `Card validation failed: ${cardPath}`,
-          details: msg,
-        });
-      }
-    }
-  );
-}
diff --git a/callback-box/src/webapp/routes/api.ts b/callback-box/src/webapp/routes/api.ts
index 1dc859ee..15e7c61a 100644
--- a/callback-box/src/webapp/routes/api.ts
+++ b/callback-box/src/webapp/routes/api.ts
@@ -5,7 +5,6 @@
  * inbox, questions, activity, context, task-output) and wires up the larger,
  * self-contained route families that live in sibling modules:
  *
- *   api-card-routes.ts — GET /api/card/* (helpers in api-card-patch.ts)
  *   api-browse.ts      — GET /api/browse/*
  *   api-files.ts       — GET/HEAD + DELETE /api/files/*
  *   api-debug-log.ts   — GET/POST/DELETE /api/debug-log
@@ -19,7 +18,6 @@ import { generateContext } from "../context.js";
 import { runHealthChecks } from "../trpc/routers/health.js";
 import { getLog } from "../../cli/lib/git.js";
 import type { EventBus } from "../../core/event-bus.js";
-import { registerApiCardRoutes } from "./api-card-routes.js";
 import { registerApiBrowseRoutes } from "./api-browse.js";
 import { registerApiFilesRoutes } from "./api-files.js";
 import { registerProxyImageRoutes } from "./proxy-image.js";
@@ -95,9 +93,6 @@ export async function registerApiRoutes(
     };
   });
 
-  // /api/card/* — load a single card
-  registerApiCardRoutes({ server, boxRoot });
-
   // GET /api/activity - Recent git commits (renamed from /api/log to avoid ad blockers)
   server.get<{ Querystring: { count?: string } }>("/api/activity", async (request) => {
     const count = parseInt(request.query.count ?? "10", 10);
diff --git a/callback-box/src/webapp/routes/views.ts b/callback-box/src/webapp/routes/views.ts
index ada76ca0..ef60f863 100644
--- a/callback-box/src/webapp/routes/views.ts
+++ b/callback-box/src/webapp/routes/views.ts
@@ -11,36 +11,18 @@ import * as path from "node:path";
 import { glob } from "glob";
 import { promises as fs } from "node:fs";
 import { compileView, listViews, buildErrorModule } from "../views/compiler.js";
-import { createLoader } from "../../cli/lib/loader.js";
 import { loadCardFile } from "../../core/card-io.js";
 import { buildLoadContext } from "../../core/load-context.js";
 import { getStatus, isRepo } from "../../cli/lib/git.js";
 import { fileEtag } from "../file-etag.js";
 import { attachDirFor } from "../../shared/attach-path.js";
-import type { ViewCard, ViewCardChild, ViewFile } from "../../types/views.js";
-import type { ElementNode } from "cardworks";
+import type { ViewCard, ViewFile } from "../../types/views.js";
 
 interface RegisterViewRoutesOptions {
   server: FastifyInstance;
   boxRoot: string;
 }
 
-function elementToViewCardChild(el: ElementNode): ViewCardChild {
-  const result: ViewCardChild = {
-    tagName: el.tagName,
-    attrs: el.attrs,
-  };
-  if (el.text) {
-    result.text = el.text;
-  }
-  if (el.children && el.children.length > 0) {
-    result.children = el.children
-      .filter((c): c is ElementNode => typeof c !== "string" && "tagName" in c)
-      .map(elementToViewCardChild);
-  }
-  return result;
-}
-
 export async function registerViewRoutes(options: RegisterViewRoutesOptions): Promise<void> {
   const { server, boxRoot } = options;
 
@@ -104,7 +86,6 @@ export async function registerViewRoutes(options: RegisterViewRoutesOptions): Pr
         }
       }
 
-      const loader = await createLoader(boxRoot);
       const ctx = await buildLoadContext(boxRoot);
       const cards: ViewCard[] = [];
 
@@ -112,10 +93,7 @@ export async function registerViewRoutes(options: RegisterViewRoutesOptions): Pr
         try {
           const absPath = path.join(boxRoot, relPath);
           const loaded = await loadCardFile(absPath, ctx);
-          const viewCard =
-            loaded.kind === "frontmatter"
-              ? frontmatterViewCard(relPath, loaded.fields)
-              : await xmlViewCard(relPath, { loader, absPath });
+          const viewCard = frontmatterViewCard(relPath, loaded.fields);
           const attachments = await listAttachments(boxRoot, relPath);
           if (attachments.length > 0) {
             viewCard.attachments = attachments;
@@ -172,24 +150,6 @@ function frontmatterViewCard(relPath: string, fields: Record<string, unknown>):
   return viewCard;
 }
 
-/** Legacy XML card → ViewCard via the element tree (original shape). */
-async function xmlViewCard(
-  relPath: string,
-  { loader, absPath }: { loader: Awaited<ReturnType<typeof createLoader>>; absPath: string }
-): Promise<ViewCard> {
-  const card = await loader.load(absPath);
-  const el = card.element;
-  const viewCard: ViewCard = { path: relPath, tagName: el.tagName, attrs: el.attrs };
-  if (el.text) viewCard.text = el.text;
-  if (el.attrs["status"]) viewCard.status = el.attrs["status"];
-  if (el.children && el.children.length > 0) {
-    viewCard.children = el.children
-      .filter((c): c is ElementNode => typeof c !== "string" && "tagName" in c)
-      .map(elementToViewCardChild);
-  }
-  return viewCard;
-}
-
 type GitStatusLookup = (relPath: string) => "dirty" | "untracked" | null;
 
 /**
diff --git a/callback-box/src/webapp/trpc/routers/card.ts b/callback-box/src/webapp/trpc/routers/card.ts
index fa6dffd7..7c3f26e6 100644
--- a/callback-box/src/webapp/trpc/routers/card.ts
+++ b/callback-box/src/webapp/trpc/routers/card.ts
@@ -3,15 +3,16 @@ import * as fs from "node:fs/promises";
 import * as path from "node:path";
 import { TRPCError } from "@trpc/server";
 import { router, publicProcedure } from "../trpc.js";
-import { createLoader } from "../../../cli/lib/loader.js";
-import { parseCard, type ElementNode } from "cardworks";
 import { splitCardContent, type CardSchema } from "../../../cards/index.js";
 import { parseCardText } from "../../../core/card-io.js";
 import { createCardSchemaMap } from "../../../schemas/registry.js";
 import { parse as parseYaml } from "yaml";
 
 /**
- * JSON-safe element node for the frontend.
+ * JSON-safe element node for the frontend's legacy XML tree view. Cards are all
+ * frontmatter now, so `card.get` never populates `element` — it stays in the
+ * response type only as the (always-undefined) field the frontend renderers
+ * type against.
  */
 export interface JsonElement {
   tagName: string;
@@ -20,20 +21,6 @@ export interface JsonElement {
   children?: JsonElement[];
 }
 
-function sanitizeElement(el: ElementNode): JsonElement {
-  const result: JsonElement = { tagName: el.tagName, attrs: {} };
-  for (const [key, value] of Object.entries(el.attrs)) {
-    if (typeof value === "string") result.attrs[key] = value;
-  }
-  if (el.text !== undefined && el.text !== null) {
-    result.text = String(el.text).trim();
-  }
-  if (el.children && Array.isArray(el.children) && el.children.length > 0) {
-    result.children = el.children.map((child) => sanitizeElement(child as ElementNode));
-  }
-  return result;
-}
-
 function typeFromFilename(source: string): string | undefined {
   const base = source.split("/").pop();
   if (base === undefined) return undefined;
@@ -127,8 +114,6 @@ export const cardRouter = router({
         throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid card path" });
       }
 
-      // Dispatch on file shape: frontmatter cards parse via parseCardText;
-      // legacy XML cards fall through to the cardworks loader.
       let raw: string | null = null;
       try {
         raw = await fs.readFile(fullPath, "utf-8");
@@ -142,76 +127,28 @@ export const cardRouter = router({
 
       const split = splitCardContent(raw);
       const fileType = typeFromFilename(input.path);
-      const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
-      if (split.hasFrontmatter && fileType !== undefined && cardSchemas.has(fileType)) {
+      if (split.hasFrontmatter && fileType !== undefined) {
+        // loadFrontmatterCard is robust to an unregistered/invalid schema: it
+        // surfaces what it can (loose YAML + body) with a validationError, so a
+        // box-local-typed or drifted card still renders.
+        const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
         return loadFrontmatterCard({ raw, source: input.path, type: fileType, cardSchemas });
       }
 
-      const loader = await createLoader(ctx.boxRoot);
-
-      try {
-        const card = await loader.load(fullPath);
-        const xml = loader.serialize(card.element);
-        const element = sanitizeElement(card.element);
-
-        return {
-          path: input.path,
-          kind: "xml" as const,
-          tagName: card.element.tagName,
-          status: card.element.attrs["status"] as string | undefined,
-          version: card.version,
-          xml,
-          element,
-          frontmatter: undefined as Record<string, unknown> | undefined,
-          body: undefined as string | undefined,
-          validationError: undefined as string | undefined,
-        };
-      } catch (error) {
-        const msg = (error as Error).message;
-        const isNotFound = msg.includes("ENOENT") || msg.includes("no such file");
-        if (isNotFound) {
-          throw new TRPCError({
-            code: "NOT_FOUND",
-            message: `Card not found: ${input.path}`,
-          });
-        }
-
-        // Validation failed — parse XML without validation so we can still show the tree
-        let rawXml: string;
-        try {
-          rawXml = await fs.readFile(fullPath, "utf-8");
-        } catch (e) {
-          console.warn(`Could not re-read ${input.path} after validation failure:`, e);
-          throw new TRPCError({
-            code: "BAD_REQUEST",
-            message: `Card validation failed: ${msg}`,
-          });
-        }
-
-        // Try to parse the raw XML into a tree (no schema validation)
-        let element: JsonElement | undefined;
-        let tagName: string | undefined;
-        try {
-          const parsed = await parseCard(rawXml, { source: input.path });
-          element = sanitizeElement(parsed);
-          tagName = parsed.tagName;
-        } catch (e) {
-          // XML itself is malformed — fall back to raw text only.
-          console.warn(`Could not parse raw XML for ${input.path}, showing raw text only:`, e);
-        }
-
-        return {
-          path: input.path,
-          kind: "xml" as const,
-          tagName,
-          status: undefined as string | undefined,
-          version: undefined as string | undefined,
-          xml: rawXml,
-          element,
-          frontmatter: undefined as Record<string, unknown> | undefined,
-          body: undefined as string | undefined,
-          validationError: msg,
-        };
-      }
+      // Not a typed frontmatter card. Every real `.card` is frontmatter now, so
+      // this is a malformed or partially-written file — surface its raw text
+      // rather than failing, so the viewer can still show something.
+      return {
+        path: input.path,
+        kind: "frontmatter" as const,
+        tagName: fileType ?? "",
+        status: undefined as string | undefined,
+        version: undefined as string | undefined,
+        xml: raw,
+        element: undefined as JsonElement | undefined,
+        frontmatter: undefined as Record<string, unknown> | undefined,
+        body: split.hasFrontmatter ? split.body : raw,
+        validationError: split.hasFrontmatter ? undefined : "Card has no frontmatter block",
+      };
     }),
 });
diff --git a/callback-box/src/webapp/trpc/routers/files.ts b/callback-box/src/webapp/trpc/routers/files.ts
index b48d9666..a8d8ba5d 100644
--- a/callback-box/src/webapp/trpc/routers/files.ts
+++ b/callback-box/src/webapp/trpc/routers/files.ts
@@ -43,13 +43,8 @@ async function summarizePath(boxRoot: string, inputPath: string): Promise<FileSu
   if (relPath.endsWith(".card")) {
     try {
       const loaded = await loadCardFile(fullPath, await buildLoadContext(boxRoot));
-      if (loaded.kind === "xml") {
-        input.element = loaded.element;
-        input.type = loaded.element.tagName;
-      } else {
-        input.fields = loaded.fields;
-        input.type = loaded.schema.type;
-      }
+      input.fields = loaded.fields;
+      input.type = loaded.schema.type;
     } catch (e) {
       if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
         console.warn(`Failed to load card ${relPath}, falling through to fallback loader:`, e);
diff --git a/callback-box/src/webapp/trpc/routers/status.ts b/callback-box/src/webapp/trpc/routers/status.ts
index 06c553f3..7dd1e24e 100644
--- a/callback-box/src/webapp/trpc/routers/status.ts
+++ b/callback-box/src/webapp/trpc/routers/status.ts
@@ -4,7 +4,7 @@ import * as path from "node:path";
 import { router, publicProcedure } from "../trpc.js";
 import { getSystemState } from "../../../core/state.js";
 import { generateContext } from "../../context.js";
-import { createLoader } from "../../../cli/lib/loader.js";
+import { loadCardFrontmatter } from "../../../core/frontmatter-field.js";
 import { parseCardName } from "../../../cli/lib/paths.js";
 import { getLog } from "../../../cli/lib/git.js";
 
@@ -97,7 +97,6 @@ export const statusRouter = router({
       const dirs: BrowseDir[] = [];
       const cards: BrowseCard[] = [];
       const files: BrowseFile[] = [];
-      const loader = await createLoader(ctx.boxRoot);
 
       // Build a set of card basenames so we can fold owned `<basename>.attach/`
       // directories into their owning card (cards-as-directories UI).
@@ -144,22 +143,24 @@ export const statusRouter = router({
             (e) => e.isDirectory() && e.name === attachDirName,
           );
 
-          try {
-            const card = await loader.load(fullPath);
-            cards.push({
-              relativePath,
-              name: parsed.name,
-              type: parsed.type,
-              tagName: card.element.tagName,
-              status: card.element.attrs["status"],
-              title: card.element.attrs["title"],
-              hasAttachments,
-            });
-          } catch (e) {
-            // Card failed to load/parse — still list it (as unknown) so the UI shows it.
-            console.warn(`browse: cannot load card ${fullPath}:`, e);
+          const fm = await loadCardFrontmatter(fullPath);
+          if (fm === null) {
+            // Card failed to parse — still list it (as unknown) so the UI shows it.
             cards.push({ relativePath, name: parsed.name, type: parsed.type, tagName: "unknown", hasAttachments });
+            continue;
           }
+          const str = (key: string): string | undefined =>
+            typeof fm[key] === "string" ? (fm[key] as string) : undefined;
+          cards.push({
+            relativePath,
+            name: parsed.name,
+            type: parsed.type,
+            // The filename type is the discriminator (the old XML root tag).
+            tagName: parsed.type,
+            ...(str("status") !== undefined && { status: str("status") }),
+            ...(str("title") !== undefined && { title: str("title") }),
+            hasAttachments,
+          });
           continue;
         }
 
diff --git a/pnpm-workspace.yaml b/pnpm-workspace.yaml
index e145bc03..24415a7b 100644
--- a/pnpm-workspace.yaml
+++ b/pnpm-workspace.yaml
@@ -14,7 +14,6 @@ packages:
   - callback-box
   - callback-box/src/frontend
   - callback-clerk
-  - cardworks
   - personal-vibe-check
   - agent-doctest
   - browse

exec
/opt/homebrew/bin/bash -lc 'git diff main...HEAD --stat' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-LSnDT76L' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-uuXi2agk' (errno=Operation not permitted)
 CLAUDE.md                                          |     7 +-
 callback-box/CLAUDE.md                             |     8 +-
 callback-box/bin/cb                                |     9 -
 callback-box/deploy/README.md                      |     5 +-
 callback-box/deploy/deploy.sh                      |    41 +-
 callback-box/deploy/rebuild-server.sh              |     7 +-
 callback-box/deploy/setup-server.sh                |     9 +-
 callback-box/docs/cards-as-markdown.md             |     2 +-
 .../docs/plans/remove-cardworks-deletion.md        |   620 +
 callback-box/package.json                          |     3 +-
 callback-box/scratch/codex-out.md                  | 22976 +++++++++++--------
 callback-box/scratch/codex-prompt.txt              |    22 +-
 callback-box/scripts/build-cli.mjs                 |    22 +-
 callback-box/scripts/clean-broken-refs.ts          |   322 +-
 callback-box/scripts/migrate/_warnings.ts          |    14 +-
 callback-box/scripts/migrate/audio.ts              |   164 +-
 callback-box/scripts/migrate/bill.ts               |   197 +-
 callback-box/scripts/migrate/briefing.ts           |   252 +-
 callback-box/scripts/migrate/capture-session.ts    |   126 +-
 callback-box/scripts/migrate/chat-thread.ts        |   194 +-
 callback-box/scripts/migrate/doc-sheet.ts          |   229 +-
 callback-box/scripts/migrate/email-message.ts      |   248 +-
 callback-box/scripts/migrate/email-thread.ts       |   245 +-
 callback-box/scripts/migrate/file.ts               |   155 +-
 callback-box/scripts/migrate/guide.ts              |   199 +-
 callback-box/scripts/migrate/image.ts              |   211 +-
 callback-box/scripts/migrate/jobs.ts               |   263 +-
 callback-box/scripts/migrate/landmark.ts           |   223 +-
 callback-box/scripts/migrate/memo.ts               |   175 +-
 callback-box/scripts/migrate/misc.ts               |   295 +-
 callback-box/scripts/migrate/personality.ts        |   293 +-
 callback-box/scripts/migrate/procedure-run.ts      |   128 +-
 callback-box/scripts/migrate/procedure.ts          |   146 +-
 callback-box/scripts/migrate/question.ts           |   206 +-
 callback-box/scripts/migrate/recipe.ts             |   178 +-
 callback-box/scripts/migrate/record-person.ts      |   285 +-
 callback-box/scripts/migrate/repair-refs.ts        |   354 +-
 callback-box/scripts/migrate/scheduled-script.ts   |   210 +-
 callback-box/src/cli/commands/validate.ts          |    28 +-
 callback-box/src/cli/commands/wakeup-steps.ts      |     3 -
 callback-box/src/cli/lib/loader.ts                 |    71 -
 callback-box/src/core/agent-guide/cards.ts         |    10 +-
 callback-box/src/core/agent-guide/index.ts         |    10 +-
 callback-box/src/core/box-templates.ts             |    30 +-
 callback-box/src/core/card-io.ts                   |    46 +-
 callback-box/src/core/card-lint.ts                 |    50 +-
 callback-box/src/core/commands/move-operations.ts  |    43 +-
 callback-box/src/core/commands/move-phase2.ts      |    25 +-
 .../src/core/commands/scan-import-cards.ts         |    83 +-
 callback-box/src/core/commands/scan-import.ts      |     6 +-
 callback-box/src/core/file-summary.ts              |    10 +-
 callback-box/src/core/generate-docs-compile.ts     |    35 +-
 callback-box/src/core/generate-docs.ts             |    32 +-
 callback-box/src/core/init-rules.ts                |    12 +-
 callback-box/src/core/list-cards.ts                |    19 +
 callback-box/src/core/load-context.ts              |    17 +-
 callback-box/src/core/loader-registry.ts           |     4 +-
 callback-box/src/core/preactions/index.ts          |    42 +-
 callback-box/src/core/preactions/transcribe.ts     |   115 +-
 callback-box/src/core/preactions/types.ts          |    16 +-
 callback-box/src/core/reactor/batch-jobs.ts        |     8 +-
 callback-box/src/core/ref-exists.ts                |    79 +
 callback-box/src/core/sdk-hooks.ts                 |     4 +-
 callback-box/src/core/search/extract.ts            |    54 +-
 callback-box/src/core/state.ts                     |    30 +-
 callback-box/src/dev/prompt-report.ts              |    10 +-
 callback-box/src/schemas/index.ts                  |     2 -
 callback-box/src/schemas/registry.ts               |   111 +-
 callback-box/src/webapp/routes/api-browse.ts       |    36 +-
 callback-box/src/webapp/routes/api-card-patch.ts   |    48 -
 callback-box/src/webapp/routes/api-card-routes.ts  |    64 -
 callback-box/src/webapp/routes/api.ts              |     5 -
 callback-box/src/webapp/routes/views.ts            |    44 +-
 callback-box/src/webapp/trpc/routers/card.ts       |   111 +-
 callback-box/src/webapp/trpc/routers/files.ts      |     9 +-
 callback-box/src/webapp/trpc/routers/status.ts     |    33 +-
 .../test/agent-guide-card-types.doctest.md         |    45 +
 callback-box/test/box-schemas.doctest.md           |    40 +-
 callback-box/test/card-io.doctest.md               |    45 +-
 callback-box/test/card-lint.doctest.md             |   123 +-
 callback-box/test/card-loaders.doctest.md          |    16 -
 callback-box/test/contains-state.doctest.md        |     4 +-
 callback-box/test/extfile-sync.doctest.md          |     2 +-
 callback-box/test/loader-registry.doctest.md       |    21 +-
 callback-box/test/move-command.doctest.md          |    46 +
 callback-box/test/routes-api.doctest.md            |    42 +-
 callback-box/test/routes-views.doctest.md          |    13 +-
 callback-box/test/scan-procedures.doctest.md       |    66 +
 callback-box/test/schemas.doctest.md               |    17 +-
 callback-box/test/search-extract.doctest.md        |    23 +-
 cardworks/.claude/settings.json                    |    15 -
 cardworks/.gitignore                               |     3 -
 cardworks/.nvmrc                                   |     1 -
 cardworks/.taprc                                   |    19 -
 cardworks/CLAUDE.md                                |     1 -
 cardworks/CONVENTIONS.md                           |    59 -
 cardworks/DESIGN.md                                |   874 -
 cardworks/README.md                                |  1359 --
 cardworks/eslint.config.mjs                        |    14 -
 cardworks/knip.json                                |    16 -
 cardworks/package.json                             |    69 -
 cardworks/src/card/card.ts                         |   275 -
 cardworks/src/card/index.ts                        |     1 -
 cardworks/src/fs/glob-skip.ts                      |    20 -
 cardworks/src/fs/memory-fs.ts                      |   253 -
 cardworks/src/fs/node-fs.ts                        |   151 -
 cardworks/src/fs/types.ts                          |    56 -
 cardworks/src/index.ts                             |   109 -
 cardworks/src/jsx/create-element.ts                |   160 -
 cardworks/src/jsx/factory.ts                       |   130 -
 cardworks/src/jsx/index.ts                         |    15 -
 cardworks/src/jsx/jsx-runtime.ts                   |    62 -
 cardworks/src/jsx/types.ts                         |    71 -
 cardworks/src/lint/format.ts                       |   130 -
 cardworks/src/lint/index.ts                        |    17 -
 cardworks/src/lint/lint.ts                         |   362 -
 cardworks/src/loader/loader.ts                     |   473 -
 cardworks/src/loader/path-utils.ts                 |   112 -
 cardworks/src/loader/ref-traversal.ts              |   230 -
 cardworks/src/loader/types.ts                      |   148 -
 cardworks/src/parser/dom-to-object.ts              |   242 -
 cardworks/src/parser/frontmatter.ts                |    65 -
 cardworks/src/parser/parse.ts                      |   158 -
 cardworks/src/parser/provenance.ts                 |    72 -
 cardworks/src/refs/parse-ref.ts                    |    98 -
 cardworks/src/refs/resolve.ts                      |   261 -
 cardworks/src/refs/types.ts                        |    57 -
 cardworks/src/refs/xpath.ts                        |   334 -
 cardworks/src/schema/base.ts                       |    34 -
 cardworks/src/schema/card-schema.ts                |   281 -
 cardworks/src/schema/element.ts                    |   147 -
 cardworks/src/schema/format-error.ts               |   292 -
 cardworks/src/schema/registry.ts                   |    63 -
 cardworks/src/serialize/serialize.ts               |   201 -
 cardworks/test/card-schema.test.ts                 |   213 -
 cardworks/test/fixtures/Simple.audience.card       |     4 -
 .../test/fixtures/With_Interleaved.technique.card  |     8 -
 cardworks/test/fixtures/With_Refs.tutorial.card    |     6 -
 cardworks/test/fixtures/malformed.card             |     3 -
 cardworks/test/format-error.test.ts                |   183 -
 cardworks/test/glob.test.ts                        |   125 -
 cardworks/test/jsx.test.ts                         |   358 -
 cardworks/test/lint.test.ts                        |   279 -
 cardworks/test/loader.test.ts                      |   703 -
 cardworks/test/parser.test.ts                      |   231 -
 cardworks/test/refs.test.ts                        |   597 -
 cardworks/test/round-trip.test.ts                  |   182 -
 cardworks/test/schema.test.ts                      |   227 -
 cardworks/tsconfig.json                            |    20 -
 pnpm-lock.yaml                                     |   331 +-
 pnpm-workspace.yaml                                |     1 -
 151 files changed, 14797 insertions(+), 27085 deletions(-)

codex
The first pass confirms the giant deletion is mostly noise, and the targeted diff includes the expected removal points. I’ve got the old `parseRef`/`resolveRef` source now; next I’m checking the new implementation and all remaining references so I can separate real regressions from expected XML-era behavior disappearing.
exec
/opt/homebrew/bin/bash -lc 'nl -ba callback-box/src/core/card-lint.ts' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc 'nl -ba callback-box/src/core/ref-exists.ts' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Frontmatter-card ref existence check.
     3	 *
     4	 * Replaces cardworks' `loader.resolveRef` for the lint broken-ref walk
     5	 * (card-lint.ts): given a ref string written in a card, resolve it to a
     6	 * filesystem path and report whether the target exists. The card-lint
     7	 * dispatcher already extracts the refs itself (`extractRefs` over frontmatter,
     8	 * `extractBodyRefs` over the Markdoc body); this only answers "does it exist".
     9	 *
    10	 * Mirrors cardworks' ref semantics (refs/parse-ref.ts + refs/resolve.ts) so the
    11	 * broken-ref warnings match what the XML loader produced:
    12	 *  - a `#fragment` suffix is ignored for existence
    13	 *  - an `@version`-like suffix (`@1.2.3`, `@v2`) is stripped before resolving
    14	 *    (a bare `@` mid-filename is left alone)
    15	 *  - box-root-absolute refs (`/box/…`) resolve against the box root
    16	 *  - `attach/<rest>` (and bare `attach`) resolve into the referring card's
    17	 *    `<basename>.attach/` scope
    18	 *  - everything else resolves relative to the referring card's directory
    19	 */
    20	
    21	import { access } from "node:fs/promises";
    22	import { dirname, resolve } from "node:path";
    23	import { isAttachRef, resolveAttachRef } from "../shared/attach-path.js";
    24	
    25	interface RefExistsInput {
    26	  /** The raw ref string as written in the card (may carry `@version`/`#fragment`). */
    27	  ref: string;
    28	  /** Absolute path of the card the ref was written in. */
    29	  fromPath: string;
    30	  /** Absolute box root, used to resolve box-root-absolute (`/…`) refs. */
    31	  boxRoot: string;
    32	}
    33	
    34	/**
    35	 * Strip the `@version` and `#fragment` suffixes, returning the bare path
    36	 * component — the same split cardworks' parseRef performs. The version is only
    37	 * stripped when it looks version-like (`@1.x`, `@v2`), so an `@` inside a
    38	 * filename isn't mistaken for a version delimiter.
    39	 */
    40	function refPathComponent(ref: string): string {
    41	  let remaining = ref;
    42	  const hashIndex = remaining.indexOf("#");
    43	  if (hashIndex !== -1) remaining = remaining.slice(0, hashIndex);
    44	  const atIndex = remaining.lastIndexOf("@");
    45	  if (atIndex !== -1) {
    46	    const afterAt = remaining.slice(atIndex + 1);
    47	    if (/^v?\d/.test(afterAt)) remaining = remaining.slice(0, atIndex);
    48	  }
    49	  return remaining;
    50	}
    51	
    52	/** Resolve a ref to the absolute filesystem path it points at. */
    53	function resolveRefToPath(input: RefExistsInput): string {
    54	  const refPath = refPathComponent(input.ref);
    55	  if (refPath.startsWith("/")) return input.boxRoot + refPath;
    56	  if (isAttachRef(refPath)) {
    57	    const attachResolved = resolveAttachRef(input.fromPath, refPath);
    58	    if (attachResolved !== null) return attachResolved;
    59	  }
    60	  return resolve(dirname(input.fromPath), refPath);
    61	}
    62	
    63	/**
    64	 * Whether the card-to-card (or card-to-attachment) ref points at a file that
    65	 * exists. A non-ENOENT access failure is logged and treated as "does not
    66	 * exist" — the lint walk surfaces it as a broken-ref warning either way.
    67	 */
    68	export async function resolveRefExists(input: RefExistsInput): Promise<boolean> {
    69	  const target = resolveRefToPath(input);
    70	  try {
    71	    await access(target);
    72	    return true;
    73	  } catch (e) {
    74	    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
    75	      console.warn(`resolveRefExists: access failed for ${target}`, e);
    76	    }
    77	    return false;
    78	  }
    79	}

 succeeded in 0ms:
     1	/**
     2	 * Lint dispatcher for markdown-frontmatter cards.
     3	 *
     4	 * For each card path, peeks at the frontmatter to decide which path to
     5	 * take: cards declaring a filename `type` that matches a registered
     6	 * CardSchema are validated through parseCardText (Zod schema check); a
     7	 * `.card` with no matching schema is surfaced as a non-blocking warning.
     8	 * Results are merged into a single LintSummary so callers (e.g. cb validate)
     9	 * can format them uniformly.
    10	 *
    11	 * Ref-checking walks two sides: `extractRefs` (src/cards) over parsed
    12	 * frontmatter fields, and `extractBodyRefs` over the Markdoc body. Both
    13	 * yield `{path, ref}` entries with the same shape; both are surfaced as
    14	 * warnings (not errors) so legitimate moves don't block commits.
    15	 *
    16	 * Type-specific, self-contained validation (rules Zod can't express, e.g.
    17	 * commentary's Markdoc check or extfile's `file:`-URL refinement) is NOT here:
    18	 * it lives on each schema as a `validate` hook, invoked generically below.
    19	 * The ref-existence walk stays here because it is box-aware (resolves refs
    20	 * against the box root), which the self-contained hook deliberately lacks.
    21	 */
    22	
    23	import { readFile } from "node:fs/promises";
    24	import {
    25	  splitCardContent,
    26	  extractRefs,
    27	  type CardSchema,
    28	  type LintResult,
    29	  type LintSummary,
    30	  type LintIssue,
    31	} from "../cards/index.js";
    32	import { parse as parseYaml } from "yaml";
    33	import { parseCardText, typeFromFilename, type LoadCardContext } from "./card-io.js";
    34	import { extractBodyRefs } from "./body-refs.js";
    35	import { resolveRefExists } from "./ref-exists.js";
    36	
    37	export interface LintDispatchOptions {
    38	  /**
    39	   * Box root, used to resolve box-root-absolute (`/…`) refs during the
    40	   * broken-ref walk (see resolveRefExists).
    41	   */
    42	  boxRoot: string;
    43	  ctx: LoadCardContext;
    44	}
    45	
    46	/**
    47	 * Lint a list of card paths, dispatching each to the appropriate
    48	 * validator based on file shape.
    49	 */
    50	export async function lintCardsDispatch(
    51	  paths: string[],
    52	  options: LintDispatchOptions
    53	): Promise<LintSummary> {
    54	  const results: LintResult[] = [];
    55	  let totalErrors = 0;
    56	  let totalWarnings = 0;
    57	  let filesWithErrors = 0;
    58	
    59	  for (const path of paths) {
    60	    const result = await lintOne(path, options);
    61	    results.push(result);
    62	    totalErrors += result.errors.length;
    63	    totalWarnings += result.warnings.length;
    64	    if (result.errors.length > 0) {
    65	      filesWithErrors++;
    66	    }
    67	  }
    68	
    69	  return {
    70	    results,
    71	    filesChecked: paths.length,
    72	    filesWithErrors,
    73	    totalErrors,
    74	    totalWarnings,
    75	  };
    76	}
    77	
    78	async function lintOne(path: string, options: LintDispatchOptions): Promise<LintResult> {
    79	  let content: string;
    80	  try {
    81	    content = await readFile(path, "utf8");
    82	  } catch (e) {
    83	    return errorResult(path, (e as Error).message);
    84	  }
    85	
    86	  const split = splitCardContent(content);
    87	  if (split.hasFrontmatter) {
    88	    const type = typeFromFilename(path);
    89	    if (type !== undefined && options.ctx.cardSchemas.has(type)) {
    90	      return lintFrontmatterCard({ path, content, options, type });
    91	    }
    92	    // Frontmatter present but no registered schema for the filename type: there
    93	    // is no XML loader anymore. Surface a non-blocking warning so a typo'd or
    94	    // unknown type is visible without failing the commit hook.
    95	    return {
    96	      path,
    97	      errors: [],
    98	      warnings: [
    99	        {
   100	          type: "schema",
   101	          severity: "warning",
   102	          message:
   103	            type === undefined
   104	              ? "card filename does not encode a type (expected Name.<type>.card)"
   105	              : `no schema registered for card type "${type}" — card not validated`,
   106	        },
   107	      ],
   108	    };
   109	  }
   110	  // Not a frontmatter card at all — nothing to validate.
   111	  return { path, errors: [], warnings: [] };
   112	}
   113	
   114	async function lintFrontmatterCard(input: {
   115	  path: string;
   116	  content: string;
   117	  options: LintDispatchOptions;
   118	  type: string;
   119	}): Promise<LintResult> {
   120	  const { path, content, options, type } = input;
   121	  let parsed;
   122	  try {
   123	    parsed = parseCardText(content, { source: path, schemas: options.ctx.cardSchemas, type });
   124	  } catch (e) {
   125	    return errorResult(path, (e as Error).message);
   126	  }
   127	  // Broken refs are surfaced as WARNINGS, not errors. Refs commonly go
   128	  // stale via legitimate operations (the referent got moved, archived,
   129	  // trashed, or hand-deleted), and treating each one as a hard error
   130	  // would have the pre-commit hook blocking every commit on any box
   131	  // with accumulated data drift. Schema validation failures (which come
   132	  // out of parseCardText as a thrown CardIOError → errorResult above)
   133	  // remain errors and do block.
   134	  const frontmatterRefs = extractRefs(parsed.fields);
   135	  const bodyField = parsed.fields["body"];
   136	  const bodyRefs = typeof bodyField === "string" ? extractBodyRefs(bodyField) : [];
   137	  const warnings: LintIssue[] = [];
   138	  for (const { path: refPath, ref } of [...frontmatterRefs, ...bodyRefs]) {
   139	    try {
   140	      const exists = await resolveRefExists({ ref, fromPath: path, boxRoot: options.boxRoot });
   141	      if (!exists) {
   142	        warnings.push({
   143	          type: "reference",
   144	          severity: "warning",
   145	          message: `Broken reference at ${refPath}: ${ref} does not exist`,
   146	        });
   147	      }
   148	    } catch (e) {
   149	      warnings.push({
   150	        type: "reference",
   151	        severity: "warning",
   152	        message: `Reference at ${refPath} failed to resolve: ${(e as Error).message}`,
   153	      });
   154	    }
   155	  }
   156	  const containsWarning = lintContainsLength(parsed.fields);
   157	  if (containsWarning !== null) warnings.push(containsWarning);
   158	  warnings.push(...unknownKeyWarnings({ content, schema: parsed.schema }));
   159	  // Type-specific, self-contained validation (rules Zod can't express) lives on
   160	  // the schema as its `validate` hook — see the commentary/extfile schema
   161	  // modules. The generic ref-existence walk above stays here because it needs
   162	  // the loader (box-aware), which the self-contained hook deliberately lacks.
   163	  const errors = parsed.schema.validate ? parsed.schema.validate({ fields: parsed.fields }) : [];
   164	  return { path, errors, warnings };
   165	}
   166	
   167	/**
   168	 * Frontmatter keys present on disk that the card's schema doesn't declare. The
   169	 * loader strips these in memory (a drifted card still loads, renders, and
   170	 * indexes), so they are surfaced as **warnings** — visible to `cb validate` and
   171	 * the PostToolUse hook — to be cleaned off disk eventually, without blocking
   172	 * commits or breaking load. Allowed keys are the schema's own fields (minus the
   173	 * body field, which lives in the file body, not frontmatter), the injected
   174	 * global fields, and `type`.
   175	 */
   176	function unknownKeyWarnings(input: { content: string; schema: CardSchema }): LintIssue[] {
   177	  const { content, schema } = input;
   178	  const split = splitCardContent(content);
   179	  if (!split.hasFrontmatter) return [];
   180	  let fm: unknown;
   181	  try {
   182	    fm = parseYaml(split.frontmatterText);
   183	  } catch (_e) {
   184	    // Malformed YAML is a separate, error-level failure already surfaced by
   185	    // parseCardText (which threw → errorResult); nothing to add here.
   186	    return [];
   187	  }
   188	  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) return [];
   189	  const allowed = new Set<string>(["type", ...schema.globalFieldNames, ...Object.keys(schema.fields)]);
   190	  if (schema.bodyFieldName !== null) allowed.delete(schema.bodyFieldName);
   191	  const warnings: LintIssue[] = [];
   192	  for (const key of Object.keys(fm as Record<string, unknown>)) {
   193	    if (allowed.has(key)) continue;
   194	    warnings.push({
   195	      type: "schema",
   196	      severity: "warning",
   197	      message:
   198	        `Unknown frontmatter key "${key}" — not declared by the ${schema.type} schema; ` +
   199	        "it is ignored on load and should be removed",
   200	    });
   201	  }
   202	  return warnings;
   203	}
   204	
   205	/** Soft budget for the `contains` field — one concise sentence, not a summary essay. */
   206	const CONTAINS_MAX_CHARS = 200;
   207	
   208	function lintContainsLength(fields: Record<string, unknown>): LintIssue | null {
   209	  const contains = fields["contains"];
   210	  if (typeof contains !== "string" || contains.length <= CONTAINS_MAX_CHARS) return null;
   211	  return {
   212	    type: "contains",
   213	    severity: "warning",
   214	    message:
   215	      `contains: is ${String(contains.length)} chars (budget ${String(CONTAINS_MAX_CHARS)}) — ` +
   216	      "tighten it to one sentence stating what can be found in this card",
   217	  };
   218	}
   219	
   220	function errorResult(path: string, message: string): LintResult {
   221	  // The cardworks formatter prints the file path as a header above each
   222	  // result's issues, so strip any leading "<path>: " prefix the underlying
   223	  // error (e.g. CardIOError) included to avoid printing the path twice.
   224	  const prefix = `${path}: `;
   225	  const cleaned = message.startsWith(prefix) ? message.slice(prefix.length) : message;
   226	  const issue: LintIssue = {
   227	    type: "validation",
   228	    severity: "error",
   229	    message: cleaned,
   230	  };
   231	  return { path, errors: [issue], warnings: [] };
   232	}
   233	

exec
/opt/homebrew/bin/bash -lc 'nl -ba callback-box/src/core/card-io.ts' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Card file IO for the markdown-frontmatter card format (Phase 2).
     3	 *
     4	 * A `.card` file is a frontmatter-prefixed text file:
     5	 *
     6	 *   ---
     7	 *   type: doc
     8	 *   drive-id: 1abc...
     9	 *   title: Project Notes
    10	 *   ...
    11	 *   ---
    12	 *   markdown body, if the schema declares one
    13	 *
    14	 * The card-primitive layer (`src/cards/`) provides the schema declaration
    15	 * primitives (`cardSchema`, `body`) and the frontmatter splitter
    16	 * (`splitCardContent`); this module owns the YAML parsing on top of them.
    17	 */
    18	
    19	import { readFile } from "node:fs/promises";
    20	import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
    21	import { splitCardContent, type CardSchema } from "../cards/index.js";
    22	
    23	const CARD_XML_CONTENT_TYPE = "application/x-card+xml";
    24	
    25	/**
    26	 * Errors raised by the card IO layer. Caller code can catch this specifically
    27	 * to distinguish format-level problems from arbitrary IO errors.
    28	 */
    29	export class CardIOError extends Error {
    30	  readonly source: string;
    31	  readonly detail: string;
    32	  constructor(source: string, detail: string) {
    33	    super(`${source}: ${detail}`);
    34	    this.name = "CardIOError";
    35	    this.source = source;
    36	    this.detail = detail;
    37	  }
    38	}
    39	
    40	interface ZodIssueLike {
    41	  path: ReadonlyArray<string | number | symbol>;
    42	  message: string;
    43	  code?: string;
    44	  expected?: string;
    45	  received?: string;
    46	}
    47	
    48	/**
    49	 * Render Zod issues as a compact, one-line-per-issue list:
    50	 *
    51	 *   - status: invalid option (expected "new"|"processing"|"processed")
    52	 *   - boxholder.relationships[0].text: required
    53	 *
    54	 * Replaces the multi-line JSON dump Zod's `.message` produces.
    55	 */
    56	function formatZodIssues(issues: ReadonlyArray<ZodIssueLike>): string {
    57	  return issues
    58	    .map((issue) => {
    59	      const pathStr =
    60	        issue.path.length === 0
    61	          ? "(root)"
    62	          : issue.path
    63	              .map((seg, i) => {
    64	                if (typeof seg === "number") return `[${String(seg)}]`;
    65	                return i === 0 ? String(seg) : `.${String(seg)}`;
    66	              })
    67	              .join("");
    68	      return `  - ${pathStr}: ${shortenIssueMessage(issue)}`;
    69	    })
    70	    .join("\n");
    71	}
    72	
    73	function shortenIssueMessage(issue: ZodIssueLike): string {
    74	  const m = issue.message;
    75	  // Zod's stock "Invalid input: expected <X>, received <Y>" → "expected X, got Y"
    76	  const expectedReceived = m.match(/^Invalid input: expected (.+?), received (.+)$/);
    77	  if (expectedReceived) {
    78	    if (expectedReceived[2] === "undefined") return `required (expected ${expectedReceived[1]})`;
    79	    return `expected ${expectedReceived[1]}, got ${expectedReceived[2]}`;
    80	  }
    81	  return m;
    82	}
    83	
    84	/**
    85	 * A parsed card. `fields` is the validated, typed object — the union of
    86	 * frontmatter fields and (if the schema declares one) the body field, keyed
    87	 * uniformly by field name.
    88	 */
    89	export interface ParsedCard<TFields extends Record<string, unknown> = Record<string, unknown>> {
    90	  schema: CardSchema;
    91	  fields: TFields;
    92	  /** Body text exactly as it appeared in the file (empty string if none). */
    93	  rawBody: string;
    94	  /** Optional content-type from frontmatter; undefined for markdown/empty bodies. */
    95	  contentType: string | undefined;
    96	}
    97	
    98	/**
    99	 * Parse a `.card` file's raw text against a registered schema.
   100	 *
   101	 * The card's type is taken from the filename (`Foo.<type>.card`), not from a
   102	 * `type:` field in the frontmatter — the filename is the canonical
   103	 * discriminator. If the YAML happens to carry a `type:` field, it must
   104	 * either match the filename type or be absent; mismatches are a lint
   105	 * error. Either way, the field is normalized into the parsed fields
   106	 * object (so consumers can still read `fields.type`).
   107	 */
   108	export function parseCardText(
   109	  content: string,
   110	  { source, schemas, type }: { source: string; schemas: Map<string, CardSchema>; type?: string }
   111	): ParsedCard {
   112	  const split = splitCardContent(content);
   113	  if (!split.hasFrontmatter) {
   114	    throw new CardIOError(source, "missing frontmatter block");
   115	  }
   116	
   117	  const fm = parseFrontmatterMapping(split.frontmatterText, source);
   118	
   119	  const resolved = resolveCardType({ fm, source, type });
   120	  const schema = schemas.get(resolved);
   121	  if (schema === undefined) {
   122	    throw new CardIOError(source, `no schema registered for type "${resolved}"`);
   123	  }
   124	
   125	  // cardworks bakes `type: z.literal(...)` into frontmatterSchema, so we
   126	  // inject the resolved type before validation. The on-disk YAML is no
   127	  // longer required to carry it.
   128	  const fmForValidation = { ...fm, type: resolved };
   129	  const fmParse = schema.frontmatterSchema.safeParse(fmForValidation);
   130	  if (!fmParse.success) {
   131	    throw new CardIOError(
   132	      source,
   133	      `invalid ${resolved} frontmatter:\n${formatZodIssues(fmParse.error.issues)}`
   134	    );
   135	  }
   136	  const fmFields = fmParse.data as Record<string, unknown>;
   137	
   138	  const contentType = typeof fm["content-type"] === "string" ? fm["content-type"] : undefined;
   139	
   140	  const bodyValue = validateCardBody({ schema, body: split.body, contentType, resolved, source });
   141	
   142	  const fields: Record<string, unknown> = { ...fmFields };
   143	  if (schema.bodyFieldName !== null) {
   144	    fields[schema.bodyFieldName] = bodyValue;
   145	  }
   146	
   147	  return {
   148	    schema,
   149	    fields,
   150	    rawBody: split.body,
   151	    contentType,
   152	  };
   153	}
   154	
   155	/**
   156	 * Parse the frontmatter YAML block into a plain mapping. An empty block
   157	 * (which YAML parses as `null`) becomes an empty mapping; non-mapping YAML
   158	 * (arrays, scalars) is a format error.
   159	 */
   160	function parseFrontmatterMapping(frontmatterText: string, source: string): Record<string, unknown> {
   161	  let frontmatter: unknown;
   162	  try {
   163	    frontmatter = parseYaml(frontmatterText);
   164	  } catch (e) {
   165	    const err = e as Error;
   166	    throw new CardIOError(source, `invalid YAML frontmatter: ${err.message}`);
   167	  }
   168	  // YAML parses an empty block as `null`; treat that as an empty mapping
   169	  // so cards whose only frontmatter field got stripped still parse.
   170	  if (Array.isArray(frontmatter) || (frontmatter !== null && typeof frontmatter !== "object")) {
   171	    throw new CardIOError(source, "frontmatter must be a YAML mapping");
   172	  }
   173	  return (frontmatter as Record<string, unknown> | null) ?? {};
   174	}
   175	
   176	/**
   177	 * Resolve the card type: caller-supplied wins, otherwise derive from the
   178	 * source filename (Foo.<type>.card), otherwise fall back to any `type:`
   179	 * field in the YAML for callers that haven't been updated yet. A YAML
   180	 * `type:` that contradicts a caller-supplied `type` is a format error.
   181	 */
   182	function resolveCardType(input: {
   183	  fm: Record<string, unknown>;
   184	  source: string;
   185	  type: string | undefined;
   186	}): string {
   187	  const { fm, source, type } = input;
   188	  const yamlType = typeof fm["type"] === "string" ? (fm["type"] as string) : undefined;
   189	  const resolved = type ?? typeFromFilename(source) ?? yamlType;
   190	  if (resolved === undefined) {
   191	    throw new CardIOError(
   192	      source,
   193	      "cannot determine card type — filename must match Foo.<type>.card"
   194	    );
   195	  }
   196	  if (type !== undefined && yamlType !== undefined && yamlType !== type) {
   197	    throw new CardIOError(
   198	      source,
   199	      `frontmatter type "${yamlType}" does not match filename type "${type}"`
   200	    );
   201	  }
   202	  return resolved;
   203	}
   204	
   205	/**
   206	 * Validate the body text against the schema's body field (if any) and
   207	 * return the parsed body value. Schemas without a body field reject any
   208	 * non-whitespace body content. Returns undefined when no body field exists.
   209	 */
   210	function validateCardBody(input: {
   211	  schema: CardSchema;
   212	  body: string;
   213	  contentType: string | undefined;
   214	  resolved: string;
   215	  source: string;
   216	}): unknown {
   217	  const { schema, body, contentType, resolved, source } = input;
   218	  if (schema.bodyField === null || schema.bodyFieldName === null) {
   219	    if (body.trim().length > 0) {
   220	      throw new CardIOError(source, `schema "${resolved}" declares no body, but file has body content`);
   221	    }
   222	    return undefined;
   223	  }
   224	  if (schema.bodyField.kind === "xml" && contentType !== CARD_XML_CONTENT_TYPE) {
   225	    throw new CardIOError(
   226	      source,
   227	      `schema "${resolved}" expects an XML body but content-type is ${contentType === undefined ? "missing" : `"${contentType}"`}`
   228	    );
   229	  }
   230	  const bodyParse = schema.bodyField.schema.safeParse(body);
   231	  if (!bodyParse.success) {
   232	    throw new CardIOError(
   233	      source,
   234	      `invalid ${resolved} body:\n${formatZodIssues(bodyParse.error.issues)}`
   235	    );
   236	  }
   237	  return bodyParse.data;
   238	}
   239	
   240	/**
   241	 * Serialize a parsed card back to its file representation.
   242	 *
   243	 * Splits the input fields object into frontmatter (everything but the body
   244	 * field) + body, sets the appropriate content-type, and emits a fenced YAML
   245	 * block followed by the body text.
   246	 */
   247	export function serializeCardText(input: {
   248	  schema: CardSchema;
   249	  fields: Record<string, unknown>;
   250	}): string {
   251	  const { schema, fields } = input;
   252	  // No `type:` field emitted — the filename is the canonical discriminator.
   253	  const frontmatter: Record<string, unknown> = {};
   254	  let body = "";
   255	  for (const [name, value] of Object.entries(fields)) {
   256	    if (name === "type") continue;
   257	    if (schema.bodyFieldName === name) {
   258	      if (schema.bodyField === null) continue;
   259	      if (schema.bodyField.kind === "markdown") {
   260	        body = typeof value === "string" ? value : String(value);
   261	      } else if (schema.bodyField.kind === "xml") {
   262	        body = typeof value === "string" ? value : String(value);
   263	        frontmatter["content-type"] = CARD_XML_CONTENT_TYPE;
   264	      }
   265	      continue;
   266	    }
   267	    if (value === undefined) continue;
   268	    frontmatter[name] = value;
   269	  }
   270	  const yamlText = stringifyYaml(frontmatter);
   271	  // YAML.stringify ends with \n already
   272	  return `---\n${yamlText}---\n${body}`;
   273	}
   274	
   275	/**
   276	 * A card loaded via the dispatcher. Every card is markdown-frontmatter now;
   277	 * the type alias is kept for the many consumers that name it.
   278	 */
   279	export type LoadedCard = FrontmatterLoadedCard;
   280	
   281	export interface FrontmatterLoadedCard {
   282	  readonly kind: "frontmatter";
   283	  readonly path: string;
   284	  readonly schema: CardSchema;
   285	  readonly fields: Record<string, unknown>;
   286	  readonly contentType: string | undefined;
   287	}
   288	
   289	export interface LoadCardContext {
   290	  /** Schemas keyed by frontmatter `type:` value. */
   291	  cardSchemas: Map<string, CardSchema>;
   292	}
   293	
   294	/**
   295	 * Load a `.card` file. The file must have a `---` frontmatter block whose
   296	 * filename type (`Foo.<type>.card`) matches a registered CardSchema; anything
   297	 * else throws a CardIOError.
   298	 */
   299	export async function loadCardFile(
   300	  absPath: string,
   301	  ctx: LoadCardContext
   302	): Promise<LoadedCard> {
   303	  const content = await readFile(absPath, "utf8");
   304	  return loadCardFromText({ content, source: absPath, ctx });
   305	}
   306	
   307	/**
   308	 * In-memory variant of loadCardFile. Useful for tests and for callers
   309	 * that already have the file content in hand.
   310	 */
   311	export function loadCardFromText(input: {
   312	  content: string;
   313	  source: string;
   314	  ctx: LoadCardContext;
   315	}): Promise<LoadedCard> {
   316	  const { content, source, ctx } = input;
   317	  const split = splitCardContent(content);
   318	  if (split.hasFrontmatter) {
   319	    const fileType = typeFromFilename(source);
   320	    if (fileType !== undefined && ctx.cardSchemas.has(fileType)) {
   321	      const parsed = parseCardText(content, { source, schemas: ctx.cardSchemas, type: fileType });
   322	      return Promise.resolve<LoadedCard>({
   323	        kind: "frontmatter",
   324	        path: source,
   325	        schema: parsed.schema,
   326	        fields: parsed.fields,
   327	        contentType: parsed.contentType,
   328	      });
   329	    }
   330	  }
   331	  return Promise.reject(
   332	    new CardIOError(source, "not a recognized card: no frontmatter block with a registered type")
   333	  );
   334	}
   335	
   336	/**
   337	 * Extract the card type from a filename matching `Foo.<type>.card`.
   338	 * Job cards use the dotted convention `Foo.<kind>.job.card` (the reactor
   339	 * discovers jobs by that suffix — see reactor/job-discovery.ts) while
   340	 * their schemas are registered under hyphenated names, so e.g.
   341	 * `Foo.intake.job.card` resolves to type `intake-job`.
   342	 * Returns undefined when the source doesn't fit either pattern (e.g.
   343	 * test fixtures with non-card paths).
   344	 */
   345	export function typeFromFilename(source: string): string | undefined {
   346	  const base = source.split("/").pop() ?? source;
   347	  const jobMatch = base.match(/^.+\.([^.]+)\.job\.card$/);
   348	  if (jobMatch) return `${jobMatch[1]}-job`;
   349	  const match = base.match(/^.+\.([^.]+)\.card$/);
   350	  return match ? match[1] : undefined;
   351	}
   352	
   353	

exec
/opt/homebrew/bin/bash -lc "rg -n \"cardworks|kind === \\\"xml\\\"|kind: \\\"xml\\\"|XmlLoadedCard|loadXmlCard|createLoader|parseCard\\(\" callback-box/src callback-box/scripts callback-box/bin callback-box/deploy callback-box/package.json pnpm-workspace.yaml" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/scripts/migrate/jobs.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/jobs.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/jobs.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/landmark.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/landmark.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/landmark.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:277:> import { element, escapeText } from "cardworks";
callback-box/deploy/deploy.sh:38:# the frontend/cardworks against stale modules and fails — this has bitten the
callback-box/deploy/deploy.sh:108:  # One-time cleanup: the cardworks package was removed (absorbed into
callback-box/deploy/deploy.sh:110:  # /opt/callback/cardworks just lingers — drop it idempotently.
callback-box/deploy/deploy.sh:111:  if [[ -d /opt/callback/cardworks ]]; then
callback-box/deploy/deploy.sh:112:    echo "  Removing stale /opt/callback/cardworks (package removed)..."
callback-box/deploy/deploy.sh:113:    rm -rf /opt/callback/cardworks
callback-box/deploy/deploy.sh:123:    rm -rf /opt/callback/cardworks/node_modules \
callback-box/scripts/migrate/briefing.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/briefing.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/briefing.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/clean-broken-refs.ts:3: * `cardworks` package, which has been removed now that every box is
callback-box/scripts/clean-broken-refs.ts:6:console.log("retired (cardworks removed); nothing to do");
callback-box/scripts/migrate/delete-deprecated-cards.ts:11: * "no XML remains" end state for the cardworks removal. Git history is the
callback-box/scripts/migrate/audio.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/audio.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/audio.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/record-person.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/record-person.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/record-person.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/email-thread.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/email-thread.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/email-thread.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/_warnings.ts:23: * deleted `cardworks` package.
callback-box/scripts/migrate/file.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/file.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/file.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/recipe.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/recipe.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/recipe.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/capture-session.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/capture-session.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/capture-session.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/scheduled-script.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/scheduled-script.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/scheduled-script.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/procedure.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/procedure.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/procedure.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/bill.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/bill.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/bill.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/question.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/question.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/question.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/procedure-run.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/procedure-run.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/procedure-run.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/email-message.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/email-message.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/email-message.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/chat-thread.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/chat-thread.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/chat-thread.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/personality.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/personality.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/personality.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/memo.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/memo.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/memo.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/guide.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/guide.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/guide.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/misc.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/misc.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/misc.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/doc-sheet.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/doc-sheet.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/doc-sheet.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/repair-refs.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/repair-refs.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/repair-refs.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/scripts/migrate/image.ts:2: * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
callback-box/scripts/migrate/image.ts:4: * This XML→frontmatter migration ran before the `cardworks` XML library was
callback-box/scripts/migrate/image.ts:10:console.log("retired migrator (cardworks removed); nothing to do");
callback-box/src/cards/lint-format.ts:4: * Absorbed from the former `cardworks` package (lint/format.ts + the result
callback-box/src/cards/frontmatter.ts:16: * (Absorbed from the former `cardworks` package — see
callback-box/src/cards/frontmatter.ts:17: * docs/implemented-plans/remove-cardworks-package.md.)
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:25:> import { element } from "cardworks";
callback-box/scripts/migrate/card-frontmatter.ts:12: * No body content is altered. The cardworks parser handles the new prefix
callback-box/scripts/migrate/card-frontmatter.ts:13: * transparently via `parseCard()`, so this migration is a no-op for readers
callback-box/src/cards/index.ts:4: * `cardworks` package (see docs/implemented-plans/remove-cardworks-package.md).
callback-box/src/cards/errors.ts:2: * Card parse error. Absorbed from the former `cardworks` package
callback-box/src/cards/schema.ts:13: * (Absorbed from the former `cardworks` package — see
callback-box/src/cards/schema.ts:14: * docs/implemented-plans/remove-cardworks-package.md.)
callback-box/src/shared/markdoc-config.ts:174:    // ref-tracking walks for and what the cardworks frontmatter convention
callback-box/src/core/body-refs.ts:6: * `refs`) in parsed objects. Card bodies are strings as far as cardworks
callback-box/src/core/body-refs.ts:16: * Lives in callback-box (not cardworks) on purpose: cardworks is body-
callback-box/src/schemas/feedback.tsx:57:  the cardworks \`path#fragment\` form, e.g.
callback-box/src/cli/commands/render.ts:83:        // Use the frontend tsconfig so JSX resolves to React (not cardworks)
callback-box/src/schemas/registry.ts:2: * Central schema registration with cardworks.
callback-box/src/core/box-file-watcher.ts:23: * on 2026-06-11). Same shape as cardworks' GLOB_SKIP_DIRS.
callback-box/src/core/list-cards.ts:4: * Replaces the cardworks `CardLoader.listCards()` — a plain glob for `*.card`
callback-box/src/schemas/extfile.tsx:29: * Wired onto the schema as its `validate` hook (cardworks invokes it during
callback-box/src/core/ref-exists.ts:4: * Replaces cardworks' `loader.resolveRef` for the lint broken-ref walk
callback-box/src/core/ref-exists.ts:10: * Mirrors cardworks' ref semantics (refs/parse-ref.ts + refs/resolve.ts) so the
callback-box/src/core/ref-exists.ts:36: * component — the same split cardworks' parseRef performs. The version is only
callback-box/src/core/sdk-hooks.ts:34: *   - Validate `.card` files via cardworks lint and surface any issues
callback-box/src/core/card-lint.ts:221:  // The cardworks formatter prints the file path as a header above each
callback-box/src/core/card-io.ts:125:  // cardworks bakes `type: z.literal(...)` into frontmatterSchema, so we
callback-box/src/core/card-io.ts:224:  if (schema.bodyField.kind === "xml" && contentType !== CARD_XML_CONTENT_TYPE) {
callback-box/src/core/card-io.ts:261:      } else if (schema.bodyField.kind === "xml") {
callback-box/src/core/commands/create.ts:141:  // through cardworks's loader.
callback-box/src/core/commands/move-operations.ts:5: * Beyond what cardworks' built-in move handles (card file + same-basename
callback-box/src/core/commands/move-operations.ts:9: * cardworks misses: refs written relative to the referring card, refs into
callback-box/src/core/commands/move-operations.ts:11: * Phase-2 frontmatter cards cardworks can't parse.
callback-box/src/core/commands/move-operations.ts:174: * frontmatter alike. cardworks already re-serialized card-to-card refs in
callback-box/src/core/commands/move-operations.ts:176: * attach-scope refs and every Phase-2 card cardworks can't parse.
callback-box/src/core/commands/move.ts:4: * Uses cardworks' move functionality to handle:
callback-box/src/core/commands/move-phase2.ts:34: * directory atomically — the Phase-2 analogue of what cardworks'
callback-box/src/core/commands/move-phase2.ts:36: * file paths in the same `{from, to}` shape cardworks emits.

codex
So far the new ref checker matches the deleted resolver on the obvious mechanics: fragment removal, version-like `@` stripping, box-root absolute paths, attach scope, and relative resolution. I’m now following the less obvious consumers, especially schema/export resolution and the scan-import writeback, because those are where a removal like this tends to break without saying much.
exec
/opt/homebrew/bin/bash -lc 'nl -ba callback-box/src/shared/attach-path.ts' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc 'nl -ba callback-box/src/core/commands/scan-import-cards.ts' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Helpers for the `.attach/` directory convention.
     3	 *
     4	 * Every card may have a sibling directory named `<basename>.attach/`. Files
     5	 * placed in that directory belong to the card. Refs from the card to its
     6	 * attached files use the virtual prefix `attach/<file>`; the resolver expands
     7	 * the prefix against the card's attach scope.
     8	 *
     9	 * Pure string operations — no Node deps. Lives in `src/shared/` so both the
    10	 * backend (CLI, connectors, webapp; relative `../shared/attach-path.js`) and
    11	 * the frontend (`@shared/attach-path`) import the one source of truth.
    12	 */
    13	
    14	/** Suffix that marks a directory as a card's attach scope. */
    15	export const ATTACH_SUFFIX = ".attach";
    16	
    17	/** Virtual prefix used in ref values pointing into the current card's attach scope. */
    18	export const ATTACH_PREFIX = "attach/";
    19	
    20	/**
    21	 * Card basename — the part of the filename before `.<type>.card`.
    22	 *
    23	 * `Foo.image.card` → `Foo`
    24	 * `Voice_Memo.memo.card` → `Voice_Memo`
    25	 * `scan-001.capture-session.card` → `scan-001`
    26	 *
    27	 * Returns the filename unchanged if it doesn't end with `.card` or has no type
    28	 * segment before `.card`.
    29	 */
    30	export function cardBasename(cardFileNameOrPath: string): string {
    31	  const name = lastSegment(cardFileNameOrPath);
    32	  if (!name.endsWith(".card")) return name;
    33	  const withoutCard = name.slice(0, -".card".length);
    34	  const lastDot = withoutCard.lastIndexOf(".");
    35	  if (lastDot === -1) return withoutCard;
    36	  return withoutCard.slice(0, lastDot);
    37	}
    38	
    39	/**
    40	 * Compute the attach directory path for a given card. The returned path is in
    41	 * the same directory as the card, with name `<basename>.attach`.
    42	 *
    43	 * Works with absolute or relative paths — uses the input's directory.
    44	 */
    45	export function attachDirFor(cardPath: string): string {
    46	  const dir = dirSegment(cardPath);
    47	  const base = cardBasename(cardPath);
    48	  const suffix = base + ATTACH_SUFFIX;
    49	  return dir === "" ? suffix : dir + "/" + suffix;
    50	}
    51	
    52	/**
    53	 * Compute the path of an attached file under a card's scope.
    54	 *
    55	 * `attachmentPath("inbox/Foo.image.card", "photo-001.jpg")`
    56	 *   → `"inbox/Foo.attach/photo-001.jpg"`
    57	 *
    58	 * `fileName` is a path *within* the attach scope — may itself contain
    59	 * subdirectories (`"attachments/foo.pdf"`, `"sub/scan.image.card"`).
    60	 */
    61	export function attachmentPath(cardPath: string, fileName: string): string {
    62	  const dir = attachDirFor(cardPath);
    63	  return dir + "/" + fileName;
    64	}
    65	
    66	/**
    67	 * Test whether a ref value uses the `attach/` virtual prefix. The prefix is
    68	 * only meaningful as the first path segment.
    69	 */
    70	export function isAttachRef(ref: string): boolean {
    71	  if (ref.startsWith(ATTACH_PREFIX)) return true;
    72	  if (ref === "attach") return true;
    73	  return false;
    74	}
    75	
    76	/**
    77	 * Return the portion of a ref after the `attach/` prefix, or `null` if the ref
    78	 * doesn't use the prefix.
    79	 *
    80	 * `splitAttachRef("attach/photo-001.jpg")` → `"photo-001.jpg"`
    81	 * `splitAttachRef("attach/sub/scan.image.card")` → `"sub/scan.image.card"`
    82	 * `splitAttachRef("store/x.attach/y.jpg")` → `null` (mid-path occurrence is literal)
    83	 */
    84	export function splitAttachRef(ref: string): string | null {
    85	  if (!isAttachRef(ref)) return null;
    86	  if (ref === "attach") return "";
    87	  return ref.slice(ATTACH_PREFIX.length);
    88	}
    89	
    90	/**
    91	 * Resolve a ref value that uses the `attach/` prefix to a filesystem path
    92	 * (in the same path-style as `cardPath`).
    93	 *
    94	 * `resolveAttachRef("inbox/Foo.image.card", "attach/photo-001.jpg")`
    95	 *   → `"inbox/Foo.attach/photo-001.jpg"`
    96	 *
    97	 * Returns `null` if the ref doesn't use the prefix.
    98	 */
    99	export function resolveAttachRef(cardPath: string, ref: string): string | null {
   100	  const rest = splitAttachRef(ref);
   101	  if (rest === null) return null;
   102	  if (rest === "") return attachDirFor(cardPath);
   103	  return attachDirFor(cardPath) + "/" + rest;
   104	}
   105	
   106	/**
   107	 * True when the given basename is exactly `attach` (no extension). Used by the
   108	 * lint rule that forbids the literal name `attach` outside an attach scope.
   109	 */
   110	export function isLiteralAttachName(name: string): boolean {
   111	  return name === "attach";
   112	}
   113	
   114	/**
   115	 * True when the given basename ends with `.attach` (the suffix that marks a
   116	 * card's attach scope).
   117	 */
   118	export function isAttachDirName(name: string): boolean {
   119	  return name.endsWith(ATTACH_SUFFIX) && name.length > ATTACH_SUFFIX.length;
   120	}
   121	
   122	/**
   123	 * If `dirName` is `<basename>.attach`, return `<basename>`. Otherwise null.
   124	 */
   125	export function attachDirOwnerBasename(dirName: string): string | null {
   126	  if (!isAttachDirName(dirName)) return null;
   127	  return dirName.slice(0, -ATTACH_SUFFIX.length);
   128	}
   129	
   130	/**
   131	 * Test whether a path lies inside an attach scope — any descendant of a
   132	 * `<basename>.attach/` directory.
   133	 *
   134	 * Used by lint rules: the exact-name `attach` ban only applies outside attach
   135	 * scopes (attachments may have a subdirectory named `attach` if a user
   136	 * really wants — unusual but not forbidden).
   137	 */
   138	export function isInsideAttachScope(relativePath: string): boolean {
   139	  const segments = relativePath.split("/");
   140	  for (const segment of segments) {
   141	    if (isAttachDirName(segment)) return true;
   142	  }
   143	  return false;
   144	}
   145	
   146	function lastSegment(p: string): string {
   147	  const i = p.lastIndexOf("/");
   148	  return i === -1 ? p : p.slice(i + 1);
   149	}
   150	
   151	function dirSegment(p: string): string {
   152	  const i = p.lastIndexOf("/");
   153	  return i === -1 ? "" : p.slice(0, i);
   154	}

 succeeded in 0ms:
     1	/**
     2	 * Card emission for the scan-import photo flow.
     3	 *
     4	 * Three cohesive jobs live here, all operating on the session's attach scope:
     5	 *   - `emitPhotoBundle` — write a photo's image card (renaming the photo and
     6	 *     any back JPEG into the card's attach scope), apply the Gemini analysis,
     7	 *     and emit a review question when the bundle is flagged.
     8	 *   - `emitOrphanBackQuestion` / `emitUnsureQuestion` — file a loose JPEG and
     9	 *     a text question prompting the human to place or discard it.
    10	 *   - `applyBundleAnalysisToCard` — mutate a freshly-written image card with
    11	 *     the analyzed description, text blocks, rotation, and subject bbox.
    12	 *
    13	 * Each emitter pushes onto the caller's `filesToStage`/`questionPaths` arrays
    14	 * and (for bundles) the `imageRefs` array, mirroring the original inline loops
    15	 * exactly.
    16	 */
    17	
    18	import * as fs from "node:fs/promises";
    19	import * as path from "node:path";
    20	import { parseCardText, serializeCardText } from "../card-io.js";
    21	import { type CardSchema } from "../../cards/index.js";
    22	import { createImageTemplate } from "../../schemas/image.js";
    23	import { createTextQuestionTemplate } from "../../schemas/question.js";
    24	import type { PhotoBundle, OrphanBack, ResolvedPage } from "./scan-import-helpers.js";
    25	
    26	interface PhotoBundleEmitContext {
    27	  cardSchemas: Map<string, CardSchema>;
    28	  index: number;
    29	  bundle: PhotoBundle;
    30	  startedAt: string;
    31	  sessionAttachAbsDir: string;
    32	  sessionAttachRelDir: string;
    33	  archivePages: string[];
    34	  filesToStage: string[];
    35	  imageRefs: string[];
    36	  questionPaths: string[];
    37	}
    38	
    39	export async function emitPhotoBundle(emitCtx: PhotoBundleEmitContext): Promise<void> {
    40	  const {
    41	    cardSchemas,
    42	    index,
    43	    bundle,
    44	    startedAt,
    45	    sessionAttachAbsDir,
    46	    sessionAttachRelDir,
    47	    archivePages,
    48	    filesToStage,
    49	    imageRefs,
    50	    questionPaths,
    51	  } = emitCtx;
    52	  const photoIdx = String(index + 1).padStart(3, "0");
    53	  const photoBasename = `photo-${photoIdx}`;
    54	  const photoFilename = `${photoBasename}.jpg`;
    55	  const cardFilename = `${photoBasename}.image.card`;
    56	
    57	  // Photo and its back live in the image card's attach scope.
    58	  const photoAttachAbs = path.join(sessionAttachAbsDir, `${photoBasename}.attach`);
    59	  await fs.mkdir(photoAttachAbs, { recursive: true });
    60	  await fs.rename(archivePages[bundle.photoIndex]!, path.join(photoAttachAbs, photoFilename));
    61	  filesToStage.push(`${sessionAttachRelDir}/${photoBasename}.attach/${photoFilename}`);
    62	
    63	  let backFilename: string | null = null;
    64	  if (bundle.backIndex !== null) {
    65	    backFilename = `${photoBasename}-back.jpg`;
    66	    await fs.rename(archivePages[bundle.backIndex]!, path.join(photoAttachAbs, backFilename));
    67	    filesToStage.push(`${sessionAttachRelDir}/${photoBasename}.attach/${backFilename}`);
    68	  }
    69	
    70	  const cardContent = createImageTemplate({
    71	    capturedAt: startedAt,
    72	    source: "gallery",
    73	    filename: photoFilename,
    74	  });
    75	  const cardPath = path.join(sessionAttachAbsDir, cardFilename);
    76	  await fs.writeFile(cardPath, cardContent);
    77	  await applyBundleAnalysisToCard({ cardPath, bundle, cardSchemas });
    78	  filesToStage.push(`${sessionAttachRelDir}/${cardFilename}`);
    79	  imageRefs.push(cardFilename);
    80	
    81	  if (bundle.flagForReview) {
    82	    const memo = [
    83	      `Photo ${photoIdx} (page ${bundle.photoIndex + 1}${bundle.backIndex !== null ? `, back on page ${bundle.backIndex + 1}` : ""}) needs review:`,
    84	      ...bundle.flagReasons.map((r) => `- ${r}`),
    85	    ].join("\n");
    86	    const directiveParts = [`Open ${sessionAttachRelDir}/${cardFilename} and adjust description or text blocks.`];
    87	    if (backFilename) {
    88	      directiveParts.push(`Cross-check the back transcription against ${sessionAttachRelDir}/${photoBasename}.attach/${backFilename}.`);
    89	    }
    90	    const questionContent = createTextQuestionTemplate({
    91	      memo,
    92	      prompt: `Review ${photoBasename}: confirm description and back-of-photo text are accurate.`,
    93	      directive: directiveParts.join(" "),
    94	    });
    95	    const questionFilename = `${photoBasename}.review.question.card`;
    96	    const questionPath = path.join(sessionAttachAbsDir, questionFilename);
    97	    await fs.writeFile(questionPath, questionContent);
    98	    filesToStage.push(`${sessionAttachRelDir}/${questionFilename}`);
    99	    questionPaths.push(`${sessionAttachRelDir}/${questionFilename}`);
   100	  }
   101	}
   102	
   103	interface LooseQuestionContext {
   104	  index: number;
   105	  sessionAttachAbsDir: string;
   106	  sessionAttachRelDir: string;
   107	  archivePages: string[];
   108	  filesToStage: string[];
   109	  questionPaths: string[];
   110	}
   111	
   112	export async function emitOrphanBackQuestion(
   113	  orphan: OrphanBack,
   114	  looseCtx: LooseQuestionContext
   115	): Promise<void> {
   116	  const { index, sessionAttachAbsDir, sessionAttachRelDir, archivePages, filesToStage, questionPaths } = looseCtx;
   117	  const idx = String(index + 1).padStart(3, "0");
   118	  const basename = `orphan-back-${idx}`;
   119	  const filename = `${basename}.jpg`;
   120	  // Loose image (no card) — lives directly in the session's attach scope.
   121	  await fs.rename(archivePages[orphan.index]!, path.join(sessionAttachAbsDir, filename));
   122	  filesToStage.push(`${sessionAttachRelDir}/${filename}`);
   123	  const ocrText = orphan.analysis.text_blocks.map((b) => b.text).join("\n").trim();
   124	  const memo = [
   125	    `Found a back-of-photo with no matching photo (page ${orphan.index + 1}).`,
   126	    ocrText ? `Transcribed text:\n${ocrText}` : "(no transcribed text)",
   127	  ].join("\n\n");
   128	  const questionContent = createTextQuestionTemplate({
   129	    memo,
   130	    prompt: `Which photo does ${filename} belong with, or should it be discarded?`,
   131	    directive: `If it belongs with a photo in this session, attach by appending text blocks to that image card. Otherwise delete ${sessionAttachRelDir}/${filename}.`,
   132	  });
   133	  const questionFilename = `${basename}.question.card`;
   134	  const questionPath = path.join(sessionAttachAbsDir, questionFilename);
   135	  await fs.writeFile(questionPath, questionContent);
   136	  filesToStage.push(`${sessionAttachRelDir}/${questionFilename}`);
   137	  questionPaths.push(`${sessionAttachRelDir}/${questionFilename}`);
   138	}
   139	
   140	export async function emitUnsureQuestion(
   141	  page: ResolvedPage,
   142	  looseCtx: LooseQuestionContext
   143	): Promise<void> {
   144	  const { index, sessionAttachAbsDir, sessionAttachRelDir, archivePages, filesToStage, questionPaths } = looseCtx;
   145	  const idx = String(index + 1).padStart(3, "0");
   146	  const basename = `unsure-${idx}`;
   147	  const filename = `${basename}.jpg`;
   148	  await fs.rename(archivePages[page.index]!, path.join(sessionAttachAbsDir, filename));
   149	  filesToStage.push(`${sessionAttachRelDir}/${filename}`);
   150	  const memo = [
   151	    `Could not classify page ${page.index + 1}.`,
   152	    page.analysis.flag_reason ?? "(no specific reason given)",
   153	  ].join("\n\n");
   154	  const questionContent = createTextQuestionTemplate({
   155	    memo,
   156	    prompt: `What is ${filename}? (photo, back-of-photo, or trash)`,
   157	    directive: `If a photo, create an image card. If a back, attach to the relevant photo card. Otherwise delete ${sessionAttachRelDir}/${filename}.`,
   158	  });
   159	  const questionFilename = `${basename}.question.card`;
   160	  const questionPath = path.join(sessionAttachAbsDir, questionFilename);
   161	  await fs.writeFile(questionPath, questionContent);
   162	  filesToStage.push(`${sessionAttachRelDir}/${questionFilename}`);
   163	  questionPaths.push(`${sessionAttachRelDir}/${questionFilename}`);
   164	}
   165	
   166	async function applyBundleAnalysisToCard(
   167	  { cardPath, bundle, cardSchemas }: { cardPath: string; bundle: PhotoBundle; cardSchemas: Map<string, CardSchema> }
   168	): Promise<void> {
   169	  const content = await fs.readFile(cardPath, "utf-8");
   170	  const parsed = parseCardText(content, { source: cardPath, schemas: cardSchemas, type: "image" });
   171	  const fields = { ...parsed.fields };
   172	
   173	  const photo = bundle.photo;
   174	  const back = bundle.back;
   175	
   176	  // The image schema's `text` field is an array of { source, content }.
   177	  const photoTextBlocks = photo.text_blocks.map((b) => ({ source: b.source || "photo", content: b.text }));
   178	  const backTextBlocks = back
   179	    ? back.text_blocks.map((b) => ({ source: b.source || "back", content: b.text }))
   180	    : [];
   181	  const allTextBlocks = [...photoTextBlocks, ...backTextBlocks];
   182	
   183	  fields["status"] = "analyzed";
   184	  fields["has-text"] = allTextBlocks.length > 0;
   185	  fields["description"] = photo.description;
   186	  if (photo.rotation !== 0) fields["rotation"] = String(photo.rotation);
   187	
   188	  if (allTextBlocks.length > 0) fields["text"] = allTextBlocks;
   189	  else delete fields["text"];
   190	
   191	  if (photo.subject_bbox && photo.subject_bbox.length === 4) {
   192	    fields["subject-bbox"] = {
   193	      y1: String(photo.subject_bbox[0]),
   194	      x1: String(photo.subject_bbox[1]),
   195	      y2: String(photo.subject_bbox[2]),
   196	      x2: String(photo.subject_bbox[3]),
   197	    };
   198	  }
   199	
   200	  await fs.writeFile(cardPath, serializeCardText({ schema: parsed.schema, fields }));
   201	}

exec
/opt/homebrew/bin/bash -lc 'nl -ba callback-box/src/schemas/image.tsx' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Image card schema — photos from capture sessions.
     3	 *
     4	 * Created by the capture connector. Processed by `cb describe-images`
     5	 * (Gemini Flash) to add description, OCR text blocks, subject bbox,
     6	 * rotation, and document metadata.
     7	 *
     8	 * Layout: `photo-001.image.card` next to `photo-001.attach/photo-001.jpg`.
     9	 * `filename.ref:` points into the attach scope via the `attach/` virtual
    10	 * prefix.
    11	 */
    12	
    13	import { stringify as stringifyYaml } from "yaml";
    14	import { z } from "zod";
    15	import { cardSchema, type CardSchema } from "../cards/index.js";
    16	import { type FileLoader, titleFromFilename, truncateTitle } from "../core/file-summary.js";
    17	
    18	export const ImageStatus = z.enum(["new", "analyzed", "invalid"]);
    19	export type ImageStatus = z.infer<typeof ImageStatus>;
    20	
    21	export const ImageSource = z.enum([
    22	  "camera-user",
    23	  "camera-environment",
    24	  "gallery",
    25	  "screenshot",
    26	  "download",
    27	  "scan",
    28	  "generated",
    29	]);
    30	export type ImageSource = z.infer<typeof ImageSource>;
    31	
    32	export const ImageRotation = z.enum(["0", "90", "180", "270"]);
    33	export type ImageRotation = z.infer<typeof ImageRotation>;
    34	
    35	const FilenameEntry = z.object({
    36	  ref: z.string(),
    37	  captured: z.string().datetime({ offset: true }),
    38	  source: ImageSource,
    39	});
    40	
    41	const TextBlock = z.object({
    42	  source: z.string().optional(),
    43	  content: z.string(),
    44	});
    45	
    46	const ExifMeta = z.object({
    47	  date: z.string().datetime({ offset: true }).optional(),
    48	  camera: z.string().optional(),
    49	  gps: z.string().optional(),
    50	  width: z.string().optional(),
    51	  height: z.string().optional(),
    52	});
    53	
    54	const SubjectBbox = z.object({
    55	  y1: z.string(),
    56	  x1: z.string(),
    57	  y2: z.string(),
    58	  x2: z.string(),
    59	});
    60	
    61	const DocumentDate = z.object({
    62	  label: z.string(),
    63	  value: z.string(),
    64	});
    65	
    66	const DocumentMeta = z.object({
    67	  kind: z.string().optional(),
    68	  from: z.string().optional(),
    69	  dates: z.array(DocumentDate).optional(),
    70	});
    71	
    72	export const ImageSchema: CardSchema = cardSchema("image", {
    73	  fields: {
    74	    status: ImageStatus.default("new"),
    75	    "has-text": z.boolean().optional(),
    76	    rotation: ImageRotation.optional(),
    77	    filename: FilenameEntry,
    78	    description: z.string().optional(),
    79	    creation: z.string().optional(),
    80	    text: z.array(TextBlock).optional(),
    81	    exif: ExifMeta.optional(),
    82	    "subject-bbox": SubjectBbox.optional(),
    83	    document: DocumentMeta.optional(),
    84	  },
    85	  instructions: `# Image Cards
    86	
    87	An image card represents a photo, typically from a capture session.
    88	The attached image file lives in the card's attach scope (e.g.
    89	\`photo-001.image.card\` with \`photo-001.attach/photo-001.jpg\`);
    90	\`filename.ref:\` points into that scope via the \`attach/\` prefix.
    91	
    92	Frontmatter fields:
    93	- \`filename:\` — \`{ref, captured, source}\` for the attached image
    94	  file. \`captured\` is set from EXIF when available.
    95	- \`description:\` — one sentence describing what the image *looks
    96	  like* (filled during analysis) — the visual field, used as alt text.
    97	- \`contains:\` — one sentence stating what someone could *learn* from
    98	  this image — the retrieval field (also filled during analysis; when
    99	  absent, search falls back to \`description\`). Carry the fact when
   100	  it's concise ("Boiler serial number K-44210"), don't point at it.
   101	- \`creation:\` — optional free-text notes on how the image came to
   102	  be. Only include when there's something worth recording. For
   103	  AI-generated images (\`source: generated\`), use \`model: {modelId}\\nprompt: {prompt text}\`.
   104	- \`text:\` — array of \`{source?, content}\` entries with transcribed
   105	  text content from the image, if any. \`source\` describes what the
   106	  text is on ("whiteboard", "business card", "printed page",
   107	  "screen").
   108	- \`exif:\` — EXIF metadata extracted from the image file.
   109	- \`subject-bbox:\` — bounding box of the main subject on a 0-1000
   110	  scale (\`{y1, x1, y2, x2}\`). Present when the subject doesn't fill
   111	  the entire frame.
   112	- \`document:\` — present when the image is a photograph of a document
   113	  (bill, letter, form, receipt, statement, …). \`kind\` is a short
   114	  free-text category ("utility bill", "lab results"), \`from\` is the
   115	  issuer/sender, \`dates\` is an array of \`{label, value}\` entries.
   116	  Date values are kept as they appear in the document; normalization
   117	  happens downstream.
   118	- \`has-text\` — true if the image contains readable text, false
   119	  otherwise. Always true when a \`document:\` field is present.
   120	- \`rotation\` — degrees clockwise the image needs to be rotated to
   121	  appear upright: \`"0"\`, \`"90"\`, \`"180"\`, or \`"270"\`.
   122	
   123	Analysis is done by \`cb describe-images\`, which sends images to
   124	Gemini Flash for OCR, description, subject detection, and rotation,
   125	and extracts EXIF metadata. Pass multiple image cards or image files
   126	to process them as a batch (provides better context when images are
   127	related). Use \`--no-rename\` to skip automatic renaming.
   128	
   129	Status: new (unanalyzed) → analyzed (description filled in) → invalid
   130	(accidental capture, too blurry, not useful).`,
   131	});
   132	
   133	export interface ImageFields {
   134	  type: "image";
   135	  status: ImageStatus;
   136	  "has-text"?: boolean;
   137	  rotation?: ImageRotation;
   138	  filename: { ref: string; captured: string; source: ImageSource };
   139	  description?: string;
   140	  contains?: string;
   141	  creation?: string;
   142	  text?: Array<{ source?: string; content: string }>;
   143	  exif?: { date?: string; camera?: string; gps?: string; width?: string; height?: string };
   144	  "subject-bbox"?: { y1: string; x1: string; y2: string; x2: string };
   145	  document?: { kind?: string; from?: string; dates?: Array<{ label: string; value: string }> };
   146	}
   147	
   148	/**
   149	 * Loader summary used by the file viewer: derives a title from
   150	 * description, filename, or path. Falls back gracefully when the file
   151	 * isn't a parsed card yet.
   152	 */
   153	export interface ImageAttrs {
   154	  status: ImageStatus;
   155	  "has-text"?: boolean;
   156	  rotation?: ImageRotation;
   157	  filename?: string;
   158	}
   159	
   160	export const imageLoader: FileLoader<ImageAttrs> = (raw) => {
   161	  const fallback = titleFromFilename(raw.path);
   162	  // For Phase 2 image cards the raw input is the parsed YAML fields object.
   163	  // eslint-disable-next-line no-restricted-syntax -- raw is the loosely-typed loader input; reading the optional Phase-2 `fields` object off it requires one boundary cast.
   164	  const fields = (raw as { fields?: Partial<ImageFields> }).fields;
   165	  if (fields === undefined) {
   166	    return { path: raw.path, tagName: "image", title: fallback, attrs: { status: "new" } };
   167	  }
   168	  const description = fields.description;
   169	  const ref = fields.filename?.ref;
   170	  let title = "";
   171	  if (typeof description === "string" && description.trim() !== "") {
   172	    title = description.trim();
   173	  } else if (typeof ref === "string" && ref !== "") {
   174	    title = titleFromFilename(ref);
   175	  }
   176	  if (title === "") title = fallback;
   177	  title = truncateTitle(title, 80);
   178	  const attrs: ImageAttrs = { status: fields.status ?? "new" };
   179	  if (typeof fields["has-text"] === "boolean") attrs["has-text"] = fields["has-text"];
   180	  if (fields.rotation !== undefined) attrs.rotation = fields.rotation;
   181	  if (typeof ref === "string" && ref !== "") attrs.filename = ref;
   182	  return { path: raw.path, tagName: "image", title, attrs };
   183	};
   184	
   185	/**
   186	 * Build the file content for a new image card. Used by the capture
   187	 * connector when first storing a photo — analysis fields are filled
   188	 * in later by `cb describe-images`.
   189	 */
   190	export function createImageTemplate(options: {
   191	  capturedAt: string;
   192	  source: ImageSource;
   193	  filename: string;
   194	}): string {
   195	  const fields = {
   196	    status: "new",
   197	    filename: {
   198	      ref: `attach/${options.filename}`,
   199	      captured: options.capturedAt,
   200	      source: options.source,
   201	    },
   202	  };
   203	  return `---\n${stringifyYaml(fields)}---\n`;
   204	}

exec
/opt/homebrew/bin/bash -lc 'nl -ba callback-box/src/schemas/registry.ts' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Central schema registration with cardworks.
     3	 *
     4	 * All card schemas are registered here and exported for use
     5	 * by the CardLoader factory. Box-local schemas from config/schemas/
     6	 * are loaded dynamically at runtime.
     7	 */
     8	
     9	import { readdir } from "node:fs/promises";
    10	import { join } from "node:path";
    11	import { pathToFileURL } from "node:url";
    12	import { registerHooks } from "node:module";
    13	import { PACKAGE_ROOT } from "../lib/package-root.js";
    14	import { type CardSchema } from "../cards/index.js";
    15	import { MemoSchema } from "./memo.js";
    16	import { QuestionSchema } from "./question.js";
    17	import { FeedbackSchema } from "./feedback.js";
    18	import { ProcedureSchema } from "./procedure.js";
    19	import { ProcedureRunSchema } from "./procedure-run.js";
    20	import { ImageSchema } from "./image.js";
    21	import { AudioSchema } from "./audio.js";
    22	import { FileSchema } from "./file.js";
    23	import { CaptureSessionSchema } from "./capture-session.js";
    24	import { RecordSchema } from "./record.js";
    25	import { RecipeSchema } from "./recipe.js";
    26	import { EmailThreadSchema } from "./email-thread.js";
    27	import { EmailMessageSchema } from "./email-message.js";
    28	import { EmailOutboundSchema } from "./email-outbound.js";
    29	import { IntakeJobSchema } from "./intake-job.js";
    30	import { CalendarReviewJobSchema } from "./calendar-review-job.js";
    31	import { GuideSchema } from "./guide.js";
    32	import { ScheduledScriptSchema } from "./scheduled-script.js";
    33	import { TelegramMessageSchema } from "./telegram-message.js";
    34	import { ChatThreadSchema } from "./chat-thread.js";
    35	import { ChatJobSchema } from "./chat-job.js";
    36	import { PersonalitySchema } from "./personality.js";
    37	import { QuestionFollowupJobSchema } from "./question-followup-job.js";
    38	import { TodoListSchema } from "./todo-list.js";
    39	import { BriefingSchema } from "./briefing.js";
    40	import { PersonSchema } from "./person.js";
    41	import { SheetSchema } from "./sheet.js";
    42	import { DocSchema } from "./doc.js";
    43	import { GdocSchema } from "./gdoc.js";
    44	import { CommentarySchema } from "./commentary.js";
    45	import { WebpageSchema } from "./webpage.js";
    46	import { ExtfileSchema } from "./extfile.js";
    47	import { LandmarkSchema } from "./landmark.js";
    48	import { registerTemplate, type TemplateDefinition } from "./templates.js";
    49	
    50	/**
    51	 * Markdown-frontmatter card schemas. Loaded into a Map<type, CardSchema> by
    52	 * createCardSchemaMap below.
    53	 */
    54	export const cardSchemas: CardSchema[] = [
    55	  CaptureSessionSchema,
    56	  GuideSchema,
    57	  LandmarkSchema,
    58	  ProcedureSchema,
    59	  ProcedureRunSchema,
    60	  RecipeSchema,
    61	  EmailThreadSchema,
    62	  EmailMessageSchema,
    63	  EmailOutboundSchema,
    64	  BriefingSchema,
    65	  DocSchema,
    66	  GdocSchema,
    67	  CommentarySchema,
    68	  WebpageSchema,
    69	  ExtfileSchema,
    70	  SheetSchema,
    71	  FileSchema,
    72	  ImageSchema,
    73	  AudioSchema,
    74	  RecordSchema,
    75	  PersonSchema,
    76	  MemoSchema,
    77	  TodoListSchema,
    78	  TelegramMessageSchema,
    79	  FeedbackSchema,
    80	  IntakeJobSchema,
    81	  CalendarReviewJobSchema,
    82	  ChatJobSchema,
    83	  QuestionFollowupJobSchema,
    84	  PersonalitySchema,
    85	  ScheduledScriptSchema,
    86	  QuestionSchema,
    87	  ChatThreadSchema,
    88	];
    89	
    90	/**
    91	 * Specifiers a box-local schema file may import from callback-box's tree:
    92	 * - `callback-box/cards` — the public card-primitive surface (cardSchema,
    93	 *   body, splitCardContent, …); the specifier new box schemas should use.
    94	 * - `zod` — peer dependency every schema needs.
    95	 * - `yaml` — frontmatter card templates `stringify` their fields with it (the
    96	 *   scaffolding in box-templates.ts shows exactly this).
    97	 */
    98	const SCHEMA_DEPS = new Set(["callback-box", "zod", "yaml"]);
    99	
   100	/**
   101	 * Virtual parent URL at callback-box's package root (NOT inside
   102	 * node_modules). Rewriting a box schema's parentURL to this makes Node
   103	 * resolve bare deps (`zod`, `yaml`) from callback-box's node_modules
   104	 * AND self-references (`callback-box/cards`) via callback-box's own
   105	 * `exports` map. Pointing it *inside* node_modules would break the
   106	 * self-reference: Node's LOOKUP_PACKAGE_SCOPE returns null at a
   107	 * node_modules boundary, so the package's own exports never match. The
   108	 * file need not exist — only the directory's package.json scope is read.
   109	 */
   110	const CB_VIRTUAL_PARENT = pathToFileURL(join(PACKAGE_ROOT, "_virtual.js")).href;
   111	
   112	/**
   113	 * Register module resolution hooks so that box-local schema files
   114	 * (under config/schemas/) can import `callback-box/cards`, `zod`, and
   115	 * `yaml` even though none of those resolve from the box's own
   116	 * node_modules.
   117	 *
   118	 * Uses Node's synchronous registerHooks API which chains correctly
   119	 * with tsx's async loader hooks.
   120	 */
   121	let hooksRegistered = false;
   122	function ensureResolveHooks(): void {
   123	  if (hooksRegistered) return;
   124	  hooksRegistered = true;
   125	
   126	  registerHooks({
   127	    // eslint-disable-next-line max-params -- Node's registerHooks API requires 3 params
   128	    resolve(specifier, context, nextResolve) {
   129	      // Check if a box schema file is importing a known package
   130	      const bare = specifier.split("/")[0] ?? "";
   131	      if (
   132	        SCHEMA_DEPS.has(bare) &&
   133	        context.parentURL?.includes("/config/schemas/")
   134	      ) {
   135	        // Resolve as if imported from callback-box's node_modules
   136	        return nextResolve(specifier, {
   137	          ...context,
   138	          parentURL: CB_VIRTUAL_PARENT,
   139	        });
   140	      }
   141	      return nextResolve(specifier, context);
   142	    },
   143	  });
   144	}
   145	
   146	/**
   147	 * Ensure config/schemas/ has a package.json with "type": "module"
   148	 * so Node treats .ts files as ESM (needed for registerHooks to apply).
   149	 */
   150	async function ensureEsmPackageJson(schemasDir: string): Promise<void> {
   151	  const pkgJsonPath = join(schemasDir, "package.json");
   152	  try {
   153	    const { stat } = await import("node:fs/promises");
   154	    await stat(pkgJsonPath);
   155	  } catch (_e) {
   156	    // package.json is absent (stat throws ENOENT) — that's the expected
   157	    // trigger to create it; the error carries no other actionable info.
   158	    const { writeFile } = await import("node:fs/promises");
   159	    await writeFile(pkgJsonPath, '{"type":"module"}\n');
   160	  }
   161	}
   162	
   163	/**
   164	 * Box-local schemas, segregated by format. A box's `config/schemas/*.ts`
   165	 * files default-export a frontmatter `cardSchema()`.
   166	 */
   167	export interface BoxSchemas {
   168	  /** Frontmatter card schemas (CardSchema, keyed by `.type`). */
   169	  cardSchemas: CardSchema[];
   170	}
   171	
   172	/**
   173	 * Per-boxRoot cache. loadBoxSchemas is called from ~24 sites (every place
   174	 * that builds a card-schema map); without this, each would re-readdir and
   175	 * re-import. Node already permanently caches the dynamic `import()` by URL,
   176	 * so a process never sees on-disk schema edits anyway — caching the readdir
   177	 * + branch result alongside it changes nothing observable and avoids the
   178	 * repeated I/O. `cb` commands are fresh processes, so edits are picked up on
   179	 * the next invocation; long-lived dev servers already required a restart to
   180	 * see schema changes (the import cache), and still do.
   181	 */
   182	const boxSchemaCache = new Map<string, BoxSchemas>();
   183	
   184	/**
   185	 * Load box-local schemas from config/schemas/*.ts.
   186	 *
   187	 * Each file should default-export a frontmatter `cardSchema()`. Optionally it
   188	 * can also export a `template` (TemplateDefinition) for `cb create`.
   189	 *
   190	 * Errors in individual files are logged as warnings, not fatal.
   191	 */
   192	export async function loadBoxSchemas(boxRoot: string): Promise<BoxSchemas> {
   193	  const cached = boxSchemaCache.get(boxRoot);
   194	  if (cached) return cached;
   195	
   196	  const result = await loadBoxSchemasUncached(boxRoot);
   197	  boxSchemaCache.set(boxRoot, result);
   198	  return result;
   199	}
   200	
   201	async function loadBoxSchemasUncached(boxRoot: string): Promise<BoxSchemas> {
   202	  const empty: BoxSchemas = { cardSchemas: [] };
   203	  const schemasDir = join(boxRoot, "config/schemas");
   204	  let files: string[];
   205	  try {
   206	    files = await readdir(schemasDir);
   207	  } catch (e) {
   208	    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
   209	      console.warn(`Could not read box schemas dir ${schemasDir}, skipping box-local schemas:`, e);
   210	    }
   211	    return empty;
   212	  }
   213	
   214	  const tsFiles = files.filter(f => f.endsWith(".ts") && !f.startsWith("."));
   215	  if (tsFiles.length === 0) return empty;
   216	
   217	  const loadedCard: CardSchema[] = [];
   218	
   219	  // Ensure package.json with "type": "module" so .ts files load as ESM,
   220	  // and register resolve hooks so bare specifiers (callback-box/cards, zod,
   221	  // yaml) resolve from callback-box's node_modules.
   222	  await ensureEsmPackageJson(schemasDir);
   223	  ensureResolveHooks();
   224	
   225	  for (const file of tsFiles) {
   226	    try {
   227	      const filePath = join(schemasDir, file);
   228	      const mod = await import(pathToFileURL(filePath).href);
   229	      const def: unknown = mod.default;
   230	
   231	      if (isCardSchema(def)) {
   232	        loadedCard.push(def);
   233	      } else {
   234	        console.warn(`Warning: ${file} does not export a default cardSchema(), skipping`);
   235	        continue;
   236	      }
   237	
   238	      if (mod.template) {
   239	        registerTemplate(mod.template as TemplateDefinition);
   240	      }
   241	    } catch (err) {
   242	      console.warn(`Warning: failed to load box schema ${file}: ${(err as Error).message}`);
   243	    }
   244	  }
   245	
   246	  return { cardSchemas: loadedCard };
   247	}
   248	
   249	function isCardSchema(def: unknown): def is CardSchema {
   250	  return (
   251	    typeof def === "object"
   252	    && def !== null
   253	    && typeof (def as CardSchema).type === "string"
   254	    && "frontmatterSchema" in def
   255	  );
   256	}
   257	
   258	/**
   259	 * Get the list of known card types (built-in frontmatter schemas).
   260	 */
   261	export function getCardTypes(): string[] {
   262	  return cardSchemas.map(s => s.type);
   263	}
   264	
   265	/**
   266	 * Get the card types that belong in content search indexes — every type
   267	 * whose schema doesn't set `searchable: false`. Includes box-local schemas
   268	 * when a boxRoot is given (they default to searchable).
   269	 */
   270	export async function getSearchableTypes(boxRoot?: string): Promise<string[]> {
   271	  const boxCardSchemas = boxRoot ? (await loadBoxSchemas(boxRoot)).cardSchemas : [];
   272	  const allCardSchemas = [...cardSchemas, ...boxCardSchemas];
   273	  return allCardSchemas.filter(s => s.searchable).map(s => s.type);
   274	}
   275	
   276	/**
   277	 * Check if a card type is known.
   278	 */
   279	export function isKnownCardType(type: string): boolean {
   280	  return cardSchemas.some(s => s.type === type);
   281	}
   282	
   283	/**
   284	 * Build a Map<type, CardSchema> for the markdown-frontmatter loader path.
   285	 *
   286	 * When boxRoot is given, box-local frontmatter schemas (from
   287	 * config/schemas/*.ts) are merged in on top of the built-in ones, so box
   288	 * card types parse and validate as first-class. A box schema whose type
   289	 * collides with a built-in wins (last write) — boxes can override.
   290	 */
   291	export async function createCardSchemaMap(boxRoot?: string): Promise<Map<string, CardSchema>> {
   292	  const map = new Map<string, CardSchema>();
   293	  for (const schema of cardSchemas) {
   294	    map.set(schema.type, schema);
   295	  }
   296	  if (boxRoot) {
   297	    const { cardSchemas: boxCardSchemas } = await loadBoxSchemas(boxRoot);
   298	    for (const schema of boxCardSchemas) {
   299	      map.set(schema.type, schema);
   300	    }
   301	  }
   302	  return map;
   303	}
   304	
   305	// Re-export individual schemas for direct access
   306	export { MemoSchema } from "./memo.js";
   307	export { QuestionSchema } from "./question.js";
   308	export { FeedbackSchema } from "./feedback.js";
   309	export { ProcedureSchema } from "./procedure.js";
   310	export { ProcedureRunSchema } from "./procedure-run.js";
   311	export { ImageSchema } from "./image.js";
   312	export { AudioSchema } from "./audio.js";
   313	export { FileSchema } from "./file.js";
   314	export { CaptureSessionSchema } from "./capture-session.js";
   315	export { RecordSchema } from "./record.js";
   316	export { RecipeSchema } from "./recipe.js";
   317	export { EmailThreadSchema } from "./email-thread.js";
   318	export { EmailMessageSchema } from "./email-message.js";
   319	export { EmailOutboundSchema } from "./email-outbound.js";
   320	export { IntakeJobSchema } from "./intake-job.js";
   321	export { CalendarReviewJobSchema } from "./calendar-review-job.js";
   322	export { GuideSchema } from "./guide.js";
   323	export { ScheduledScriptSchema } from "./scheduled-script.js";
   324	export { TelegramMessageSchema } from "./telegram-message.js";
   325	export { ChatThreadSchema } from "./chat-thread.js";
   326	export { ChatJobSchema } from "./chat-job.js";
   327	export { PersonalitySchema } from "./personality.js";
   328	export { QuestionFollowupJobSchema } from "./question-followup-job.js";
   329	export { TodoListSchema } from "./todo-list.js";
   330	export { BriefingSchema } from "./briefing.js";
   331	export { PersonSchema } from "./person.js";
   332	export { SheetSchema } from "./sheet.js";
   333	export { DocSchema } from "./doc.js";
   334	export { GdocSchema } from "./gdoc.js";
   335	export { ExtfileSchema } from "./extfile.js";
   336	export { LandmarkSchema } from "./landmark.js";

exec
/opt/homebrew/bin/bash -lc 'nl -ba callback-box/scripts/build-cli.mjs' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	// Bundles the CLI (src/cli/index.ts) into a single dist/cli.mjs for fast
     2	// cold starts — collapsing our ~hundreds of source modules into one file
     3	// removes the per-module ESM loader-hook overhead that dominates tsx startup.
     4	//
     5	// node_modules are externalized (`packages: "external"`): native addons like
     6	// better-sqlite3 can't be bundled, and loading deps from disk keeps their own
     7	// __dirname / asset resolution intact.
     8	//
     9	// An external sourcemap (cli.mjs.map) gives real stack traces under
    10	// `node --enable-source-maps` without slowing startup — node loads the map
    11	// lazily, only when formatting an error. We build into a temp dir and rename
    12	// both files in, so a concurrent `cb` invocation (bin/cb self-heals on
    13	// staleness) never sees a half-written bundle.
    14	import { build } from "esbuild";
    15	import { rename, rm } from "node:fs/promises";
    16	import { join } from "node:path";
    17	
    18	const root = join(import.meta.dirname, "..");
    19	const distDir = join(root, "dist");
    20	const tmpDir = join(distDir, `.build-${process.pid}`);
    21	
    22	const t = process.hrtime.bigint();
    23	await build({
    24	  entryPoints: [join(root, "src/cli/index.ts")],
    25	  // Build "cli.mjs" inside a temp dir so the emitted //# sourceMappingURL is
    26	  // the relative "cli.mjs.map", which stays correct after we move both into dist/.
    27	  outfile: join(tmpDir, "cli.mjs"),
    28	  bundle: true,
    29	  platform: "node",
    30	  format: "esm",
    31	  target: "node22",
    32	  packages: "external",
    33	  sourcemap: true,
    34	  logLevel: "warning",
    35	});
    36	
    37	// Move the map first, then the .mjs, so the bundle never references a
    38	// not-yet-present map. rename() is atomic within the same filesystem.
    39	await rename(join(tmpDir, "cli.mjs.map"), join(distDir, "cli.mjs.map"));
    40	await rename(join(tmpDir, "cli.mjs"), join(distDir, "cli.mjs"));
    41	await rm(tmpDir, { recursive: true, force: true });
    42	
    43	// Also build the public card-primitive layer (the `callback-box/cards` export)
    44	// to a single bundled dist/cards/index.js. Box-local schema files import this
    45	// specifier; it must be plain JS with no TS-source `.js` re-exports, because
    46	// the CLI loads box schemas with Node's native type-stripping (under the
    47	// dist/cli.mjs bundle) which does NOT remap `./schema.js` → `schema.ts`.
    48	// Bundling collapses src/cards/{schema,frontmatter,lint-format,errors}.ts into
    49	// one file, so there are no internal `.js` specifiers to resolve; zod/yaml stay
    50	// external (resolved from node_modules at runtime).
    51	await build({
    52	  entryPoints: [join(root, "src/cards/index.ts")],
    53	  outfile: join(distDir, "cards", "index.js"),
    54	  bundle: true,
    55	  platform: "node",
    56	  format: "esm",
    57	  target: "node22",
    58	  packages: "external",
    59	  sourcemap: true,
    60	  logLevel: "warning",
    61	});
    62	
    63	const ms = Number(process.hrtime.bigint() - t) / 1e6;
    64	process.stderr.write(`built dist/cli.mjs in ${ms | 0}ms\n`);

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/package.json | sed -n '1,120p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/deploy/deploy.sh | sed -n '1,190p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	{
     2	  "name": "callback-box",
     3	  "version": "0.1.0",
     4	  "description": "A Claude Code wrapper system for file-based processing",
     5	  "type": "module",
     6	  "main": "dist/cli/index.js",
     7	  "exports": {
     8	    ".": "./dist/cli/index.js",
     9	    "./cards": "./dist/cards/index.js"
    10	  },
    11	  "bin": {
    12	    "cb": "./bin/cb"
    13	  },
    14	  "scripts": {
    15	    "build": "tsc",
    16	    "build:frontend": "cd src/frontend && pnpm build",
    17	    "build:all": "pnpm build && pnpm build:frontend",
    18	    "build:cli": "node scripts/build-cli.mjs",
    19	    "dev": "echo 'The dev server is the monorepo router. Run \\`pnpm dev\\` from the monorepo root.' && exit 1",
    20	    "cb": "./bin/cb",
    21	    "typecheck": "tsc --noEmit && cd src/frontend && pnpm exec tsc --noEmit",
    22	    "typecheck:frontend": "cd src/frontend && pnpm typecheck",
    23	    "typecheck:all": "pnpm typecheck && pnpm typecheck:frontend",
    24	    "lint": "eslint src/ && cd src/frontend && pnpm exec eslint src/",
    25	    "start": "node dist/webapp/server.js",
    26	    "cli": "node dist/cli/index.js",
    27	    "pretest": "node scripts/build-cli.mjs",
    28	    "test": "tap",
    29	    "test:manual": "tap 'test/manual/**/*.doctest.md' 'test/manual/**/*.test.ts'",
    30	    "knowledge-audit": "tsx src/dev/knowledge-audit.ts",
    31	    "prompt-report": "tsx src/dev/prompt-report.ts",
    32	    "generate:doc-images": "tsx src/dev/generate-doc-images.ts",
    33	    "doc-graph": "tsx src/dev/doc-graph.ts > docs/doc-graph.md",
    34	    "doc-graph-html": "tsx src/dev/doc-graph-html.ts",
    35	    "test:watch": "tap --watch",
    36	    "lint:oxlint": "oxlint -A no-unused-vars",
    37	    "lint:knip": "knip",
    38	    "lint:circular": "madge --circular --extensions ts,tsx src/"
    39	  },
    40	  "keywords": [
    41	    "claude",
    42	    "automation",
    43	    "inbox",
    44	    "procedure"
    45	  ],
    46	  "author": "",
    47	  "license": "ISC",
    48	  "devDependencies": {
    49	    "@ianbicking/personal-vibe-check": "workspace:*",
    50	    "@types/chokidar": "^1.7.5",
    51	    "@types/node": "^22.0.0",
    52	    "@types/xml2js": "^0.4.14",
    53	    "agent-doctest": "workspace:*",
    54	    "axe-core": "^4.11.4",
    55	    "eslint": "^9.39.2",
    56	    "eslint-import-resolver-typescript": "^4.4.4",
    57	    "husky": "^9.1.7",
    58	    "knip": "^5.83.1",
    59	    "lint-staged": "^16.2.7",
    60	    "madge": "^8.0.0",
    61	    "oxlint": "^1.47.0",
    62	    "tap": "^21.0.0",
    63	    "tsx": "^4.21.0",
    64	    "typescript": "^5.7.0"
    65	  },
    66	  "dependencies": {
    67	    "@anthropic-ai/claude-agent-sdk": "^0.2.128",
    68	    "@fastify/cookie": "^11.0.2",
    69	    "@fastify/multipart": "^9.4.0",
    70	    "@fastify/static": "^9.0.0",
    71	    "@fastify/websocket": "^11.2.0",
    72	    "@google/genai": "^1.44.0",
    73	    "@markdoc/markdoc": "^0.5.7",
    74	    "@modelcontextprotocol/sdk": "^1.29.0",
    75	    "@orama/orama": "^3.1.18",
    76	    "@orama/plugin-data-persistence": "^3.1.18",
    77	    "@parcel/markdown-ansi": "^2.16.3",
    78	    "@trpc/server": "^11.11.0",
    79	    "@types/better-sqlite3": "^7.6.13",
    80	    "@types/turndown": "^5.0.6",
    81	    "@types/ws": "^8.18.1",
    82	    "ansi-to-html": "^0.7.2",
    83	    "better-sqlite3": "^12.6.2",
    84	    "chalk": "^5.6.2",
    85	    "cheerio": "^1.2.0",
    86	    "chokidar": "^5.0.0",
    87	    "commander": "^13.0.0",
    88	    "cron-parser": "^5.5.0",
    89	    "esbuild": "^0.25.0",
    90	    "execa": "^9.6.1",
    91	    "exifr": "^7.1.3",
    92	    "fastify": "^5.7.2",
    93	    "glob": "^13.0.0",
    94	    "google-auth-library": "^10.5.0",
    95	    "grammy": "^1.40.1",
    96	    "ical.js": "^2.2.1",
    97	    "ky": "^1.14.3",
    98	    "markdownlint": "^0.40.0",
    99	    "open": "^11.0.0",
   100	    "react-virtuoso": "^4.18.6",
   101	    "rrule": "^2.8.1",
   102	    "sanitize-filename": "^1.6.3",
   103	    "simple-git": "^3.32.3",
   104	    "turndown": "^7.2.2",
   105	    "xml2js": "^0.6.2",
   106	    "yaml": "^2.7.0",
   107	    "zod": "^4.4.3"
   108	  },
   109	  "overrides": {
   110	    "react": "^18.3.1",
   111	    "react-dom": "^18.3.1"
   112	  },
   113	  "lint-staged": {
   114	    "src/frontend/src/**/*.{ts,tsx,js}": [
   115	      "eslint --config src/frontend/eslint.config.mjs"
   116	    ],
   117	    "src/!(frontend)/**/*.ts": [
   118	      "eslint"
   119	    ]
   120	  }

 succeeded in 0ms:
     1	#!/usr/bin/env bash
     2	set -euo pipefail
     3	
     4	# Deploy from local working tree to server via rsync.
     5	# Syncs all three repos, builds frontend locally first, restarts services.
     6	# Usage: ./deploy/deploy.sh [--skip-frontend] [--skip-restart]
     7	
     8	SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
     9	REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
    10	MONO_DIR="$(cd "$REPO_DIR/.." && pwd)"
    11	SERVER_IP=$(cat "$SCRIPT_DIR/server-ip")
    12	INSTALL_DIR="/opt/callback"
    13	
    14	SKIP_FRONTEND=false
    15	SKIP_RESTART=false
    16	for arg in "$@"; do
    17	  case "$arg" in
    18	    --skip-frontend) SKIP_FRONTEND=true ;;
    19	    --skip-restart) SKIP_RESTART=true ;;
    20	  esac
    21	done
    22	
    23	RSYNC_OPTS=(-az --delete
    24	  --exclude node_modules
    25	  --exclude .git
    26	  --exclude '*.secret.json'
    27	  --exclude '*.state.json'
    28	  --exclude '.last-deploy.log'
    29	  --exclude '.env'
    30	  --exclude '.thinking/'
    31	  --exclude '.claude/'
    32	  --exclude 'deploy-info.json'
    33	  --exclude 'deploy-history.json'
    34	)
    35	
    36	# Reconcile local node_modules to the committed lockfile before any local
    37	# build. A just-merged dependency change (added/removed dep) otherwise builds
    38	# the frontend/cardworks against stale modules and fails — this has bitten the
    39	# auto-deploy repeatedly. Frozen so it's deterministic and never rewrites the
    40	# lockfile; a no-op when already in sync.
    41	echo "Reconciling local deps..."
    42	(cd "$MONO_DIR" && HUSKY=0 pnpm install --frozen-lockfile --silent)
    43	
    44	# Build frontend locally (fast — already has node_modules)
    45	if [[ "$SKIP_FRONTEND" != true ]]; then
    46	  echo "Building frontend..."
    47	  cd "$REPO_DIR/src/frontend" && pnpm --silent build
    48	fi
    49	
    50	# Build the CLI bundle locally before syncing. dist/ is rsynced (not excluded),
    51	# and while the server runs cb via tsx (not the bundle), it DOES need
    52	# dist/cards/index.js on disk: box-local schema files import `callback-box/cards`,
    53	# which package.json `exports` maps to ./dist/cards/index.js (a plain-JS build of
    54	# the card-primitive layer, emitted by build-cli.mjs alongside dist/cli.mjs). If
    55	# that file is missing or stale on the server, every box-local schema fails to
    56	# load. Building here keeps dist/ in lockstep with the source we rsync.
    57	echo "Building CLI bundle (dist/cli.mjs + dist/cards)..."
    58	cd "$REPO_DIR" && node scripts/build-cli.mjs >/dev/null
    59	
    60	# Sync monorepo packages. These are pnpm workspace members linked via
    61	# `workspace:*` deps, so they must all be present alongside callback-box on the
    62	# server for the root `pnpm install` to resolve. personal-vibe-check and
    63	# agent-doctest are devDeps of callback-box (the server install is non-prod
    64	# because the runtime uses tsx, itself a devDep).
    65	# browse/agent-browser-typed are deliberately NOT synced — they're dev-only
    66	# tooling and a partial workspace installs fine (pnpm ignores absent members).
    67	for repo in personal-vibe-check agent-doctest callback-box; do
    68	  local_path="$MONO_DIR/$repo/"
    69	  if [[ ! -d "$local_path" ]]; then
    70	    echo "  $repo: not found at $local_path, skipping"
    71	    continue
    72	  fi
    73	  echo "Syncing $repo..."
    74	  rsync "${RSYNC_OPTS[@]}" "$local_path" "root@$SERVER_IP:$INSTALL_DIR/$repo/"
    75	done
    76	
    77	# Sync the workspace root itself. With workspace deps, /opt/callback becomes the
    78	# pnpm workspace root: the single root lockfile + manifest + .npmrc + patches
    79	# drive one reproducible `pnpm install --frozen-lockfile` from there (below).
    80	# These are individual files, so no --delete (it would nuke the synced subdirs).
    81	echo "Syncing workspace root..."
    82	rsync -az \
    83	  "$MONO_DIR/package.json" \
    84	  "$MONO_DIR/pnpm-workspace.yaml" \
    85	  "$MONO_DIR/.npmrc" \
    86	  "$MONO_DIR/pnpm-lock.yaml" \
    87	  "root@$SERVER_IP:$INSTALL_DIR/"
    88	rsync -az --delete "$MONO_DIR/patches/" "root@$SERVER_IP:$INSTALL_DIR/patches/"
    89	
    90	# Install deps if package-lock changed (compare hash)
    91	echo "Checking dependencies..."
    92	ssh -A "root@$SERVER_IP" bash -s <<'REMOTE'
    93	  set -e
    94	  # Bootstrap pnpm on demand. corepack ships with Node 22; this is idempotent
    95	  # and a no-op if pnpm is already on PATH.
    96	  if ! command -v pnpm >/dev/null 2>&1; then
    97	    echo "  Bootstrapping pnpm via corepack..."
    98	    corepack enable pnpm
    99	  fi
   100	  # One-time migration: personal-vibe-check moved from /opt/personal-vibe-check
   101	  # (when it was an external sibling repo) to /opt/callback/personal-vibe-check
   102	  # (now a monorepo sibling). Once the new path is populated and the deploy is
   103	  # confirmed working, the old dir is dead weight. Remove it idempotently.
   104	  if [[ -d /opt/callback/personal-vibe-check && -d /opt/personal-vibe-check ]]; then
   105	    echo "  Removing stale /opt/personal-vibe-check (superseded by /opt/callback/personal-vibe-check)..."
   106	    rm -rf /opt/personal-vibe-check
   107	  fi
   108	  # One-time cleanup: the cardworks package was removed (absorbed into
   109	  # callback-box/src/cards). The deploy no longer syncs it, so an old
   110	  # /opt/callback/cardworks just lingers — drop it idempotently.
   111	  if [[ -d /opt/callback/cardworks ]]; then
   112	    echo "  Removing stale /opt/callback/cardworks (package removed)..."
   113	    rm -rf /opt/callback/cardworks
   114	  fi
   115	  # One-time cutover from the old per-subdir installs to a single workspace
   116	  # install. Before this change each subdir had its own isolated node_modules;
   117	  # the workspace uses a hoisted node_modules at the root. Remove the legacy
   118	  # per-package trees once (keyed on the root node_modules not yet existing) so
   119	  # nothing stale shadows the hoisted layout — the exact class of bug this
   120	  # migration fixes. After the first workspace deploy this branch is skipped.
   121	  if [[ ! -d /opt/callback/node_modules ]]; then
   122	    echo "  First workspace deploy: clearing legacy per-package node_modules..."
   123	    rm -rf /opt/callback/cardworks/node_modules \
   124	           /opt/callback/personal-vibe-check/node_modules \
   125	           /opt/callback/agent-doctest/node_modules \
   126	           /opt/callback/callback-box/node_modules \
   127	           /opt/callback/callback-box/src/frontend/node_modules
   128	  fi
   129	  # Reconcile the whole workspace to the synced lockfile in one frozen install
   130	  # from the workspace root. --frozen-lockfile makes the server resolution match
   131	  # dev byte-for-byte (and fails loudly if the lockfile is stale rather than
   132	  # silently resolving something new). HUSKY=0 skips husky's hook install (no
   133	  # .git on the server) so it doesn't print a spurious ".git can't be found".
   134	  # patch-package still runs via the root postinstall to patch eslint-config-agent.
   135	  cd /opt/callback
   136	  echo "  Reconciling workspace deps (frozen)..."
   137	  HUSKY=0 pnpm install --frozen-lockfile
   138	REMOTE
   139	
   140	# Write deploy info (git hashes + timestamp).
   141	# Build the JSON via node so JSON.stringify escapes subjects correctly —
   142	# commit subjects can contain quotes, backslashes, etc. that break naive
   143	# shell interpolation. Values come through env vars to avoid any shell
   144	# expansion in the node script body.
   145	echo "Writing deploy info..."
   146	DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
   147	CALLBACK_BOX_HASH=""
   148	CALLBACK_BOX_SUBJECT=""
   149	if [[ -d "$MONO_DIR/callback-box/.git" ]]; then
   150	  CALLBACK_BOX_HASH=$(cd "$MONO_DIR/callback-box" && git rev-parse --short HEAD)
   151	  CALLBACK_BOX_SUBJECT=$(cd "$MONO_DIR/callback-box" && git log -1 --format=%s)
   152	fi
   153	DEPLOY_INFO=$(DEPLOYED_AT="$DEPLOYED_AT" \
   154	  CALLBACK_BOX_HASH="$CALLBACK_BOX_HASH" CALLBACK_BOX_SUBJECT="$CALLBACK_BOX_SUBJECT" \
   155	  node -e '
   156	const out = { deployedAt: process.env.DEPLOYED_AT, commits: {} };
   157	if (process.env.CALLBACK_BOX_HASH) {
   158	  out.commits["callback-box"] = { hash: process.env.CALLBACK_BOX_HASH, subject: process.env.CALLBACK_BOX_SUBJECT };
   159	}
   160	process.stdout.write(JSON.stringify(out, null, 2) + "\n");
   161	')
   162	ssh "root@$SERVER_IP" "cat > $INSTALL_DIR/callback-box/deploy-info.json" <<< "$DEPLOY_INFO"
   163	
   164	# Append to deploy history (keep last 20 entries)
   165	ssh "root@$SERVER_IP" bash -s <<HISTEOF
   166	  HIST_FILE="$INSTALL_DIR/callback-box/deploy-history.json"
   167	  if [[ -f "\$HIST_FILE" ]]; then
   168	    # Prepend new entry, keep last 20
   169	    node -e "
   170	      const fs = require('fs');
   171	      const hist = JSON.parse(fs.readFileSync('\$HIST_FILE', 'utf-8'));
   172	      const entry = JSON.parse(fs.readFileSync('$INSTALL_DIR/callback-box/deploy-info.json', 'utf-8'));
   173	      hist.unshift(entry);
   174	      fs.writeFileSync('\$HIST_FILE', JSON.stringify(hist.slice(0, 20), null, 2));
   175	    "
   176	  else
   177	    node -e "
   178	      const fs = require('fs');
   179	      const entry = JSON.parse(fs.readFileSync('$INSTALL_DIR/callback-box/deploy-info.json', 'utf-8'));
   180	      fs.writeFileSync('\$HIST_FILE', JSON.stringify([entry], null, 2));
   181	    "
   182	  fi
   183	HISTEOF
   184	
   185	# Restart services
   186	if [[ "$SKIP_RESTART" != true ]]; then
   187	  echo "Restarting services..."
   188	  ssh "root@$SERVER_IP" 'systemctl restart callback-serve callback-scheduler && echo "Services restarted"'
   189	
   190	  # Verify /healthz responds with 200 — proves the process came back up

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/bin/cb | sed -n '1,130p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	#!/usr/bin/env bash
     2	# Callback Box CLI wrapper.
     3	#
     4	# Runs a bundled, single-file build of the CLI (dist/cli.mjs) for fast cold
     5	# starts. The bundle collapses the source module graph into one file, avoiding
     6	# the per-module tsx loader-hook overhead that makes plain `tsx src/cli` slow.
     7	#
     8	# Hybrid behavior:
     9	#   - Prod (CB_CLI_PREBUILT set): trust the bundle, no staleness check.
    10	#   - Dev (default): self-heal — rebuild the bundle when any backend source is
    11	#     newer than it, then run it. If a build ever fails, fall back to tsx so
    12	#     `cb` always works.
    13	
    14	# Resolve symlinks to get the real script location
    15	SOURCE="${BASH_SOURCE[0]}"
    16	while [ -L "$SOURCE" ]; do
    17	  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
    18	  SOURCE="$(readlink "$SOURCE")"
    19	  # If $SOURCE was a relative symlink, resolve it relative to the symlink's directory
    20	  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
    21	done
    22	SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
    23	PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
    24	
    25	BUNDLE="$PROJECT_DIR/dist/cli.mjs"
    26	# V8 compile cache — caches bytecode of the bundle across runs (~20% faster).
    27	export NODE_COMPILE_CACHE="$PROJECT_DIR/dist/.compile-cache"
    28	
    29	run_bundle() {
    30	  exec node --disable-warning=DEP0040 --enable-source-maps "$BUNDLE" "$@"
    31	}
    32	
    33	run_tsx() {
    34	  # Resolve tsx's real install dir rather than assuming it sits in this
    35	  # package's own node_modules. Under the pnpm workspace (node-linker=hoisted)
    36	  # tsx is hoisted to the workspace-root node_modules, not callback-box's — so
    37	  # a hardcoded ./node_modules/tsx path is wrong on the server (and anywhere
    38	  # the workspace hoists). require.resolve walks up from PROJECT_DIR and finds
    39	  # it wherever it landed. This is the path prod actually runs: the dist bundle
    40	  # rebuild fails on the server (dist/ is owned by the deploying user, not the
    41	  # callback service user), so cb self-heals through tsx every time.
    42	  local tsx_dir
    43	  tsx_dir="$(node -e "process.stdout.write(require('path').dirname(require.resolve('tsx/package.json',{paths:['$PROJECT_DIR']})))")"
    44	  exec node \
    45	    --disable-warning=DEP0040 \
    46	    --import "file://$PROJECT_DIR/tsx-preload.mjs" \
    47	    --require "$tsx_dir/dist/preflight.cjs" \
    48	    --import "file://$tsx_dir/dist/loader.mjs" \
    49	    "$PROJECT_DIR/src/cli/index.ts" "$@"
    50	}
    51	
    52	# Prod fast path: a deploy built the bundle and source won't change underneath
    53	# us, so skip the staleness scan entirely.
    54	if [ -n "$CB_CLI_PREBUILT" ] && [ -f "$BUNDLE" ]; then
    55	  run_bundle "$@"
    56	fi
    57	
    58	# Dev: rebuild if the bundle is missing or any backend source (.ts, excluding
    59	# the frontend tree, which is spawned separately and not in the bundle) is
    60	# newer than it. Pruning src/frontend keeps this scan ~5ms even on a fresh
    61	# bundle. package.json is checked too so dependency changes trigger a rebuild.
    62	needs_build=0
    63	if [ ! -f "$BUNDLE" ]; then
    64	  needs_build=1
    65	elif [ "$PROJECT_DIR/package.json" -nt "$BUNDLE" ]; then
    66	  needs_build=1
    67	elif [ -n "$(find "$PROJECT_DIR/src" -path "$PROJECT_DIR/src/frontend" -prune -o -name '*.ts' -newer "$BUNDLE" -print -quit 2>/dev/null)" ]; then
    68	  needs_build=1
    69	fi
    70	
    71	if [ "$needs_build" = 1 ]; then
    72	  if ! node "$PROJECT_DIR/scripts/build-cli.mjs" >/dev/null 2>&1; then
    73	    # Build failed — fall back to running source directly via tsx.
    74	    run_tsx "$@"
    75	  fi
    76	fi
    77	
    78	if [ -f "$BUNDLE" ]; then
    79	  run_bundle "$@"
    80	else
    81	  run_tsx "$@"
    82	fi

exec
/opt/homebrew/bin/bash -lc 'rg -n "dist/cards|dist/cli|dist/" callback-box/.gitignore callback-box/deploy callback-box/package.json callback-box/scripts callback-box/bin .gitignore' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/.gitignore:2:dist/
.gitignore:2:dist/
callback-box/package.json:6:  "main": "dist/cli/index.js",
callback-box/package.json:8:    ".": "./dist/cli/index.js",
callback-box/package.json:9:    "./cards": "./dist/cards/index.js"
callback-box/package.json:25:    "start": "node dist/webapp/server.js",
callback-box/package.json:26:    "cli": "node dist/cli/index.js",
callback-box/bin/cb:4:# Runs a bundled, single-file build of the CLI (dist/cli.mjs) for fast cold
callback-box/bin/cb:25:BUNDLE="$PROJECT_DIR/dist/cli.mjs"
callback-box/bin/cb:27:export NODE_COMPILE_CACHE="$PROJECT_DIR/dist/.compile-cache"
callback-box/bin/cb:40:  # rebuild fails on the server (dist/ is owned by the deploying user, not the
callback-box/bin/cb:47:    --require "$tsx_dir/dist/preflight.cjs" \
callback-box/bin/cb:48:    --import "file://$tsx_dir/dist/loader.mjs" \
callback-box/deploy/deploy.sh:50:# Build the CLI bundle locally before syncing. dist/ is rsynced (not excluded),
callback-box/deploy/deploy.sh:52:# dist/cards/index.js on disk: box-local schema files import `callback-box/cards`,
callback-box/deploy/deploy.sh:53:# which package.json `exports` maps to ./dist/cards/index.js (a plain-JS build of
callback-box/deploy/deploy.sh:54:# the card-primitive layer, emitted by build-cli.mjs alongside dist/cli.mjs). If
callback-box/deploy/deploy.sh:56:# load. Building here keeps dist/ in lockstep with the source we rsync.
callback-box/deploy/deploy.sh:57:echo "Building CLI bundle (dist/cli.mjs + dist/cards)..."
callback-box/scripts/build-cli.mjs:1:// Bundles the CLI (src/cli/index.ts) into a single dist/cli.mjs for fast
callback-box/scripts/build-cli.mjs:26:  // the relative "cli.mjs.map", which stays correct after we move both into dist/.
callback-box/scripts/build-cli.mjs:44:// to a single bundled dist/cards/index.js. Box-local schema files import this
callback-box/scripts/build-cli.mjs:47:// dist/cli.mjs bundle) which does NOT remap `./schema.js` → `schema.ts`.
callback-box/scripts/build-cli.mjs:64:process.stderr.write(`built dist/cli.mjs in ${ms | 0}ms\n`);

exec
/opt/homebrew/bin/bash -lc "git show main:callback-box/package.json | nl -ba | sed -n '1,30p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Nt3Uy6Jq' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-nB4bs3Bk' (errno=Operation not permitted)
     1	{
     2	  "name": "callback-box",
     3	  "version": "0.1.0",
     4	  "description": "A Claude Code wrapper system for file-based processing",
     5	  "type": "module",
     6	  "main": "dist/cli/index.js",
     7	  "exports": {
     8	    ".": "./dist/cli/index.js",
     9	    "./cards": "./src/cards/index.ts"
    10	  },
    11	  "bin": {
    12	    "cb": "./bin/cb"
    13	  },
    14	  "scripts": {
    15	    "build": "tsc",
    16	    "build:frontend": "cd src/frontend && pnpm build",
    17	    "build:all": "pnpm build && pnpm build:frontend",
    18	    "build:cli": "node scripts/build-cli.mjs",
    19	    "dev": "echo 'The dev server is the monorepo router. Run \\`pnpm dev\\` from the monorepo root.' && exit 1",
    20	    "cb": "./bin/cb",
    21	    "typecheck": "tsc --noEmit && cd src/frontend && pnpm exec tsc --noEmit",
    22	    "typecheck:frontend": "cd src/frontend && pnpm typecheck",
    23	    "typecheck:all": "pnpm typecheck && pnpm typecheck:frontend",
    24	    "lint": "eslint src/ && cd src/frontend && pnpm exec eslint src/",
    25	    "start": "node dist/webapp/server.js",
    26	    "cli": "node dist/cli/index.js",
    27	    "pretest": "node scripts/build-cli.mjs",
    28	    "test": "tap",
    29	    "test:manual": "tap 'test/manual/**/*.doctest.md' 'test/manual/**/*.test.ts'",
    30	    "knowledge-audit": "tsx src/dev/knowledge-audit.ts",

exec
/opt/homebrew/bin/bash -lc "git show main:callback-box/scripts/build-cli.mjs | nl -ba | sed -n '1,90p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-KHdzrsjl' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-W5lMyKH9' (errno=Operation not permitted)
     1	// Bundles the CLI (src/cli/index.ts) into a single dist/cli.mjs for fast
     2	// cold starts — collapsing our ~hundreds of source modules into one file
     3	// removes the per-module ESM loader-hook overhead that dominates tsx startup.
     4	//
     5	// node_modules are externalized (`packages: "external"`): native addons like
     6	// better-sqlite3 can't be bundled, and loading deps from disk keeps their own
     7	// __dirname / asset resolution intact. cardworks resolves to its built dist.
     8	//
     9	// An external sourcemap (cli.mjs.map) gives real stack traces under
    10	// `node --enable-source-maps` without slowing startup — node loads the map
    11	// lazily, only when formatting an error. We build into a temp dir and rename
    12	// both files in, so a concurrent `cb` invocation (bin/cb self-heals on
    13	// staleness) never sees a half-written bundle.
    14	import { build } from "esbuild";
    15	import { rename, rm } from "node:fs/promises";
    16	import { join } from "node:path";
    17	
    18	const root = join(import.meta.dirname, "..");
    19	const distDir = join(root, "dist");
    20	const tmpDir = join(distDir, `.build-${process.pid}`);
    21	
    22	const t = process.hrtime.bigint();
    23	await build({
    24	  entryPoints: [join(root, "src/cli/index.ts")],
    25	  // Build "cli.mjs" inside a temp dir so the emitted //# sourceMappingURL is
    26	  // the relative "cli.mjs.map", which stays correct after we move both into dist/.
    27	  outfile: join(tmpDir, "cli.mjs"),
    28	  bundle: true,
    29	  platform: "node",
    30	  format: "esm",
    31	  target: "node22",
    32	  packages: "external",
    33	  sourcemap: true,
    34	  logLevel: "warning",
    35	});
    36	
    37	// Move the map first, then the .mjs, so the bundle never references a
    38	// not-yet-present map. rename() is atomic within the same filesystem.
    39	await rename(join(tmpDir, "cli.mjs.map"), join(distDir, "cli.mjs.map"));
    40	await rename(join(tmpDir, "cli.mjs"), join(distDir, "cli.mjs"));
    41	await rm(tmpDir, { recursive: true, force: true });
    42	
    43	const ms = Number(process.hrtime.bigint() - t) / 1e6;
    44	process.stderr.write(`built dist/cli.mjs in ${ms | 0}ms\n`);

exec
/opt/homebrew/bin/bash -lc 'rg -n "CB_CLI_PREBUILT|callback-box/cards|config/schemas|createCardSchemaMap|loadBoxSchemas" callback-box/src callback-box/bin callback-box/deploy callback-box/test' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/bin/cb:9:#   - Prod (CB_CLI_PREBUILT set): trust the bundle, no staleness check.
callback-box/bin/cb:54:if [ -n "$CB_CLI_PREBUILT" ] && [ -f "$BUNDLE" ]; then
callback-box/deploy/deploy.sh:52:# dist/cards/index.js on disk: box-local schema files import `callback-box/cards`,
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:260:**Watch for:** Navigates to config/schemas/ and finds CLAUDE.md
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:272:> ## 1. Create a schema file in `config/schemas/`
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:274:> The filename determines the card type. For example, `config/schemas/task.ts` creates the `task` type (files named `*.task.card`):
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:334:> You can see an existing box-local example at `config/schemas/bookmark.ts` for reference.
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:338:- ✗ Read config/schemas/CLAUDE.md
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:943:**Watch for:** Discovers config/schemas/CLAUDE.md to learn about custom card types
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:983:- ✗ Read config/schemas/CLAUDE.md
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:995:- Files read: /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/schemas/bookmark.ts, /Users/ianbicking/src/boxes/scenarios/knowledge/box/config/schemas/CLAUDE.md, /Users/ianbicking/src/boxes/scenarios/knowledge/box/docs/generated/card-memo.md
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:1014:- ✓ Read config/schemas/CLAUDE.md
callback-box/src/dev/reports/audit-report-2026-02-27T01-54-19.md:13:- Searches: Glob: config/schemas/*chat-thread*; Glob: **/chat-thread*.card; Glob: **/schemas/*chat*
callback-box/test/move-command.doctest.md:109:`config/schemas/`. Those types aren't in callback-box's built-in schema list,
callback-box/src/dev/reports/audit-report-2026-02-27T01-35-58.md:160:- Searches: Grep: telegram in .; Grep: chat.*message|send.*message in config; Grep: telegram in config; Grep: telegram in tricks; Grep: telegram in docs; Glob: config/schemas/*.ts; Glob: config/schemas/*; Grep: pushover|telegram|output in docs/generated
callback-box/src/dev/reports/audit-report-2026-02-27T01-35-58.md:191:- Searches: Grep: acknowledge|note|comment|annotation in /Users/ianbicking/src/boxes/test1/docs/generated; Grep: answer|acknowledge|note in /Users/ianbicking/src/boxes/test1/docs/generated/cb-commands.md; Grep: answer|chat|acknowledge in /Users/ianbicking/src/boxes/test1/config/schemas; Grep: question|answer|note|comment in /Users/ianbicking/src/boxes/test1/config/schemas; Glob: config/schemas/*question*; Glob: config/schemas/*.ts; Glob: box/questions/*.card
callback-box/test/box.doctest.md:60:config/schemas
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:9:**Watch for:** Navigates to config/schemas/ and finds CLAUDE.md
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:20:> ### 1. Create a schema file in `config/schemas/`
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:22:> For example, `config/schemas/task.ts`:
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:85:> You can look at the existing `config/schemas/bookmark.ts` for a real working example in this box.
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:88:- ✗ Read config/schemas/CLAUDE.md
callback-box/test/box-schemas.doctest.md:3:Boxes define their own card types under `config/schemas/*.ts`. Each file
callback-box/test/box-schemas.doctest.md:4:default-exports a frontmatter `cardSchema()`. `loadBoxSchemas` discovers them and
callback-box/test/box-schemas.doctest.md:12:import { loadBoxSchemas, createCardSchemaMap } from "../src/schemas/registry.js";
callback-box/test/box-schemas.doctest.md:34:// `callback-box/cards` specifier (resolved by the tsx hook in registry.ts).
callback-box/test/box-schemas.doctest.md:35:const WIDGET_SCHEMA = `import { body, cardSchema } from "callback-box/cards";
callback-box/test/box-schemas.doctest.md:59:await fs.writeFile(path.join(box, "config/schemas/widget.ts"), WIDGET_SCHEMA);
callback-box/test/box-schemas.doctest.md:61:const loaded = await loadBoxSchemas(box);
callback-box/test/box-schemas.doctest.md:88:`createCardSchemaMap(boxRoot)` includes box frontmatter types alongside the built-ins:
callback-box/test/box-schemas.doctest.md:91:const map = await createCardSchemaMap(box);
callback-box/test/contains-state.doctest.md:19:import { createCardSchemaMap } from "../src/schemas/registry.js";
callback-box/test/contains-state.doctest.md:24:  cardSchemas: await createCardSchemaMap(),
callback-box/test/card-io.doctest.md:20:import { createCardSchemaMap } from "../src/schemas/registry.js";
callback-box/test/card-io.doctest.md:165:  cardSchemas: await createCardSchemaMap(),
callback-box/test/search-extract.doctest.md:16:import { createCardSchemaMap } from "../src/schemas/registry.js";
callback-box/test/search-extract.doctest.md:19:  cardSchemas: await createCardSchemaMap(),
callback-box/test/capture-pipeline.test.ts:23:import { createCardSchemaMap } from "../src/schemas/registry.js";
callback-box/test/capture-pipeline.test.ts:84:      schemas: await createCardSchemaMap(),
callback-box/test/capture-pipeline.test.ts:145:      schemas: await createCardSchemaMap(),
callback-box/src/dev/knowledge-audits.yaml:133:    watch_for: "Navigates to config/schemas/ and finds CLAUDE.md"
callback-box/src/dev/knowledge-audits.yaml:134:    should_read: ["config/schemas/CLAUDE.md"]
callback-box/src/dev/knowledge-audits.yaml:137:  # Status (2026-06-18): pass (verified). Agent discovered config/schemas/CLAUDE.md
callback-box/src/dev/knowledge-audits.yaml:151:    should_read: ["config/schemas/CLAUDE.md"]
callback-box/src/dev/knowledge-audits.yaml:418:    watch_for: "Discovers config/schemas/CLAUDE.md to create a custom card type rather than suggesting memos"
callback-box/src/dev/knowledge-audits.yaml:419:    should_read: ["config/schemas/CLAUDE.md"]
callback-box/src/dev/knowledge-audits.yaml:422:      Agent correctly creates config/schemas/book.ts but may skip reading
callback-box/src/dev/knowledge-audits.yaml:425:      the should_read check is too strict. Reading any file in config/schemas/
callback-box/src/dev/knowledge-audits.yaml:432:    should_read: ["config/schemas/CLAUDE.md"]
callback-box/src/dev/knowledge-audits.yaml:1919:      (or a box-local `config/schemas/bookmark.ts`) as where to look.
callback-box/src/dev/knowledge-audits.yaml:1924:    correct_contains_any: ["docs/generated/", "src/schemas/", "config/schemas/"]
callback-box/src/dev/knowledge-audits.yaml:2536:      config/schemas/) and built views/sandbox.tsx as its UI. But when the
callback-box/src/core/maps/precheck-ignore.ts:46: * (`config/connectors/`, `config/schemas/`). Per-box MAPs add nothing
callback-box/src/core/maps/precheck-ignore.ts:71:  "config/schemas/**",
callback-box/src/core/load-context.ts:8:import { createCardSchemaMap } from "../schemas/registry.js";
callback-box/src/core/load-context.ts:11:  return { cardSchemas: await createCardSchemaMap(boxRoot) };
callback-box/src/connectors/telegram-output-cards.ts:13:import { createCardSchemaMap } from "../schemas/registry.js";
callback-box/src/connectors/telegram-output-cards.ts:52:      const card = parseCardText(content, { source: relPath, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/core/box-templates.ts:20:in \`config/schemas/\` that uses the same tools as built-in schemas.
callback-box/src/core/box-templates.ts:28:Create a \`.ts\` file in \`config/schemas/\` that default-exports a \`cardSchema()\`:
callback-box/src/core/box-templates.ts:31:import { body, cardSchema } from "callback-box/cards";
callback-box/src/core/box-templates.ts:48:The filename becomes the card type: \`config/schemas/task.ts\` → \`*.task.card\` files.
callback-box/src/core/box-templates.ts:77:import { cardSchema, type LintIssue } from "callback-box/cards";
callback-box/src/core/box-templates.ts:101:From \`callback-box/cards\`:
callback-box/src/core/box-templates.ts:115:import { cardSchema } from "callback-box/cards";
callback-box/src/core/box-templates.ts:318:    relPath: "config/schemas/CLAUDE.md",
callback-box/src/schemas/registry.ts:5: * by the CardLoader factory. Box-local schemas from config/schemas/
callback-box/src/schemas/registry.ts:52: * createCardSchemaMap below.
callback-box/src/schemas/registry.ts:92: * - `callback-box/cards` — the public card-primitive surface (cardSchema,
callback-box/src/schemas/registry.ts:104: * AND self-references (`callback-box/cards`) via callback-box's own
callback-box/src/schemas/registry.ts:114: * (under config/schemas/) can import `callback-box/cards`, `zod`, and
callback-box/src/schemas/registry.ts:133:        context.parentURL?.includes("/config/schemas/")
callback-box/src/schemas/registry.ts:147: * Ensure config/schemas/ has a package.json with "type": "module"
callback-box/src/schemas/registry.ts:164: * Box-local schemas, segregated by format. A box's `config/schemas/*.ts`
callback-box/src/schemas/registry.ts:173: * Per-boxRoot cache. loadBoxSchemas is called from ~24 sites (every place
callback-box/src/schemas/registry.ts:185: * Load box-local schemas from config/schemas/*.ts.
callback-box/src/schemas/registry.ts:192:export async function loadBoxSchemas(boxRoot: string): Promise<BoxSchemas> {
callback-box/src/schemas/registry.ts:196:  const result = await loadBoxSchemasUncached(boxRoot);
callback-box/src/schemas/registry.ts:201:async function loadBoxSchemasUncached(boxRoot: string): Promise<BoxSchemas> {
callback-box/src/schemas/registry.ts:203:  const schemasDir = join(boxRoot, "config/schemas");
callback-box/src/schemas/registry.ts:220:  // and register resolve hooks so bare specifiers (callback-box/cards, zod,
callback-box/src/schemas/registry.ts:271:  const boxCardSchemas = boxRoot ? (await loadBoxSchemas(boxRoot)).cardSchemas : [];
callback-box/src/schemas/registry.ts:287: * config/schemas/*.ts) are merged in on top of the built-in ones, so box
callback-box/src/schemas/registry.ts:291:export async function createCardSchemaMap(boxRoot?: string): Promise<Map<string, CardSchema>> {
callback-box/src/schemas/registry.ts:297:    const { cardSchemas: boxCardSchemas } = await loadBoxSchemas(boxRoot);
callback-box/src/connectors/gmail-drafts.ts:21:import { createCardSchemaMap } from "../schemas/registry.js";
callback-box/src/connectors/gmail-drafts.ts:135:    schemas: await createCardSchemaMap(opts.boxRoot),
callback-box/src/connectors/gmail-drafts.ts:234:      schemas: await createCardSchemaMap(),
callback-box/src/core/init-rules.ts:13:import { cardSchemas, loadBoxSchemas } from "../schemas/registry.js";
callback-box/src/core/init-rules.ts:93:  const boxSchemas = await loadBoxSchemas(boxRoot);
callback-box/src/core/agent-guide/cards.ts:19:  lines.push("New card types can be defined in `config/schemas/` using `cardSchema()` (YAML frontmatter + markdown body) + Zod — see `config/schemas/CLAUDE.md` for how. Run `cb init` after adding a schema to generate rules and docs.");
callback-box/src/core/generate-docs-compile.ts:17:import { createCardSchemaMap } from "../schemas/registry.js";
callback-box/src/core/generate-docs-compile.ts:81:      schemas: await createCardSchemaMap(boxRoot),
callback-box/src/core/generate-docs-compile.ts:355:      schemas: await createCardSchemaMap(boxRoot),
callback-box/src/core/schedule-health-box.ts:23:import { createCardSchemaMap } from "../schemas/registry.js";
callback-box/src/core/schedule-health-box.ts:102:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/core/generate-docs.ts:16:import { cardSchemas, loadBoxSchemas } from "../schemas/registry.js";
callback-box/src/core/generate-docs.ts:162:  await checkDir(join(boxRoot, "config/schemas"), /\.ts$/);
callback-box/src/core/generate-docs.ts:412:  const boxSchemas = await loadBoxSchemas(boxRoot);
callback-box/src/webapp/routes/scheduler.ts:17:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/webapp/routes/scheduler.ts:116:        const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/webapp/context.ts:14:import { createCardSchemaMap } from "../schemas/registry.js";
callback-box/src/webapp/context.ts:32:  const schemas = await createCardSchemaMap(root);
callback-box/src/cards/index.ts:6: * Box-local schemas (`config/schemas/*.ts`) import these via the public
callback-box/src/cards/index.ts:7: * `callback-box/cards` specifier; internal code imports from `../cards/`.
callback-box/src/core/commands/describe-images-card.ts:15:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/core/commands/describe-images-card.ts:23:    schemas: await createCardSchemaMap(),
callback-box/src/core/commands/describe-images-card.ts:31:    schemas: await createCardSchemaMap(),
callback-box/src/core/commands/scan-import.ts:40:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/core/commands/scan-import.ts:206:  const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:9:import { createCardSchemaMap } from "../../../schemas/registry.js";
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:144:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/core/commands/transcribe-captures.ts:20:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/core/commands/transcribe-captures.ts:36:    schemas: await createCardSchemaMap(),
callback-box/src/core/commands/transcribe-captures.ts:44:    schemas: await createCardSchemaMap(),
callback-box/src/core/commands/assemble-timeline-helpers.ts:7:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/core/commands/assemble-timeline-helpers.ts:17:      schemas: await createCardSchemaMap(),
callback-box/src/core/commands/assemble-timeline-helpers.ts:33:      schemas: await createCardSchemaMap(),
callback-box/src/webapp/trpc/routers/todos.ts:13:import { createCardSchemaMap } from "../../../schemas/registry.js";
callback-box/src/webapp/trpc/routers/todos.ts:65:      const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
callback-box/src/cli/commands/tick.ts:15:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/cli/commands/tick.ts:104:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/core/commands/answer.ts:19:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/core/commands/answer.ts:55:      schemas: await createCardSchemaMap(),
callback-box/src/cli/commands/scheduled.ts:15:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/cli/commands/scheduled.ts:53:        const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/cli/commands/tick-utils.ts:16:import { createCardSchemaMap } from "../../schemas/registry.js";
callback-box/src/cli/commands/tick-utils.ts:71:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/cli/lib/paths.ts:59:  schemas: "config/schemas",
callback-box/src/webapp/trpc/routers/card.ts:8:import { createCardSchemaMap } from "../../../schemas/registry.js";
callback-box/src/webapp/trpc/routers/card.ts:134:        const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
callback-box/src/webapp/trpc/routers/scheduler.ts:16:import { createCardSchemaMap } from "../../../schemas/registry.js";
callback-box/src/webapp/trpc/routers/scheduler.ts:152:      const card = parseCardText(content, { source: fileName, schemas: await createCardSchemaMap(ctx.boxRoot) });

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/deploy/setup-server.sh | sed -n '1,190p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	#!/usr/bin/env bash
     2	set -euo pipefail
     3	
     4	# ── Config ──────────────────────────────────────────────────────────
     5	REPO_BASE="git@github.com:ianb"
     6	REPOS=(callback-box)
     7	INSTALL_DIR="/opt/callback"
     8	CB_USER="callback"
     9	CB_HOME="/home/$CB_USER"
    10	BOX_DIR="$CB_HOME/boxes/test1"
    11	NODE_MAJOR=22
    12	
    13	echo "=== Callback Box Server Setup ==="
    14	
    15	# ── System packages ─────────────────────────────────────────────────
    16	echo "Installing system packages..."
    17	export DEBIAN_FRONTEND=noninteractive
    18	apt-get update -qq
    19	apt-get install -y -qq git git-lfs curl nginx build-essential ca-certificates gnupg poppler-utils pandoc imagemagick
    20	
    21	# Ubuntu 24.04 ships ImageMagick 6 (`convert`); homebrew + IM7 use `magick`.
    22	# Symlink so scripts written for `magick` work on prod without branching.
    23	if ! command -v magick >/dev/null 2>&1 && command -v convert >/dev/null 2>&1; then
    24	  ln -sf "$(command -v convert)" /usr/local/bin/magick
    25	fi
    26	
    27	# ── Node.js via NodeSource ──────────────────────────────────────────
    28	echo "Installing Node.js $NODE_MAJOR..."
    29	if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]]; then
    30	  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    31	  apt-get install -y -qq nodejs
    32	fi
    33	echo "Node.js $(node -v)"
    34	
    35	# Enable corepack so pnpm is available (ships with Node 22, no install needed).
    36	corepack enable pnpm
    37	echo "pnpm $(pnpm -v)"
    38	
    39	# ── Git config (root, for cloning repos) ─────────────────────────────
    40	git config --global user.email "callback-box@box.example.com"
    41	git config --global user.name "Callback Box"
    42	
    43	# ── GitHub SSH setup ─────────────────────────────────────────────────
    44	echo "Adding GitHub to known hosts..."
    45	mkdir -p ~/.ssh
    46	ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null
    47	
    48	# ── Create callback user ─────────────────────────────────────────────
    49	echo "Creating $CB_USER user..."
    50	if ! id -u "$CB_USER" &>/dev/null; then
    51	  useradd -m -s /bin/bash "$CB_USER"
    52	fi
    53	su - "$CB_USER" -c 'mkdir -p ~/.ssh && chmod 700 ~/.ssh'
    54	grep github.com ~/.ssh/known_hosts >> "$CB_HOME/.ssh/known_hosts" 2>/dev/null || true
    55	chown "$CB_USER:$CB_USER" "$CB_HOME/.ssh/known_hosts"
    56	su - "$CB_USER" -c 'git config --global user.email "callback-box@box.example.com"'
    57	su - "$CB_USER" -c 'git config --global user.name "Callback Box"'
    58	
    59	# ── Clone repos ─────────────────────────────────────────────────────
    60	echo "Cloning repositories..."
    61	mkdir -p "$INSTALL_DIR"
    62	for repo in "${REPOS[@]}"; do
    63	  if [[ -d "$INSTALL_DIR/$repo" ]]; then
    64	    echo "  $repo: already exists, pulling..."
    65	    cd "$INSTALL_DIR/$repo" && git pull --ff-only
    66	  else
    67	    echo "  $repo: cloning..."
    68	    git clone "$REPO_BASE/$repo.git" "$INSTALL_DIR/$repo"
    69	  fi
    70	done
    71	
    72	# ── Install and build ───────────────────────────────────────────────
    73	echo "Installing callback-box..."
    74	cd "$INSTALL_DIR/callback-box"
    75	pnpm install
    76	
    77	echo "Building frontend..."
    78	cd "$INSTALL_DIR/callback-box/src/frontend"
    79	pnpm install
    80	pnpm build
    81	
    82	# ── Symlink cb CLI ──────────────────────────────────────────────────
    83	echo "Symlinking cb CLI..."
    84	ln -sf "$INSTALL_DIR/callback-box/bin/cb" /usr/local/bin/cb
    85	cb --help >/dev/null 2>&1 && echo "cb CLI is working" || echo "WARNING: cb CLI test failed"
    86	
    87	# ── Install Claude Code CLI ─────────────────────────────────────────
    88	# Native installer auto-updates in the background, unlike npm global
    89	# install. Install for BOTH root (manual admin use) and the callback
    90	# user (service use). Each user manages its own version.
    91	echo "Installing Claude Code CLI (native installer)..."
    92	curl -fsSL https://claude.ai/install.sh | bash
    93	su - "$CB_USER" -c 'curl -fsSL https://claude.ai/install.sh | bash'
    94	# Add native install location to callback user's PATH
    95	su - "$CB_USER" -c 'grep -q "/.local/bin" ~/.bashrc || echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> ~/.bashrc'
    96	
    97	# ── Code directory permissions ───────────────────────────────────────
    98	echo "Setting read permissions on $INSTALL_DIR for $CB_USER..."
    99	chmod -R o+rX "$INSTALL_DIR"
   100	
   101	# ── Create test box ─────────────────────────────────────────────────
   102	echo "Creating test box at $BOX_DIR..."
   103	su - "$CB_USER" -c "mkdir -p '$BOX_DIR'"
   104	cd "$BOX_DIR"
   105	if [[ ! -f .cb-box ]]; then
   106	  su - "$CB_USER" -c "cd '$BOX_DIR' && git init && cb init . && git add -A && git commit -m 'Initial box setup'"
   107	fi
   108	
   109	# ── Environment file ────────────────────────────────────────────────
   110	ENV_FILE="$CB_HOME/.env"
   111	if [[ ! -f "$ENV_FILE" ]]; then
   112	  echo "Creating $ENV_FILE with placeholders..."
   113	  cat > "$ENV_FILE" <<'ENVEOF'
   114	# Required
   115	PUBLIC_URL=https://box.example.com
   116	
   117	# PATH must include the native Claude Code install location so systemd
   118	# services (which don't source .bashrc) can find the `claude` binary.
   119	PATH=/home/callback/.local/bin:/usr/local/bin:/usr/bin:/bin
   120	
   121	# Optional
   122	# THINKING_OPENAI_API_KEY=sk-REPLACE_ME
   123	# CALLBACK_MISTRAL_API_KEY=REPLACE_ME
   124	# CALLBACK_DEEPGRAM_API_KEY=REPLACE_ME
   125	# CALLBACK_DEEPGRAM_PROJECT=REPLACE_ME
   126	ENVEOF
   127	  chown "$CB_USER:$CB_USER" "$ENV_FILE"
   128	  chmod 600 "$ENV_FILE"
   129	else
   130	  echo "$ENV_FILE already exists, not overwriting"
   131	fi
   132	
   133	# ── Systemd: callback-serve ─────────────────────────────────────────
   134	echo "Creating systemd services..."
   135	BOXES_DIR="$CB_HOME/boxes"
   136	BOX_DIRS=$(find "$BOXES_DIR" -maxdepth 1 -mindepth 1 -type d | sort | tr '\n' ' ')
   137	
   138	# Both serve and scheduler consult the same manifest at
   139	# ~/.config/cb/boxes.json. The systemd unit no longer hard-codes box
   140	# paths; `cb serve` reads the manifest at startup, and a future
   141	# `cb boxes add <path>` just requires `systemctl restart callback-serve`
   142	# (no unit rewrite needed).
   143	cat > /etc/systemd/system/callback-serve.service <<EOF
   144	[Unit]
   145	Description=Callback Box Web Server
   146	After=network.target
   147	
   148	[Service]
   149	Type=simple
   150	User=$CB_USER
   151	Group=$CB_USER
   152	ExecStart=/usr/local/bin/cb serve --host 0.0.0.0 --port 3210
   153	WorkingDirectory=$BOXES_DIR
   154	EnvironmentFile=$CB_HOME/.env
   155	Restart=on-failure
   156	RestartSec=5
   157	
   158	[Install]
   159	WantedBy=multi-user.target
   160	EOF
   161	
   162	# ── Systemd: callback-scheduler ────────────────────────────────────
   163	# Register all existing boxes in the manifest used by both serve and
   164	# scheduler. Idempotent — re-runs are safe.
   165	for box in $BOX_DIRS; do
   166	  su - "$CB_USER" -c "cb boxes add '$box'" 2>/dev/null || true
   167	done
   168	
   169	cat > /etc/systemd/system/callback-scheduler.service <<EOF
   170	[Unit]
   171	Description=Callback Box Scheduler
   172	After=network.target
   173	
   174	[Service]
   175	Type=simple
   176	User=$CB_USER
   177	Group=$CB_USER
   178	ExecStart=/usr/local/bin/cb scheduler start
   179	WorkingDirectory=$BOXES_DIR
   180	EnvironmentFile=$CB_HOME/.env
   181	Restart=on-failure
   182	RestartSec=10
   183	
   184	[Install]
   185	WantedBy=multi-user.target
   186	EOF
   187	
   188	# ── Systemd: nightly Claude Code self-update ───────────────────────
   189	# Claude Code's built-in auto-updater only fires during interactive-ish
   190	# sessions, so server-side short-lived invocations drift behind.

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/deploy/rebuild-server.sh | sed -n '1,120p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	#!/usr/bin/env bash
     2	set -euo pipefail
     3	
     4	# Pull latest code and rebuild on the server.
     5	# Run locally: ./deploy/rebuild-server.sh
     6	# Or on server directly: /root/rebuild.sh
     7	
     8	INSTALL_DIR="/opt/callback"
     9	
    10	echo "=== Pulling latest code ==="
    11	for repo in callback-box; do
    12	  echo "  $repo..."
    13	  cd "$INSTALL_DIR/$repo" && git pull --ff-only
    14	done
    15	
    16	echo "=== Rebuilding callback-box ==="
    17	cd "$INSTALL_DIR/callback-box"
    18	pnpm install
    19	
    20	echo "=== Rebuilding frontend ==="
    21	cd "$INSTALL_DIR/callback-box/src/frontend"
    22	pnpm install
    23	pnpm build
    24	
    25	echo "=== Restarting services ==="
    26	systemctl restart callback-serve callback-scheduler
    27	
    28	echo "=== Done ==="
    29	systemctl is-active callback-serve || true
    30	systemctl is-active callback-scheduler || true

exec
/opt/homebrew/bin/bash -lc 'rg -n "serve|server|callback-serve|tsx|CB_CLI_PREBUILT|bin/cb|pnpm" callback-box/deploy callback-box/src/cli callback-box/src/webapp callback-box/package.json' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/package.json:12:    "cb": "./bin/cb"
callback-box/package.json:16:    "build:frontend": "cd src/frontend && pnpm build",
callback-box/package.json:17:    "build:all": "pnpm build && pnpm build:frontend",
callback-box/package.json:19:    "dev": "echo 'The dev server is the monorepo router. Run \\`pnpm dev\\` from the monorepo root.' && exit 1",
callback-box/package.json:20:    "cb": "./bin/cb",
callback-box/package.json:21:    "typecheck": "tsc --noEmit && cd src/frontend && pnpm exec tsc --noEmit",
callback-box/package.json:22:    "typecheck:frontend": "cd src/frontend && pnpm typecheck",
callback-box/package.json:23:    "typecheck:all": "pnpm typecheck && pnpm typecheck:frontend",
callback-box/package.json:24:    "lint": "eslint src/ && cd src/frontend && pnpm exec eslint src/",
callback-box/package.json:25:    "start": "node dist/webapp/server.js",
callback-box/package.json:30:    "knowledge-audit": "tsx src/dev/knowledge-audit.ts",
callback-box/package.json:31:    "prompt-report": "tsx src/dev/prompt-report.ts",
callback-box/package.json:32:    "generate:doc-images": "tsx src/dev/generate-doc-images.ts",
callback-box/package.json:33:    "doc-graph": "tsx src/dev/doc-graph.ts > docs/doc-graph.md",
callback-box/package.json:34:    "doc-graph-html": "tsx src/dev/doc-graph-html.ts",
callback-box/package.json:38:    "lint:circular": "madge --circular --extensions ts,tsx src/"
callback-box/package.json:63:    "tsx": "^4.21.0",
callback-box/package.json:78:    "@trpc/server": "^11.11.0",
callback-box/package.json:114:    "src/frontend/src/**/*.{ts,tsx,js}": [
callback-box/src/cli/bootstrap.ts:5: * to ensure TSX_TSCONFIG_PATH is set before tsx compiles any JSX.
callback-box/src/cli/bootstrap.ts:10:// Set TSX_TSCONFIG_PATH so tsx finds the correct tsconfig.json
callback-box/src/cli/bootstrap.ts:11:// regardless of working directory. This is needed because tsx uses
callback-box/src/cli/bootstrap.ts:16:// Once tsx compiles a module, changing this env var won't help.
callback-box/src/webapp/server-root.ts:2: * Root-level (non-box-scoped) routes and handlers for the web app server:
callback-box/src/webapp/server-root.ts:4: * SPA fallback / not-found handler. Split out of server.ts to keep that
callback-box/src/webapp/server-root.ts:15:import type { BoxSpec } from "./server-types.js";
callback-box/src/webapp/server-root.ts:23:export function registerChromeExtensionCors(server: FastifyInstance): void {
callback-box/src/webapp/server-root.ts:25:  server.addHook("onSend", (request, reply, payload, done) => {
callback-box/src/webapp/server-root.ts:35:  server.options("/api/boxes", async (request, reply) => {
callback-box/src/webapp/server-root.ts:70:export function registerRootInfoRoutes(server: FastifyInstance, boxes: BoxSpec[]): void {
callback-box/src/webapp/server-root.ts:74:  // server-level state — boxes have their own richer health endpoint at
callback-box/src/webapp/server-root.ts:76:  server.get("/healthz", async (request, reply) => {
callback-box/src/webapp/server-root.ts:89:  server.get("/api/build-info", async () => {
callback-box/src/webapp/server-root.ts:104:  server.get("/api/boxes", async (request) => {
callback-box/src/webapp/server-root.ts:117: * Install the SPA fallback not-found handler: serves index.html for page
callback-box/src/webapp/server-root.ts:121:export function registerSpaFallback(server: FastifyInstance, frontendPath: string): void {
callback-box/src/webapp/server-root.ts:122:  server.setNotFoundHandler(async (request, reply) => {
callback-box/src/webapp/server-root.ts:125:    // Don't serve index.html for root-level API
callback-box/src/webapp/server-root.ts:149:    // SPA fallback: serve index.html
callback-box/src/webapp/server-root.ts:158: * a minimal HTML listing of the served boxes.
callback-box/src/webapp/server-root.ts:160:export function registerUnbuiltFrontendRoot(server: FastifyInstance, boxes: BoxSpec[]): void {
callback-box/src/webapp/server-root.ts:161:  server.get("/", async (_request, reply) => {
callback-box/src/webapp/server-root.ts:175:  <p>The frontend is not built yet. Run <code>pnpm build:frontend</code> to build it.</p>
callback-box/src/cli/index.ts:19:  serveCommand,
callback-box/src/cli/index.ts:77:program.addCommand(serveCommand);
callback-box/deploy/migrate-to-callback-user.sh:5:# Run on the server as root: bash /opt/callback/callback-box/deploy/migrate-to-callback-user.sh
callback-box/deploy/migrate-to-callback-user.sh:16:systemctl stop callback-serve callback-scheduler 2>/dev/null || true
callback-box/deploy/migrate-to-callback-user.sh:84:cat > /etc/systemd/system/callback-serve.service <<EOF
callback-box/deploy/migrate-to-callback-user.sh:93:ExecStart=/usr/local/bin/cb serve --host 0.0.0.0 --port 3210 $BOX_DIRS
callback-box/deploy/migrate-to-callback-user.sh:112:ExecStart=/usr/local/bin/cb scheduler start
callback-box/deploy/migrate-to-callback-user.sh:130:systemctl restart callback-serve callback-scheduler
callback-box/deploy/migrate-to-callback-user.sh:138:systemctl is-active callback-serve || true
callback-box/deploy/migrate-to-callback-user.sh:141:echo "Verify: systemctl show callback-serve --property=User"
callback-box/src/webapp/auth.ts:4: * Uses signed cookies (HMAC-SHA256) — no server-side session store.
callback-box/deploy/CLAUDE.md:7:- `create-server.sh` — provision a Hetzner box
callback-box/deploy/CLAUDE.md:8:- `setup-server.sh` — install software, create `callback` user, clone repos
callback-box/deploy/CLAUDE.md:9:- `server-ip` — target server IP (not committed)
callback-box/deploy/CLAUDE.md:20:Then confirm the server picked up the new commit:
callback-box/deploy/CLAUDE.md:23:ssh root@$(cat deploy/server-ip) 'cat /opt/callback/callback-box/deploy-info.json'
callback-box/src/webapp/server-main.ts:2: * Server entry point. Run directly to start the Fastify server:
callback-box/src/webapp/server-main.ts:3: *   node --import tsx ./src/webapp/server-main.ts [boxDirs...]
callback-box/src/webapp/server-main.ts:6: * This is kept separate from `server.ts` so that importing the server
callback-box/src/webapp/server-main.ts:7: * library (e.g. from the `cb serve` command, or when the CLI is bundled)
callback-box/src/webapp/server-main.ts:8: * has no side effects — only running THIS file starts a server.
callback-box/src/webapp/server-main.ts:11:import { startServer, type BoxSpec } from "./server.js";
callback-box/src/cli/lib/session-content.ts:80:  // Preserve image blocks so user-pasted images render in history.
callback-box/deploy/deploy.sh:4:# Deploy from local working tree to server via rsync.
callback-box/deploy/deploy.sh:11:SERVER_IP=$(cat "$SCRIPT_DIR/server-ip")
callback-box/deploy/deploy.sh:42:(cd "$MONO_DIR" && HUSKY=0 pnpm install --frozen-lockfile --silent)
callback-box/deploy/deploy.sh:47:  cd "$REPO_DIR/src/frontend" && pnpm --silent build
callback-box/deploy/deploy.sh:51:# and while the server runs cb via tsx (not the bundle), it DOES need
callback-box/deploy/deploy.sh:55:# that file is missing or stale on the server, every box-local schema fails to
callback-box/deploy/deploy.sh:60:# Sync monorepo packages. These are pnpm workspace members linked via
callback-box/deploy/deploy.sh:62:# server for the root `pnpm install` to resolve. personal-vibe-check and
callback-box/deploy/deploy.sh:63:# agent-doctest are devDeps of callback-box (the server install is non-prod
callback-box/deploy/deploy.sh:64:# because the runtime uses tsx, itself a devDep).
callback-box/deploy/deploy.sh:66:# tooling and a partial workspace installs fine (pnpm ignores absent members).
callback-box/deploy/deploy.sh:78:# pnpm workspace root: the single root lockfile + manifest + .npmrc + patches
callback-box/deploy/deploy.sh:79:# drive one reproducible `pnpm install --frozen-lockfile` from there (below).
callback-box/deploy/deploy.sh:84:  "$MONO_DIR/pnpm-workspace.yaml" \
callback-box/deploy/deploy.sh:86:  "$MONO_DIR/pnpm-lock.yaml" \
callback-box/deploy/deploy.sh:94:  # Bootstrap pnpm on demand. corepack ships with Node 22; this is idempotent
callback-box/deploy/deploy.sh:95:  # and a no-op if pnpm is already on PATH.
callback-box/deploy/deploy.sh:96:  if ! command -v pnpm >/dev/null 2>&1; then
callback-box/deploy/deploy.sh:97:    echo "  Bootstrapping pnpm via corepack..."
callback-box/deploy/deploy.sh:98:    corepack enable pnpm
callback-box/deploy/deploy.sh:130:  # from the workspace root. --frozen-lockfile makes the server resolution match
callback-box/deploy/deploy.sh:133:  # .git on the server) so it doesn't print a spurious ".git can't be found".
callback-box/deploy/deploy.sh:137:  HUSKY=0 pnpm install --frozen-lockfile
callback-box/deploy/deploy.sh:188:  ssh "root@$SERVER_IP" 'systemctl restart callback-serve callback-scheduler && echo "Services restarted"'
callback-box/deploy/deploy.sh:192:  # Runs on the server so it uses localhost + the local CB_DIAG_API_KEY.
callback-box/src/webapp/routes/api-image.ts:4: *   GET /api/image/* — resolve and serve an image by box-relative path
callback-box/src/webapp/routes/api-image.ts:7: *  - Plain image file (`.jpg`, `.png`, etc.) — served directly.
callback-box/src/webapp/routes/api-image.ts:10: *    and serves the attached image.
callback-box/src/webapp/routes/api-image.ts:88:  server,
callback-box/src/webapp/routes/api-image.ts:91:  server: FastifyInstance;
callback-box/src/webapp/routes/api-image.ts:94:  server.get<{ Params: { "*": string } }>(
callback-box/src/webapp/routes/api-image.ts:162:          console.warn(`[api-image] could not serve ${imageAbs}:`, e);
callback-box/deploy/README.md:3:Scripts for provisioning and managing a Hetzner cloud server running callback-box.
callback-box/deploy/README.md:10:- **SSH agent**: `ssh-add` (needed for GitHub access on the server via agent forwarding)
callback-box/deploy/README.md:23:### `create-server.sh` — Create a new server from scratch
callback-box/deploy/README.md:25:Destroys any existing server, creates a fresh Hetzner VPS, provisions it, and sets up DNS.
callback-box/deploy/README.md:28:./deploy/create-server.sh
callback-box/deploy/README.md:32:1. Deletes existing `callback-box` server if present (cleans up stale SSH keys)
callback-box/deploy/README.md:37:6. Uploads and runs `setup-server.sh` on the server
callback-box/deploy/README.md:39:### `setup-server.sh` — Provision a bare server (runs remotely)
callback-box/deploy/README.md:46:- Creates systemd services for web server and scheduler
callback-box/deploy/README.md:49:### `add-box.sh` — Add a box to the server
callback-box/deploy/README.md:51:Clones a box repo, registers it with the scheduler, and updates the serve service.
callback-box/deploy/README.md:64:Each box is served at `https://box.example.com/<box-name>/`.
callback-box/deploy/README.md:74:### `ssh-server.sh` — SSH into the server
callback-box/deploy/README.md:78:./deploy/ssh-server.sh
callback-box/deploy/README.md:81:./deploy/ssh-server.sh systemctl status callback-serve
callback-box/deploy/README.md:84:Uses agent forwarding (`-A`) so your local SSH key works for GitHub operations on the server.
callback-box/deploy/README.md:96:/usr/local/bin/cb           # CLI symlink
callback-box/deploy/README.md:97:/usr/local/bin/cb-rebuild   # Rebuild shortcut
callback-box/deploy/README.md:102:- `callback-serve` — Web server serving all boxes in `/home/callback/boxes/`
callback-box/deploy/README.md:107:systemctl status callback-serve
callback-box/deploy/README.md:111:journalctl -u callback-serve -f
callback-box/deploy/README.md:115:systemctl restart callback-serve callback-scheduler
callback-box/deploy/README.md:142:After editing `.env`, restart services: `systemctl restart callback-serve callback-scheduler`
callback-box/deploy/README.md:159:5. Restart services: `systemctl restart callback-serve`
callback-box/deploy/README.md:181:./deploy/ssh-server.sh
callback-box/deploy/README.md:188:- DNS: `box.example.com` → server IP (Cloudflare proxied, auto-managed by `create-server.sh`)
callback-box/src/cli/commands/chat-audio.ts:6: *   to a temp file (the browser caches the last segment's WAV; the server
callback-box/src/cli/commands/chat-audio.ts:34: * Request headers for loopback calls to the live server: JSON content type
callback-box/src/cli/commands/chat-audio.ts:80: * Long-poll the server for the last voice message's recording. Prints a
callback-box/src/cli/commands/chat-audio.ts:89:  const serverUrl = process.env.CB_SERVER_URL;
callback-box/src/cli/commands/chat-audio.ts:91:  if (!serverUrl || !boxName) {
callback-box/src/cli/commands/chat-audio.ts:100:  const url = `${serverUrl.replace(/\/+$/, "")}/${boxName}/api/chat/last-audio/request`;
callback-box/deploy/rebuild.sh:2:# Pull latest and rebuild on the server (runs locally, executes remotely)
callback-box/deploy/rebuild.sh:4:exec "$SCRIPT_DIR/ssh-server.sh" /root/rebuild-server.sh
callback-box/src/webapp/routes/auth.ts:21:import type { BoxSpec } from "../server.js";
callback-box/src/webapp/routes/auth.ts:28:  server: FastifyInstance,
callback-box/src/webapp/routes/auth.ts:38:  server.get<{ Querystring: { returnTo?: string } }>(
callback-box/src/webapp/routes/auth.ts:51:  server.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
callback-box/src/webapp/routes/auth.ts:118:  server.get("/auth/logout", async (_request, reply) => {
callback-box/src/webapp/routes/auth.ts:124:  server.get("/auth/me", async (request, reply) => {
callback-box/src/cli/lib/git-log.ts:49: * Filter criteria applied server-side via `git log --grep --all-match`.
callback-box/deploy/create-server.sh:33:# ── Destroy existing server ─────────────────────────────────────────
callback-box/deploy/create-server.sh:34:if hcloud server describe "$SERVER_NAME" &>/dev/null; then
callback-box/deploy/create-server.sh:35:  OLD_IP=$(hcloud server ip "$SERVER_NAME" 2>/dev/null || true)
callback-box/deploy/create-server.sh:36:  echo "Destroying existing server '$SERVER_NAME'..."
callback-box/deploy/create-server.sh:37:  hcloud server delete "$SERVER_NAME"
callback-box/deploy/create-server.sh:56:# ── Create server ───────────────────────────────────────────────────
callback-box/deploy/create-server.sh:57:echo "Creating server '$SERVER_NAME' ($SERVER_TYPE in $LOCATION)..."
callback-box/deploy/create-server.sh:58:hcloud server create \
callback-box/deploy/create-server.sh:65:SERVER_IP=$(hcloud server ip "$SERVER_NAME")
callback-box/deploy/create-server.sh:66:echo "$SERVER_IP" > "$SCRIPT_DIR/server-ip"
callback-box/deploy/create-server.sh:127:scp -o StrictHostKeyChecking=no "$SCRIPT_DIR/setup-server.sh" "$SCRIPT_DIR/rebuild-server.sh" "root@$SERVER_IP:/root/"
callback-box/deploy/create-server.sh:128:ssh -o StrictHostKeyChecking=no "root@$SERVER_IP" "chmod +x /root/setup-server.sh /root/rebuild-server.sh && ln -sf /root/rebuild-server.sh /usr/local/bin/cb-rebuild"
callback-box/deploy/create-server.sh:130:echo "Running setup on server (this will take a few minutes)..."
callback-box/deploy/create-server.sh:131:ssh -A -o StrictHostKeyChecking=no "root@$SERVER_IP" "chmod +x /root/setup-server.sh && /root/setup-server.sh"
callback-box/deploy/create-server.sh:145:echo "    1. Edit /root/.env on the server with your API keys"
callback-box/deploy/create-server.sh:146:echo "    2. Restart services: systemctl restart callback-serve callback-scheduler"
callback-box/src/webapp/routes/chat-session-routes.ts:7: * POST /api/chat/restart          - Kill the subprocess (preserves session id)
callback-box/src/webapp/routes/chat-session-routes.ts:110:  const { server, boxRoot, registry, scheduleManager, wireSession } = ctx;
callback-box/src/webapp/routes/chat-session-routes.ts:114:  server.get<{ Querystring: HistoryQuery }>("/api/chat/history", async (request, reply) => {
callback-box/src/webapp/routes/chat-session-routes.ts:122:  server.get("/api/chat/sessions", async () => listWebChatSessions(boxRoot));
callback-box/src/webapp/routes/chat-session-routes.ts:125:  server.post<{ Body: { session?: string } }>("/api/chat/interrupt", async (request, reply) => {
callback-box/src/webapp/routes/chat-session-routes.ts:135:  server.post<{ Body: { session?: string } }>("/api/chat/restart", async (request, reply) => {
callback-box/src/webapp/routes/chat-session-routes.ts:146:  server.get<{ Querystring: { session?: string } }>("/api/chat/status", async (request) => {
callback-box/src/webapp/routes/chat-session-routes.ts:170:  server.get("/api/chat/default", async () => {
callback-box/src/webapp/routes/chat-session-routes.ts:182:  server.post<{ Body: { model: string | null; session?: string } }>(
callback-box/src/webapp/routes/chat-session-routes.ts:211:  server.get<{ Querystring: { session?: string } }>(
callback-box/src/webapp/routes/chat-session-routes.ts:226:  server.post<{ Body: { session?: string; feature?: string; value?: string } }>(
callback-box/src/webapp/routes/chat-session-routes.ts:252:  server.get("/api/chat/schedules", async () => {
callback-box/src/webapp/routes/chat-session-routes.ts:257:  server.post<{ Body: { label: string } }>(
callback-box/deploy/rebuild-server.sh:4:# Pull latest code and rebuild on the server.
callback-box/deploy/rebuild-server.sh:5:# Run locally: ./deploy/rebuild-server.sh
callback-box/deploy/rebuild-server.sh:6:# Or on server directly: /root/rebuild.sh
callback-box/deploy/rebuild-server.sh:18:pnpm install
callback-box/deploy/rebuild-server.sh:22:pnpm install
callback-box/deploy/rebuild-server.sh:23:pnpm build
callback-box/deploy/rebuild-server.sh:26:systemctl restart callback-serve callback-scheduler
callback-box/deploy/rebuild-server.sh:29:systemctl is-active callback-serve || true
callback-box/src/cli/lib/git-internal.ts:16: * preserved.
callback-box/src/cli/lib/session.ts:276: * by the <chat-app .../> snapshot tag the server prepends to every turn.
callback-box/deploy/setup-server.sh:35:# Enable corepack so pnpm is available (ships with Node 22, no install needed).
callback-box/deploy/setup-server.sh:36:corepack enable pnpm
callback-box/deploy/setup-server.sh:37:echo "pnpm $(pnpm -v)"
callback-box/deploy/setup-server.sh:75:pnpm install
callback-box/deploy/setup-server.sh:79:pnpm install
callback-box/deploy/setup-server.sh:80:pnpm build
callback-box/deploy/setup-server.sh:84:ln -sf "$INSTALL_DIR/callback-box/bin/cb" /usr/local/bin/cb
callback-box/deploy/setup-server.sh:133:# ── Systemd: callback-serve ─────────────────────────────────────────
callback-box/deploy/setup-server.sh:138:# Both serve and scheduler consult the same manifest at
callback-box/deploy/setup-server.sh:140:# paths; `cb serve` reads the manifest at startup, and a future
callback-box/deploy/setup-server.sh:141:# `cb boxes add <path>` just requires `systemctl restart callback-serve`
callback-box/deploy/setup-server.sh:143:cat > /etc/systemd/system/callback-serve.service <<EOF
callback-box/deploy/setup-server.sh:152:ExecStart=/usr/local/bin/cb serve --host 0.0.0.0 --port 3210
callback-box/deploy/setup-server.sh:163:# Register all existing boxes in the manifest used by both serve and
callback-box/deploy/setup-server.sh:178:ExecStart=/usr/local/bin/cb scheduler start
callback-box/deploy/setup-server.sh:190:# sessions, so server-side short-lived invocations drift behind.
callback-box/deploy/setup-server.sh:250:systemctl enable callback-serve callback-scheduler claude-update.timer
callback-box/deploy/setup-server.sh:251:systemctl start callback-serve callback-scheduler claude-update.timer
callback-box/deploy/setup-server.sh:256:server {
callback-box/deploy/setup-server.sh:257:    listen 80 default_server;
callback-box/deploy/setup-server.sh:258:    listen [::]:80 default_server;
callback-box/deploy/setup-server.sh:259:    server_name _;
callback-box/deploy/setup-server.sh:284:systemctl is-active callback-serve || true
callback-box/src/webapp/routes/clerk.ts:38:  server: FastifyInstance;
callback-box/src/webapp/routes/clerk.ts:45:  const { server, boxRoot } = options;
callback-box/src/webapp/routes/clerk.ts:47:  server.options("/api/clerk/*", async (request, reply) => {
callback-box/src/webapp/routes/clerk.ts:55:  server.get("/api/clerk/commentary-destinations", async (request, reply) => {
callback-box/src/webapp/routes/clerk.ts:61:  server.post("/api/clerk/commentary", async (request, reply) => {
callback-box/src/webapp/routes/clerk.ts:128:  server.get("/api/clerk/actions", async (request, reply) => {
callback-box/src/webapp/routes/clerk.ts:134:  server.post<{ Params: { id: string } }>("/api/clerk/actions/:id/dismiss", async (request, reply) => {
callback-box/deploy/ssh-server.sh:2:# SSH into the callback-box server (with agent forwarding)
callback-box/deploy/ssh-server.sh:5:if [[ -f "$SCRIPT_DIR/server-ip" ]]; then
callback-box/deploy/ssh-server.sh:6:  SERVER_IP=$(cat "$SCRIPT_DIR/server-ip")
callback-box/deploy/ssh-server.sh:8:  SERVER_IP=$(hcloud server ip callback-box 2>/dev/null)
callback-box/deploy/ssh-server.sh:10:    echo "Error: No server IP found. Run create-server.sh first."
callback-box/deploy/claude-update.sh:3:# Installed by setup-server.sh at /usr/local/sbin/claude-update.sh and
callback-box/deploy/add-box.sh:4:# Add a box to the server: clone its repo, register with scheduler,
callback-box/deploy/add-box.sh:5:# and update the serve service to include it.
callback-box/deploy/add-box.sh:40:# ── Get server IP ───────────────────────────────────────────────────
callback-box/deploy/add-box.sh:41:if [[ -f "$SCRIPT_DIR/server-ip" ]]; then
callback-box/deploy/add-box.sh:42:  SERVER_IP=$(cat "$SCRIPT_DIR/server-ip")
callback-box/deploy/add-box.sh:44:  SERVER_IP=$(hcloud server ip callback-box 2>/dev/null)
callback-box/deploy/add-box.sh:48:  echo "Error: No server IP found. Run create-server.sh first."
callback-box/deploy/add-box.sh:56:# ── Clone the box repo on the server ────────────────────────────────
callback-box/deploy/add-box.sh:84:# Register with the shared box manifest (used by both serve and scheduler).
callback-box/deploy/add-box.sh:88:# (No unit rewrite needed — `cb serve` reads ~/.config/cb/boxes.json
callback-box/deploy/add-box.sh:90:systemctl restart callback-serve callback-scheduler
callback-box/deploy/add-box.sh:98:# Wait for server to be ready, then run health check
callback-box/deploy/add-box.sh:102:  echo "  Health check: could not reach server (may still be starting)"
callback-box/src/cli/commands/scheduler.ts:49:// manifest is now shared with `cb serve`, so the canonical commands
callback-box/src/cli/commands/scheduler.ts:142:    // Find the cb binary — process.argv[1] may be a .ts file when run via tsx,
callback-box/src/webapp/routes/telegram.ts:26:  server: FastifyInstance;
callback-box/src/webapp/routes/telegram.ts:32:  const { server, boxRoot, eventBus } = opts;
callback-box/src/webapp/routes/telegram.ts:37:  server.post("/telegram", async (request: FastifyRequest, reply: FastifyReply) => {
callback-box/src/cli/commands/google-auth.ts:6: * 2. Start ephemeral local server on port 8976
callback-box/src/cli/commands/google-auth.ts:94:      // Start ephemeral server to receive the callback
callback-box/src/cli/commands/google-auth.ts:95:      const server = Fastify();
callback-box/src/cli/commands/google-auth.ts:99:          server.get(
callback-box/src/cli/commands/google-auth.ts:148:          server.listen({ port: 8976, host: "127.0.0.1" }).then(() => {
callback-box/src/cli/commands/google-auth.ts:156:      // Shut down the server
callback-box/src/cli/commands/google-auth.ts:157:      await server.close();
callback-box/src/cli/commands/render.ts:47:    const renderScript = path.join(projectDir, "src/frontend/src/ssr/render.tsx");
callback-box/src/cli/commands/render.ts:52:      "--import", "tsx",
callback-box/src/webapp/routes/capture-finalize.ts:249:  // not session creation time (server-provided) which may differ significantly
callback-box/src/cli/commands/chat.ts:25:  serverUrl: string;
callback-box/src/cli/commands/chat.ts:32:  const url = `${args.serverUrl.replace(/\/+$/, "")}/${args.boxName}/api/chat/self-note`;
callback-box/src/cli/commands/chat.ts:54:    const serverUrl = process.env.CB_SERVER_URL;
callback-box/src/cli/commands/chat.ts:57:    if (!serverUrl) {
callback-box/src/cli/commands/chat.ts:73:        serverUrl,
callback-box/src/cli/commands/chat.ts:86:        `cb chat self-note: server returned ${result.status}: ${result.body}`
callback-box/src/cli/commands/chat.ts:102:  serverUrl: string;
callback-box/src/cli/commands/chat.ts:107:  const url = `${args.serverUrl.replace(/\/+$/, "")}/${args.boxName}/api/chat/whats-changed`;
callback-box/src/cli/commands/chat.ts:126:    const serverUrl = process.env.CB_SERVER_URL;
callback-box/src/cli/commands/chat.ts:128:    if (!serverUrl) {
callback-box/src/cli/commands/chat.ts:138:      const result = await postWhatsChanged({ serverUrl, boxName, session: options.session, card: options.card });
callback-box/src/cli/commands/chat.ts:144:      console.error(`cb chat whats-changed: server returned ${result.status}: ${result.body}`);
callback-box/src/cli/commands/feedback.ts:118:      const serverUrl = process.env["CB_SERVER_URL"] ?? null;
callback-box/src/cli/commands/feedback.ts:127:        ...(serverUrl ? [`**Server:** ${serverUrl}`] : []),
callback-box/src/cli/commands/serve.ts:2: * cb serve - Start the webapp server
callback-box/src/cli/commands/serve.ts:5: * Usage: cb serve [dirs...]
callback-box/src/cli/commands/serve.ts:7: *   - No args, manifest populated: serves every box in ~/.config/cb/boxes.json.
callback-box/src/cli/commands/serve.ts:8: *   - No args, manifest empty: serves the current directory (legacy fallback,
callback-box/src/cli/commands/serve.ts:15:import { startServer, DEFAULT_PORT, type BoxSpec } from "../../webapp/server.js";
callback-box/src/cli/commands/serve.ts:44:export const serveCommand = new Command("serve")
callback-box/src/cli/commands/serve.ts:45:  .description("Start the webapp server")
callback-box/src/cli/commands/serve.ts:46:  .argument("[dirs...]", "Box directories to serve (default: current directory)")
callback-box/src/cli/commands/serve.ts:58:    // Resolve which box dirs to serve. Precedence:
callback-box/src/cli/commands/serve.ts:61:    //      servers — added/removed via `cb boxes add|remove`).
callback-box/src/cli/commands/serve.ts:79:      // exec into node --watch with tsx loader, bypassing the CLI wrapper.
callback-box/src/cli/commands/serve.ts:80:      // Uses node's native watcher (not tsx --watch) for proper signal handling.
callback-box/src/cli/commands/serve.ts:82:      const serverTs = path.join(projectDir, "src/webapp/server-main.ts");
callback-box/src/cli/commands/serve.ts:89:        "--import", "tsx",
callback-box/src/cli/commands/serve.ts:90:        serverTs,
callback-box/src/cli/commands/serve.ts:94:      // Set PORT/HOST as env vars for the server entry point
callback-box/src/cli/commands/index.ts:12:export { serveCommand } from "./serve.js";
callback-box/src/webapp/routes/actions.ts:36:  server: FastifyInstance;
callback-box/src/webapp/routes/actions.ts:339: * Register action routes on the Fastify server.
callback-box/src/webapp/routes/actions.ts:344:  const { server, boxRoot, eventBus } = options;
callback-box/src/webapp/routes/actions.ts:347:  server.post<{ Body: WakeupBody }>("/api/actions/wakeup", async (request, reply) =>
callback-box/src/webapp/routes/actions.ts:352:  server.post<{ Body: AnswerBody }>("/api/actions/answer", async (request, reply) =>
callback-box/src/webapp/routes/actions.ts:357:  server.post<{ Body: CreateBody }>("/api/actions/create", async (request, reply) =>
callback-box/src/webapp/routes/actions.ts:362:  server.post("/api/actions/create-voice-memo", async (request: FastifyRequest, reply) =>
callback-box/src/cli/commands/validate.ts:72:const SKIP_DIRS = new Set(["node_modules", ".git", ".pnpm", ".claude"]);
callback-box/src/cli/commands/trick.ts:7: * Scripts run as subprocesses via tsx with their own package context,
callback-box/src/cli/commands/trick.ts:22:/** Resolve the tsx CLI binary from cb's own dependencies. */
callback-box/src/cli/commands/trick.ts:24:  // tsx/cli is the entry point for the tsx binary
callback-box/src/cli/commands/trick.ts:25:  return require.resolve("tsx/cli");
callback-box/src/cli/commands/trick.ts:111: * Run a trick as a subprocess via tsx.
callback-box/src/cli/commands/boxes.ts:4: * Both `cb serve` (when invoked without explicit box arguments) and
callback-box/src/cli/commands/boxes.ts:20:  .description("Manage the box manifest used by serve and scheduler");
callback-box/src/cli/commands/migrate.ts:78:      ["tsx", scriptPath, args.boxRoot, "--apply"],
callback-box/src/webapp/routes/scheduler.ts:2: * Scheduler log routes — serves JSONL scheduler logs for the current box.
callback-box/src/webapp/routes/scheduler.ts:21:  server: FastifyInstance,
callback-box/src/webapp/routes/scheduler.ts:32:  server.get<{
callback-box/src/webapp/routes/scheduler.ts:92:  server.get("/api/schedules", async () => {
callback-box/src/webapp/routes/chat-last-audio-routes.ts:56:  const { server, eventBus } = ctx;
callback-box/src/webapp/routes/chat-last-audio-routes.ts:59:  server.post<{ Body: LastAudioRequestBody | null }>(
callback-box/src/webapp/routes/chat-last-audio-routes.ts:94:  server.post<{ Params: { requestId: string }; Body: LastAudioAnswerBody | null }>(
callback-box/src/webapp/file-etag.ts:6: * the server compares strings, never re-deriving floats.
callback-box/src/webapp/routes/calendar.ts:26:  server: FastifyInstance;
callback-box/src/webapp/routes/calendar.ts:34:  const { server, boxRoot, calendar } = options;
callback-box/src/webapp/routes/calendar.ts:37:  server.get("/api/calendar/available", async (_request, reply) => {
callback-box/src/webapp/routes/calendar.ts:77:  server.get("/api/calendar/config", async () => {
callback-box/src/webapp/routes/calendar.ts:82:  server.put<{ Body: CalendarConfig }>(
callback-box/src/webapp/server-lifecycle.ts:3: * cleanup. Split out of server.ts to keep that file under its line budget.
callback-box/src/webapp/server-lifecycle.ts:9:import type { BoxSpec, ServerOptions } from "./server-types.js";
callback-box/src/webapp/server-lifecycle.ts:24: * Kill any previous server process using the PID file.
callback-box/src/webapp/server-lifecycle.ts:35:      console.log(`Killing previous server (PID ${pid})...`);
callback-box/src/webapp/server-lifecycle.ts:42:        console.log(`Force killing previous server (PID ${pid})...`);
callback-box/src/webapp/server-lifecycle.ts:53:    // readFile threw — no PID file (or unreadable). No previous server to kill.
callback-box/src/webapp/routes/proxy-image.ts:7: * endpoint, which fetches the image server-side (no Referer restriction) and
callback-box/src/webapp/routes/proxy-image.ts:55:  return a >= 224; // multicast / reserved
callback-box/src/webapp/routes/proxy-image.ts:73: * True when `ip` (a numeric literal) is in a range we must not let the server
callback-box/src/webapp/routes/proxy-image.ts:75: * multicast/reserved. Pure — exported for tests.
callback-box/src/webapp/routes/proxy-image.ts:121:  server: FastifyInstance;
callback-box/src/webapp/routes/proxy-image.ts:125:  const { server } = options;
callback-box/src/webapp/routes/proxy-image.ts:127:  server.get<{ Querystring: { url?: string } }>("/api/proxy-image", async (request, reply) => {
callback-box/src/webapp/tts-mock.ts:7: * (dev-only /dev/speech route) observe playback timing deterministically:
callback-box/src/webapp/tts-mock.ts:53:export function serveMockTts(reply: FastifyReply, req: MockTtsRequest): FastifyReply {
callback-box/src/webapp/tts-mock.ts:58:      .send({ error: "mock TTS fixture missing — run: pnpm tsx scripts/gen-tts-fixtures.ts" });
callback-box/src/cli/commands/retro.ts:10: * (and, with the observer, records observations and the run report).
callback-box/src/cli/commands/retro.ts:21:import { createSdkRetroObserver } from "../../core/retro/observer.js";
callback-box/src/cli/commands/retro.ts:25:/** Default per-run cap on sessions observed; overflow waits for the next run. */
callback-box/src/cli/commands/retro.ts:69:  .description("Observe new chat sessions and record what the boxholder taught")
callback-box/src/cli/commands/retro.ts:70:  .option("--max-sessions <n>", "Per-run cap on sessions observed", String(DEFAULT_MAX_SESSIONS))
callback-box/src/cli/commands/retro.ts:71:  .option("--dry-run", "List the sessions that would be observed, without observing")
callback-box/src/cli/commands/retro.ts:86:        `would observe ${planned.length} of ${result.qualified.length} qualified session(s)`
callback-box/src/cli/commands/retro.ts:99:    const observer = createSdkRetroObserver({ boxRoot });
callback-box/src/cli/commands/retro.ts:101:      observer,
callback-box/src/cli/commands/retro.ts:107:      console.log(`run ${summary.runId}: no sessions ready to observe`);
callback-box/src/cli/commands/retro.ts:111:      `observed ${summary.observed} session(s)`,
callback-box/src/cli/commands/retro.ts:115:    if (summary.observerFailures > 0) parts.push(`${summary.observerFailures} failure(s)`);
callback-box/src/webapp/routes/views.ts:22:  server: FastifyInstance;
callback-box/src/webapp/routes/views.ts:27:  const { server, boxRoot } = options;
callback-box/src/webapp/routes/views.ts:30:  server.get("/api/views", async () => {
callback-box/src/webapp/routes/views.ts:35:  server.get<{ Params: { slug: string } }>(
callback-box/src/webapp/routes/views.ts:39:      const viewPath = path.join(boxRoot, "views", `${slug}.tsx`);
callback-box/src/webapp/routes/views.ts:58:  server.get<{ Params: { slug: string } }>(
callback-box/src/webapp/routes/views.ts:62:      const viewPath = path.join(boxRoot, "views", `${slug}.tsx`);
callback-box/src/webapp/routes/api-files.ts:8: *   GET (and HEAD) /api/files/* — serve images, audio, etc. with weak ETags
callback-box/src/webapp/routes/api-files.ts:20:// Injected into frozen pages at serve time so a hot-linked image that fails
callback-box/src/webapp/routes/api-files.ts:67:  // Frozen page captures (SingleFile output, scripts stripped) — serve as HTML
callback-box/src/webapp/routes/api-files.ts:80:  server: FastifyInstance;
callback-box/src/webapp/routes/api-files.ts:86: * Register the `/api/files/*` read + delete routes on the Fastify server.
callback-box/src/webapp/routes/api-files.ts:89:  const { server, boxRoot, eventBus } = options;
callback-box/src/webapp/routes/api-files.ts:92:  server.get<{ Params: { "*": string } }>(
callback-box/src/webapp/routes/api-files.ts:104:      // Don't serve .card files or dotfiles through this endpoint
callback-box/src/webapp/routes/api-files.ts:119:        // Frozen page captures are untrusted, user-saved HTML. We serve them as
callback-box/src/webapp/routes/api-files.ts:126:        // Conditional GET: build weak ETag from mtime + size, serve 304 when
callback-box/src/webapp/routes/api-files.ts:151:        // Frozen pages are never range-served: we inject a fallback script into
callback-box/src/webapp/routes/api-files.ts:208:  server.delete<{ Params: { "*": string } }>(
callback-box/src/webapp/routes/api-files.ts:271: * forms we don't serve (multi-range, malformed) — those get the full file.
callback-box/src/webapp/routes/capture-session-store.ts:5: * as session.json inside the temp dir so it survives server restarts.
callback-box/src/webapp/routes/history.ts:33:  server: FastifyInstance,
callback-box/src/webapp/routes/history.ts:39:  server.get<{
callback-box/src/webapp/routes/history.ts:53:  server.get<{
callback-box/src/webapp/routes/history.ts:70:  server.get<{
callback-box/src/webapp/routes/history.ts:102:  server.get<{
callback-box/src/webapp/trpc/routers/transcription.ts:4:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/views/compiler.ts:2: * Server-side compiler for agent-generated view .tsx files.
callback-box/src/webapp/views/compiler.ts:61:  return path.basename(filename, ".tsx");
callback-box/src/webapp/views/compiler.ts:118:      loader: "tsx",
callback-box/src/webapp/views/compiler.ts:171:  const files = await glob("*.tsx", { cwd: viewsDir });
callback-box/src/webapp/trpc/trpc.ts:1:import { initTRPC } from "@trpc/server";
callback-box/src/webapp/routes/chat-uploads.ts:18:  server: FastifyInstance;
callback-box/src/webapp/routes/chat-uploads.ts:47:  const { server, boxRoot } = options;
callback-box/src/webapp/routes/chat-uploads.ts:49:  server.post("/api/chat/upload-file", async (request, reply) => {
callback-box/src/webapp/server.ts:2: * Web app server - combined frontend + runner
callback-box/src/webapp/server.ts:19:import type { ServerOptions } from "./server-types.js";
callback-box/src/webapp/server.ts:20:import { resolveBoxes, killPreviousServer } from "./server-lifecycle.js";
callback-box/src/webapp/server.ts:21:import { registerBox } from "./server-box-scope.js";
callback-box/src/webapp/server.ts:27:} from "./server-root.js";
callback-box/src/webapp/server.ts:29:export type { BoxSpec, ServerOptions, ServerContext } from "./server-types.js";
callback-box/src/webapp/server.ts:34: * Create and configure the Fastify server.
callback-box/src/webapp/server.ts:40:  const server = Fastify({
callback-box/src/webapp/server.ts:55:  registerChromeExtensionCors(server);
callback-box/src/webapp/server.ts:58:  await server.register(fastifyCookie);
callback-box/src/webapp/server.ts:61:  await server.register(fastifyMultipart, {
callback-box/src/webapp/server.ts:68:  await server.register(fastifyWebsocket);
callback-box/src/webapp/server.ts:72:    await server.register(registerAuthRoutes, { boxes });
callback-box/src/webapp/server.ts:77:    server.get("/auth/me", async (_request, reply) => {
callback-box/src/webapp/server.ts:82:  await server.register(async (instance) => {
callback-box/src/webapp/server.ts:86:  await server.register(async (instance) => {
callback-box/src/webapp/server.ts:90:  registerRootInfoRoutes(server, boxes);
callback-box/src/webapp/server.ts:98:    await server.register(fastifyStatic, {
callback-box/src/webapp/server.ts:111:    await registerBox(server, { box, eventBus, options, frontendPath, frontendExists });
callback-box/src/webapp/server.ts:115:    // SPA fallback — serve index.html for non-API, non-asset routes
callback-box/src/webapp/server.ts:116:    registerSpaFallback(server, frontendPath);
callback-box/src/webapp/server.ts:119:    registerUnbuiltFrontendRoot(server, boxes);
callback-box/src/webapp/server.ts:122:  return server;
callback-box/src/webapp/server.ts:126: * Start the server.
callback-box/src/webapp/server.ts:135:  // Kill previous server for each box
callback-box/src/webapp/server.ts:137:    const pidFile = path.join(box.boxRoot, ".cb-serve.pid");
callback-box/src/webapp/server.ts:141:  const server = await createServer({ ...options, boxes });
callback-box/src/webapp/server.ts:146:    const pidFile = path.join(box.boxRoot, ".cb-serve.pid");
callback-box/src/webapp/server.ts:158:    server.server.closeAllConnections();
callback-box/src/webapp/server.ts:159:    await server.close();
callback-box/src/webapp/server.ts:170:    await server.listen({ port, host });
callback-box/src/webapp/server.ts:171:    // Register live public URLs for each served box so subprocess spawns
callback-box/src/webapp/server.ts:185:    server.log.error(err);
callback-box/src/webapp/routes/chat-send-routes.ts:147:  const { server, boxRoot, eventBus, registry, scheduleManager, processedMessageIds } = ctx;
callback-box/src/webapp/routes/chat-send-routes.ts:150:  server.post<{ Body: SendBody }>("/api/chat/send", async (request, reply) => {
callback-box/src/webapp/routes/chat-send-routes.ts:260:  server.post<{ Body: SelfNoteBody }>("/api/chat/self-note", async (request, reply) => {
callback-box/src/webapp/routes/chat-send-routes.ts:306:  server.post<{ Body: WhatsChangedBody }>("/api/chat/whats-changed", async (request, reply) => {
callback-box/src/webapp/server-box-scope.ts:2: * Per-box route registration for the web app server.
callback-box/src/webapp/server-box-scope.ts:6: * Split out of server.ts to keep that file under its line budget.
callback-box/src/webapp/server-box-scope.ts:11:import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
callback-box/src/webapp/server-box-scope.ts:31:import type { BoxSpec, ServerOptions } from "./server-types.js";
callback-box/src/webapp/server-box-scope.ts:46:    // Let static assets (served by fastify-static) through. Scope this
callback-box/src/webapp/server-box-scope.ts:110:  // @fastify/websocket is registered once at the root (server.ts); the box
callback-box/src/webapp/server-box-scope.ts:120:    // where there's no HTTP access log) leaves no server-side trace at all —
callback-box/src/webapp/server-box-scope.ts:148:  await registerActionRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
callback-box/src/webapp/server-box-scope.ts:149:  await registerCommandRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
callback-box/src/webapp/server-box-scope.ts:151:  await registerCalendarRoutes({ server: instance, boxRoot: box.boxRoot, calendar: options.services?.calendar });
callback-box/src/webapp/server-box-scope.ts:153:  await registerChatRoutes({ server: instance, boxRoot: box.boxRoot, eventBus, openaiAudio: options.services?.openaiAudio, prewarmChat: options.prewarmChat });
callback-box/src/webapp/server-box-scope.ts:164:  await registerCaptureRoutes({ server: instance, boxRoot: box.boxRoot, boxSlug: box.slug, eventBus });
callback-box/src/webapp/server-box-scope.ts:165:  await registerClerkRoutes({ server: instance, boxRoot: box.boxRoot });
callback-box/src/webapp/server-box-scope.ts:166:  await registerViewRoutes({ server: instance, boxRoot: box.boxRoot });
callback-box/src/webapp/server-box-scope.ts:180: * Register a box on the server: its main scope under `/<slug>` and its
callback-box/src/webapp/server-box-scope.ts:183:export async function registerBox(server: FastifyInstance, deps: BoxScopeDeps): Promise<void> {
callback-box/src/webapp/server-box-scope.ts:186:  await server.register(async (instance) => {
callback-box/src/webapp/server-box-scope.ts:193:  await server.register(async (instance) => {
callback-box/src/webapp/server-box-scope.ts:194:    await registerTelegramRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
callback-box/src/webapp/routes/api-adapters.ts:7: * The adapter injects the provider's auth header server-side, reading the
callback-box/src/webapp/routes/api-adapters.ts:14: * LLM calls normally happen server-side (agents, CLI); this is the bridge
callback-box/src/webapp/routes/api-adapters.ts:54:  server: FastifyInstance;
callback-box/src/webapp/routes/api-adapters.ts:59:  const { server, boxRoot } = options;
callback-box/src/webapp/routes/api-adapters.ts:61:  server.route<{ Params: { adapter: string; "*": string } }>({
callback-box/src/webapp/routes/chat-helpers.ts:6: * Fastify server, the session registry, or the event bus.
callback-box/src/webapp/routes/chat-helpers.ts:36:   * first turn. Unknown features / invalid values are dropped server-side.
callback-box/src/webapp/routes/chat-helpers.ts:68:  /** Target session id; defaults to the most-active session server-side. */
callback-box/src/webapp/routes/api.ts:31: * Register API routes on the Fastify server.
callback-box/src/webapp/routes/api.ts:39:  server: FastifyInstance,
callback-box/src/webapp/routes/api.ts:44:  server.get("/api/health", async () => {
callback-box/src/webapp/routes/api.ts:53:  server.get("/api/status", async () => {
callback-box/src/webapp/routes/api.ts:69:  server.get("/api/inbox", async () => {
callback-box/src/webapp/routes/api.ts:77:  server.get("/api/questions", async () => {
callback-box/src/webapp/routes/api.ts:97:  server.get<{ Querystring: { count?: string } }>("/api/activity", async (request) => {
callback-box/src/webapp/routes/api.ts:106:  server.get("/api/context", async () => {
callback-box/src/webapp/routes/api.ts:112:  registerApiBrowseRoutes({ server, boxRoot });
callback-box/src/webapp/routes/api.ts:114:  // /api/files/* — serve and delete raw box files (images, audio, etc.)
callback-box/src/webapp/routes/api.ts:115:  registerApiFilesRoutes({ server, boxRoot, eventBus });
callback-box/src/webapp/routes/api.ts:117:  registerProxyImageRoutes({ server });
callback-box/src/webapp/routes/api.ts:118:  registerApiFilesWriteRoutes({ server, boxRoot, eventBus });
callback-box/src/webapp/routes/api.ts:119:  registerApiAdapterRoutes({ server, boxRoot });
callback-box/src/webapp/routes/api.ts:122:  registerApiImageRoutes({ server, boxRoot });
callback-box/src/webapp/routes/api.ts:127:    registerApiExternalRoute({ server, boxRoot });
callback-box/src/webapp/routes/api.ts:131:  server.get<{ Querystring: { file?: string } }>(
callback-box/src/webapp/routes/api.ts:158:  registerApiDebugLogRoutes({ server, boxRoot });
callback-box/src/webapp/routes/api-external.ts:10: * server never mounts it.
callback-box/src/webapp/routes/api-external.ts:29:  ".tsx": "text/plain",
callback-box/src/webapp/routes/api-external.ts:44:export function registerApiExternalRoute(options: { server: FastifyInstance; boxRoot: string }): void {
callback-box/src/webapp/routes/api-external.ts:45:  const { server, boxRoot } = options;
callback-box/src/webapp/routes/api-external.ts:47:  server.get<{ Querystring: { href?: string } }>("/api/external", async (request, reply) => {
callback-box/src/webapp/routes/api-debug-log.ts:25:  server: FastifyInstance;
callback-box/src/webapp/routes/api-debug-log.ts:30: * Register the `/api/debug-log` read/append/clear routes on the Fastify server.
callback-box/src/webapp/routes/api-debug-log.ts:33:  const { server, boxRoot } = options;
callback-box/src/webapp/routes/api-debug-log.ts:55:  server.post<{ Body: { entries: Array<{ level: string; message: string }> } }>(
callback-box/src/webapp/routes/api-debug-log.ts:75:  server.get("/api/debug-log", async () => {
callback-box/src/webapp/routes/api-debug-log.ts:79:  server.delete("/api/debug-log", async () => {
callback-box/src/webapp/routes/api-files-write.ts:30:  server: FastifyInstance;
callback-box/src/webapp/routes/api-files-write.ts:45:  const { server, boxRoot, eventBus } = options;
callback-box/src/webapp/routes/api-files-write.ts:118:  server.put<{ Params: { "*": string }; Body: WriteBody }>("/api/files/*", writeHandler(false));
callback-box/src/webapp/routes/api-files-write.ts:121:  server.post<{ Params: { "*": string }; Body: WriteBody }>("/api/files/*", writeHandler(true));
callback-box/src/webapp/routes/api-files-write.ts:124:  server.post<{ Body: CommitBody }>("/api/files-commit", async (request, reply) => {
callback-box/src/webapp/routes/chat-context.ts:18:  server: FastifyInstance;
callback-box/src/webapp/routes/chat.ts:43:  server: FastifyInstance;
callback-box/src/webapp/routes/chat.ts:49:   * send doesn't pay spawn + initialize latency. Production servers set
callback-box/src/webapp/routes/chat.ts:57: * Register chat routes on the Fastify server.
callback-box/src/webapp/routes/chat.ts:62:  const { server, boxRoot, eventBus, openaiAudio, prewarmChat } = options;
callback-box/src/webapp/routes/chat.ts:65:  await registerChatUploadRoutes({ server, boxRoot });
callback-box/src/webapp/routes/chat.ts:189:    server,
callback-box/src/webapp/routes/chat.ts:212:  // Tear down the registry on server close so subprocesses don't linger.
callback-box/src/webapp/routes/chat.ts:213:  server.addHook("onClose", async () => {
callback-box/src/webapp/routes/capture.ts:5: * as session.json inside the temp dir so it survives server restarts (see
callback-box/src/webapp/routes/capture.ts:35:  server: FastifyInstance;
callback-box/src/webapp/routes/capture.ts:44:  const { server, boxRoot, boxSlug, eventBus } = options;
callback-box/src/webapp/routes/capture.ts:47:  server.post("/api/capture/sessions", async (_request, _reply) => {
callback-box/src/webapp/routes/capture.ts:64:  server.post<{
callback-box/src/webapp/routes/capture.ts:130:  server.delete<{
callback-box/src/webapp/routes/capture.ts:143:  server.post<{
callback-box/src/webapp/routes/commands.ts:76:  server: FastifyInstance;
callback-box/src/webapp/routes/commands.ts:82: * Register command routes on the Fastify server.
callback-box/src/webapp/routes/commands.ts:87:  const { server, boxRoot, eventBus } = options;
callback-box/src/webapp/routes/commands.ts:89:  server.get("/api/commands/list", async () => {
callback-box/src/webapp/routes/commands.ts:101:  server.get<{ Params: { name: string } }>(
callback-box/src/webapp/routes/commands.ts:117:  server.post<{ Body: ExecuteBody }>(
callback-box/src/webapp/routes/commands.ts:157:  server.post<{ Body: ExecuteBody }>(
callback-box/src/webapp/routes/commands.ts:213:  server.post("/api/upload", async (request: FastifyRequest, reply: FastifyReply) => {
callback-box/src/webapp/routes/api-browse.ts:25:  server: FastifyInstance;
callback-box/src/webapp/routes/api-browse.ts:30: * Register the `GET /api/browse/*` directory-listing route on the server.
callback-box/src/webapp/routes/api-browse.ts:33:  const { server, boxRoot } = options;
callback-box/src/webapp/routes/api-browse.ts:36:  server.get<{ Params: { "*": string } }>(
callback-box/src/webapp/trpc/routers/scheduler-run.ts:1:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/routes/chat-audio-routes.ts:30:import { serveMockTts } from "../tts-mock.js";
callback-box/src/webapp/routes/chat-audio-routes.ts:48:  const { server, boxRoot, openaiAudio } = ctx;
callback-box/src/webapp/routes/chat-audio-routes.ts:53:  server.post("/api/chat/transcribe-audio", async (request, reply) => {
callback-box/src/webapp/routes/chat-audio-routes.ts:91:  server.get("/api/chat/voice-config", async (_request, _reply): Promise<CompiledSpeakingVoice> => {
callback-box/src/webapp/routes/chat-audio-routes.ts:110:  server.post<{ Body: TtsBody }>("/api/chat/tts", async (request, reply) => {
callback-box/src/webapp/routes/chat-audio-routes.ts:116:      return serveMockTts(reply, { text, fixture, delayMs, chunkMs, chunkSize });
callback-box/src/webapp/routes/chat-audio-routes.ts:152:  server.get("/api/chat/transcribe-ws", { websocket: true }, async (socket) => {
callback-box/src/webapp/trpc/routers/drive.ts:3:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/trpc/routers/todos.ts:9:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/routes/admin.ts:46: * Extract the base server URL from a box's publicUrl by stripping the
callback-box/src/webapp/routes/admin.ts:58:function addOwnerCheck(server: FastifyInstance) {
callback-box/src/webapp/routes/admin.ts:59:  server.addHook("preHandler", async (request, reply) => {
callback-box/src/webapp/routes/admin.ts:69:export async function registerSystemAdminRoutes(server: FastifyInstance, services?: Services) {
callback-box/src/webapp/routes/admin.ts:71:  addOwnerCheck(server);
callback-box/src/webapp/routes/admin.ts:75:  server.get("/api/admin/claude-status", async () => {
callback-box/src/webapp/routes/admin.ts:79:  server.post("/api/admin/claude-login", async (_request, reply) => {
callback-box/src/webapp/routes/admin.ts:88:  server.post("/api/admin/claude-logout", async () => {
callback-box/src/webapp/routes/admin.ts:99:export async function registerGoogleServicesCallback(server: FastifyInstance, { boxes }: { boxes: Array<{ slug: string; boxRoot: string }> }) {
callback-box/src/webapp/routes/admin.ts:100:  server.get("/auth/google-services/callback", async (request, reply) => {
callback-box/src/webapp/routes/admin.ts:127:    // Use the server base URL (strip box slug from publicUrl)
callback-box/src/webapp/routes/admin.ts:156:export async function registerBoxAdminRoutes(server: FastifyInstance, { boxRoot, boxSlug, services }: { boxRoot: string; boxSlug: string; services?: Services }) {
callback-box/src/webapp/routes/admin.ts:158:  addOwnerCheck(server);
callback-box/src/webapp/routes/admin.ts:160:  registerTelegramAdminRoutes(server, { boxRoot, boxSlug, services: resolvedServices });
callback-box/src/webapp/routes/admin.ts:161:  registerGoogleAdminRoutes(server, { boxRoot, boxSlug });
callback-box/src/webapp/routes/admin.ts:162:  registerBoxConfigRoutes(server, { boxRoot, boxSlug });
callback-box/src/webapp/routes/admin.ts:166:function registerTelegramAdminRoutes(server: FastifyInstance, { boxRoot, boxSlug, services }: { boxRoot: string; boxSlug: string; services: Services }) {
callback-box/src/webapp/routes/admin.ts:174:  server.get("/api/admin/telegram-status", async () => {
callback-box/src/webapp/routes/admin.ts:205:  server.post("/api/admin/telegram-setup", async (request, reply) => {
callback-box/src/webapp/routes/admin.ts:255:  server.post("/api/admin/telegram-disconnect", async () => {
callback-box/src/webapp/routes/admin.ts:274:function registerGoogleAdminRoutes(server: FastifyInstance, { boxRoot, boxSlug }: { boxRoot: string; boxSlug: string }) {
callback-box/src/webapp/routes/admin.ts:280:  server.get("/api/admin/google-status", async () => {
callback-box/src/webapp/routes/admin.ts:295:  server.post("/api/admin/google-setup", async (request, reply) => {
callback-box/src/webapp/routes/admin.ts:302:    // Use the server base URL (strip box slug from publicUrl) for the redirect URI
callback-box/src/webapp/routes/admin.ts:322:  server.post("/api/admin/google-disconnect", async () => {
callback-box/src/webapp/routes/admin.ts:340:function registerBoxConfigRoutes(server: FastifyInstance, { boxRoot, boxSlug }: { boxRoot: string; boxSlug: string }) {
callback-box/src/webapp/routes/admin.ts:343:  server.get("/api/admin/box-config", async () => {
callback-box/src/webapp/routes/admin.ts:364:  server.post("/api/admin/box-config", async (request, reply) => {
callback-box/src/webapp/trpc/routers/commands.ts:2:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/trpc/routers/actions.ts:2:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/trpc/routers/events.ts:16:import { tracked } from "@trpc/server";
callback-box/src/webapp/server-types.ts:2: * Shared types for the web app server and its sibling helper modules.
callback-box/src/webapp/server-types.ts:4: * forming an import cycle with server.ts.
callback-box/src/webapp/server-types.ts:25:   * production (`cb serve`); leave undefined in tests so test runs don't
callback-box/src/webapp/server-types.ts:33:  server: FastifyInstance;
callback-box/src/webapp/trpc/routers/calendar.ts:3:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/trpc/routers/admin.ts:5:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/trpc/routers/chat.ts:219:   * deserve a row.
callback-box/src/webapp/trpc/routers/scheduler.ts:6:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/trpc/routers/health.ts:35:  /** ISO timestamp of when this server process started. */
callback-box/src/webapp/trpc/routers/health.ts:235:  // On Linux (the deployed server) Claude Code stores them at
callback-box/src/webapp/trpc/routers/card.ts:4:import { TRPCError } from "@trpc/server";

exec
/opt/homebrew/bin/bash -lc "rg -n \"serve|web|callback-serve|CB_CLI_PREBUILT\" callback-box/src/cli callback-box/src/webapp callback-box/deploy/*.service callback-box/deploy -g '"'!deploy.sh'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 exited 2 in 0ms:
rg: callback-box/deploy/*.service: No such file or directory (os error 2)
callback-box/src/cli/index.ts:19:  serveCommand,
callback-box/src/cli/index.ts:77:program.addCommand(serveCommand);
callback-box/src/webapp/server-root.ts:2: * Root-level (non-box-scoped) routes and handlers for the web app server:
callback-box/src/webapp/server-root.ts:4: * SPA fallback / not-found handler. Split out of server.ts to keep that
callback-box/src/webapp/server-root.ts:15:import type { BoxSpec } from "./server-types.js";
callback-box/src/webapp/server-root.ts:23:export function registerChromeExtensionCors(server: FastifyInstance): void {
callback-box/src/webapp/server-root.ts:25:  server.addHook("onSend", (request, reply, payload, done) => {
callback-box/src/webapp/server-root.ts:35:  server.options("/api/boxes", async (request, reply) => {
callback-box/src/webapp/server-root.ts:70:export function registerRootInfoRoutes(server: FastifyInstance, boxes: BoxSpec[]): void {
callback-box/src/webapp/server-root.ts:74:  // server-level state — boxes have their own richer health endpoint at
callback-box/src/webapp/server-root.ts:76:  server.get("/healthz", async (request, reply) => {
callback-box/src/webapp/server-root.ts:89:  server.get("/api/build-info", async () => {
callback-box/src/webapp/server-root.ts:104:  server.get("/api/boxes", async (request) => {
callback-box/src/webapp/server-root.ts:117: * Install the SPA fallback not-found handler: serves index.html for page
callback-box/src/webapp/server-root.ts:121:export function registerSpaFallback(server: FastifyInstance, frontendPath: string): void {
callback-box/src/webapp/server-root.ts:122:  server.setNotFoundHandler(async (request, reply) => {
callback-box/src/webapp/server-root.ts:125:    // Don't serve index.html for root-level API
callback-box/src/webapp/server-root.ts:149:    // SPA fallback: serve index.html
callback-box/src/webapp/server-root.ts:158: * a minimal HTML listing of the served boxes.
callback-box/src/webapp/server-root.ts:160:export function registerUnbuiltFrontendRoot(server: FastifyInstance, boxes: BoxSpec[]): void {
callback-box/src/webapp/server-root.ts:161:  server.get("/", async (_request, reply) => {
callback-box/deploy/migrate-to-callback-user.sh:5:# Run on the server as root: bash /opt/callback/callback-box/deploy/migrate-to-callback-user.sh
callback-box/deploy/migrate-to-callback-user.sh:16:systemctl stop callback-serve callback-scheduler 2>/dev/null || true
callback-box/deploy/migrate-to-callback-user.sh:84:cat > /etc/systemd/system/callback-serve.service <<EOF
callback-box/deploy/migrate-to-callback-user.sh:93:ExecStart=/usr/local/bin/cb serve --host 0.0.0.0 --port 3210 $BOX_DIRS
callback-box/deploy/migrate-to-callback-user.sh:130:systemctl restart callback-serve callback-scheduler
callback-box/deploy/migrate-to-callback-user.sh:138:systemctl is-active callback-serve || true
callback-box/deploy/migrate-to-callback-user.sh:141:echo "Verify: systemctl show callback-serve --property=User"
callback-box/src/webapp/auth.ts:4: * Uses signed cookies (HMAC-SHA256) — no server-side session store.
callback-box/src/webapp/server-main.ts:2: * Server entry point. Run directly to start the Fastify server:
callback-box/src/webapp/server-main.ts:3: *   node --import tsx ./src/webapp/server-main.ts [boxDirs...]
callback-box/src/webapp/server-main.ts:6: * This is kept separate from `server.ts` so that importing the server
callback-box/src/webapp/server-main.ts:7: * library (e.g. from the `cb serve` command, or when the CLI is bundled)
callback-box/src/webapp/server-main.ts:8: * has no side effects — only running THIS file starts a server.
callback-box/src/webapp/server-main.ts:11:import { startServer, type BoxSpec } from "./server.js";
callback-box/deploy/CLAUDE.md:7:- `create-server.sh` — provision a Hetzner box
callback-box/deploy/CLAUDE.md:8:- `setup-server.sh` — install software, create `callback` user, clone repos
callback-box/deploy/CLAUDE.md:9:- `server-ip` — target server IP (not committed)
callback-box/deploy/CLAUDE.md:20:Then confirm the server picked up the new commit:
callback-box/deploy/CLAUDE.md:23:ssh root@$(cat deploy/server-ip) 'cat /opt/callback/callback-box/deploy-info.json'
callback-box/deploy/README.md:3:Scripts for provisioning and managing a Hetzner cloud server running callback-box.
callback-box/deploy/README.md:10:- **SSH agent**: `ssh-add` (needed for GitHub access on the server via agent forwarding)
callback-box/deploy/README.md:23:### `create-server.sh` — Create a new server from scratch
callback-box/deploy/README.md:25:Destroys any existing server, creates a fresh Hetzner VPS, provisions it, and sets up DNS.
callback-box/deploy/README.md:28:./deploy/create-server.sh
callback-box/deploy/README.md:32:1. Deletes existing `callback-box` server if present (cleans up stale SSH keys)
callback-box/deploy/README.md:37:6. Uploads and runs `setup-server.sh` on the server
callback-box/deploy/README.md:39:### `setup-server.sh` — Provision a bare server (runs remotely)
callback-box/deploy/README.md:46:- Creates systemd services for web server and scheduler
callback-box/deploy/README.md:49:### `add-box.sh` — Add a box to the server
callback-box/deploy/README.md:51:Clones a box repo, registers it with the scheduler, and updates the serve service.
callback-box/deploy/README.md:64:Each box is served at `https://box.example.com/<box-name>/`.
callback-box/deploy/README.md:74:### `ssh-server.sh` — SSH into the server
callback-box/deploy/README.md:78:./deploy/ssh-server.sh
callback-box/deploy/README.md:81:./deploy/ssh-server.sh systemctl status callback-serve
callback-box/deploy/README.md:84:Uses agent forwarding (`-A`) so your local SSH key works for GitHub operations on the server.
callback-box/deploy/README.md:102:- `callback-serve` — Web server serving all boxes in `/home/callback/boxes/`
callback-box/deploy/README.md:107:systemctl status callback-serve
callback-box/deploy/README.md:111:journalctl -u callback-serve -f
callback-box/deploy/README.md:115:systemctl restart callback-serve callback-scheduler
callback-box/deploy/README.md:142:After editing `.env`, restart services: `systemctl restart callback-serve callback-scheduler`
callback-box/deploy/README.md:159:5. Restart services: `systemctl restart callback-serve`
callback-box/deploy/README.md:173:Webhooks (`/webhook/<box>/`) remain unauthenticated so external services (Telegram, etc.) still work.
callback-box/deploy/README.md:181:./deploy/ssh-server.sh
callback-box/deploy/README.md:183:echo '{"botToken":"...","webhookSecret":"..."}' > telegram.secret.json
callback-box/deploy/README.md:188:- DNS: `box.example.com` → server IP (Cloudflare proxied, auto-managed by `create-server.sh`)
callback-box/deploy/rebuild.sh:2:# Pull latest and rebuild on the server (runs locally, executes remotely)
callback-box/deploy/rebuild.sh:4:exec "$SCRIPT_DIR/ssh-server.sh" /root/rebuild-server.sh
callback-box/deploy/create-server.sh:33:# ── Destroy existing server ─────────────────────────────────────────
callback-box/deploy/create-server.sh:34:if hcloud server describe "$SERVER_NAME" &>/dev/null; then
callback-box/deploy/create-server.sh:35:  OLD_IP=$(hcloud server ip "$SERVER_NAME" 2>/dev/null || true)
callback-box/deploy/create-server.sh:36:  echo "Destroying existing server '$SERVER_NAME'..."
callback-box/deploy/create-server.sh:37:  hcloud server delete "$SERVER_NAME"
callback-box/deploy/create-server.sh:56:# ── Create server ───────────────────────────────────────────────────
callback-box/deploy/create-server.sh:57:echo "Creating server '$SERVER_NAME' ($SERVER_TYPE in $LOCATION)..."
callback-box/deploy/create-server.sh:58:hcloud server create \
callback-box/deploy/create-server.sh:65:SERVER_IP=$(hcloud server ip "$SERVER_NAME")
callback-box/deploy/create-server.sh:66:echo "$SERVER_IP" > "$SCRIPT_DIR/server-ip"
callback-box/deploy/create-server.sh:127:scp -o StrictHostKeyChecking=no "$SCRIPT_DIR/setup-server.sh" "$SCRIPT_DIR/rebuild-server.sh" "root@$SERVER_IP:/root/"
callback-box/deploy/create-server.sh:128:ssh -o StrictHostKeyChecking=no "root@$SERVER_IP" "chmod +x /root/setup-server.sh /root/rebuild-server.sh && ln -sf /root/rebuild-server.sh /usr/local/bin/cb-rebuild"
callback-box/deploy/create-server.sh:130:echo "Running setup on server (this will take a few minutes)..."
callback-box/deploy/create-server.sh:131:ssh -A -o StrictHostKeyChecking=no "root@$SERVER_IP" "chmod +x /root/setup-server.sh && /root/setup-server.sh"
callback-box/deploy/create-server.sh:145:echo "    1. Edit /root/.env on the server with your API keys"
callback-box/deploy/create-server.sh:146:echo "    2. Restart services: systemctl restart callback-serve callback-scheduler"
callback-box/src/webapp/routes/api-image.ts:4: *   GET /api/image/* — resolve and serve an image by box-relative path
callback-box/src/webapp/routes/api-image.ts:7: *  - Plain image file (`.jpg`, `.png`, etc.) — served directly.
callback-box/src/webapp/routes/api-image.ts:10: *    and serves the attached image.
callback-box/src/webapp/routes/api-image.ts:22:const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"]);
callback-box/src/webapp/routes/api-image.ts:29:  ".webp": "image/webp",
callback-box/src/webapp/routes/api-image.ts:88:  server,
callback-box/src/webapp/routes/api-image.ts:91:  server: FastifyInstance;
callback-box/src/webapp/routes/api-image.ts:94:  server.get<{ Params: { "*": string } }>(
callback-box/src/webapp/routes/api-image.ts:162:          console.warn(`[api-image] could not serve ${imageAbs}:`, e);
callback-box/deploy/add-box.sh:4:# Add a box to the server: clone its repo, register with scheduler,
callback-box/deploy/add-box.sh:5:# and update the serve service to include it.
callback-box/deploy/add-box.sh:40:# ── Get server IP ───────────────────────────────────────────────────
callback-box/deploy/add-box.sh:41:if [[ -f "$SCRIPT_DIR/server-ip" ]]; then
callback-box/deploy/add-box.sh:42:  SERVER_IP=$(cat "$SCRIPT_DIR/server-ip")
callback-box/deploy/add-box.sh:44:  SERVER_IP=$(hcloud server ip callback-box 2>/dev/null)
callback-box/deploy/add-box.sh:48:  echo "Error: No server IP found. Run create-server.sh first."
callback-box/deploy/add-box.sh:56:# ── Clone the box repo on the server ────────────────────────────────
callback-box/deploy/add-box.sh:84:# Register with the shared box manifest (used by both serve and scheduler).
callback-box/deploy/add-box.sh:88:# (No unit rewrite needed — `cb serve` reads ~/.config/cb/boxes.json
callback-box/deploy/add-box.sh:90:systemctl restart callback-serve callback-scheduler
callback-box/deploy/add-box.sh:98:# Wait for server to be ready, then run health check
callback-box/deploy/add-box.sh:102:  echo "  Health check: could not reach server (may still be starting)"
callback-box/src/cli/commands/chat-audio.ts:6: *   to a temp file (the browser caches the last segment's WAV; the server
callback-box/src/cli/commands/chat-audio.ts:34: * Request headers for loopback calls to the live server: JSON content type
callback-box/src/cli/commands/chat-audio.ts:48:  if (contentType.includes("webm")) return "webm";
callback-box/src/cli/commands/chat-audio.ts:60:    ".webm": "audio/webm",
callback-box/src/cli/commands/chat-audio.ts:80: * Long-poll the server for the last voice message's recording. Prints a
callback-box/src/cli/commands/chat-audio.ts:89:  const serverUrl = process.env.CB_SERVER_URL;
callback-box/src/cli/commands/chat-audio.ts:91:  if (!serverUrl || !boxName) {
callback-box/src/cli/commands/chat-audio.ts:100:  const url = `${serverUrl.replace(/\/+$/, "")}/${boxName}/api/chat/last-audio/request`;
callback-box/deploy/rebuild-server.sh:4:# Pull latest code and rebuild on the server.
callback-box/deploy/rebuild-server.sh:5:# Run locally: ./deploy/rebuild-server.sh
callback-box/deploy/rebuild-server.sh:6:# Or on server directly: /root/rebuild.sh
callback-box/deploy/rebuild-server.sh:26:systemctl restart callback-serve callback-scheduler
callback-box/deploy/rebuild-server.sh:29:systemctl is-active callback-serve || true
callback-box/src/cli/commands/index.ts:12:export { serveCommand } from "./serve.js";
callback-box/deploy/ssh-server.sh:2:# SSH into the callback-box server (with agent forwarding)
callback-box/deploy/ssh-server.sh:5:if [[ -f "$SCRIPT_DIR/server-ip" ]]; then
callback-box/deploy/ssh-server.sh:6:  SERVER_IP=$(cat "$SCRIPT_DIR/server-ip")
callback-box/deploy/ssh-server.sh:8:  SERVER_IP=$(hcloud server ip callback-box 2>/dev/null)
callback-box/deploy/ssh-server.sh:10:    echo "Error: No server IP found. Run create-server.sh first."
callback-box/src/webapp/routes/auth.ts:21:import type { BoxSpec } from "../server.js";
callback-box/src/webapp/routes/auth.ts:28:  server: FastifyInstance,
callback-box/src/webapp/routes/auth.ts:38:  server.get<{ Querystring: { returnTo?: string } }>(
callback-box/src/webapp/routes/auth.ts:51:  server.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
callback-box/src/webapp/routes/auth.ts:118:  server.get("/auth/logout", async (_request, reply) => {
callback-box/src/webapp/routes/auth.ts:124:  server.get("/auth/me", async (request, reply) => {
callback-box/deploy/setup-server.sh:133:# ── Systemd: callback-serve ─────────────────────────────────────────
callback-box/deploy/setup-server.sh:138:# Both serve and scheduler consult the same manifest at
callback-box/deploy/setup-server.sh:140:# paths; `cb serve` reads the manifest at startup, and a future
callback-box/deploy/setup-server.sh:141:# `cb boxes add <path>` just requires `systemctl restart callback-serve`
callback-box/deploy/setup-server.sh:143:cat > /etc/systemd/system/callback-serve.service <<EOF
callback-box/deploy/setup-server.sh:152:ExecStart=/usr/local/bin/cb serve --host 0.0.0.0 --port 3210
callback-box/deploy/setup-server.sh:163:# Register all existing boxes in the manifest used by both serve and
callback-box/deploy/setup-server.sh:190:# sessions, so server-side short-lived invocations drift behind.
callback-box/deploy/setup-server.sh:250:systemctl enable callback-serve callback-scheduler claude-update.timer
callback-box/deploy/setup-server.sh:251:systemctl start callback-serve callback-scheduler claude-update.timer
callback-box/deploy/setup-server.sh:256:server {
callback-box/deploy/setup-server.sh:257:    listen 80 default_server;
callback-box/deploy/setup-server.sh:258:    listen [::]:80 default_server;
callback-box/deploy/setup-server.sh:259:    server_name _;
callback-box/deploy/setup-server.sh:284:systemctl is-active callback-serve || true
callback-box/src/webapp/routes/api-files-write.ts:30:  server: FastifyInstance;
callback-box/src/webapp/routes/api-files-write.ts:45:  const { server, boxRoot, eventBus } = options;
callback-box/src/webapp/routes/api-files-write.ts:118:  server.put<{ Params: { "*": string }; Body: WriteBody }>("/api/files/*", writeHandler(false));
callback-box/src/webapp/routes/api-files-write.ts:121:  server.post<{ Params: { "*": string }; Body: WriteBody }>("/api/files/*", writeHandler(true));
callback-box/src/webapp/routes/api-files-write.ts:124:  server.post<{ Body: CommitBody }>("/api/files-commit", async (request, reply) => {
callback-box/src/webapp/routes/chat-context.ts:18:  server: FastifyInstance;
callback-box/deploy/claude-update.sh:3:# Installed by setup-server.sh at /usr/local/sbin/claude-update.sh and
callback-box/src/cli/commands/google-auth.ts:6: * 2. Start ephemeral local server on port 8976
callback-box/src/cli/commands/google-auth.ts:94:      // Start ephemeral server to receive the callback
callback-box/src/cli/commands/google-auth.ts:95:      const server = Fastify();
callback-box/src/cli/commands/google-auth.ts:99:          server.get(
callback-box/src/cli/commands/google-auth.ts:148:          server.listen({ port: 8976, host: "127.0.0.1" }).then(() => {
callback-box/src/cli/commands/google-auth.ts:156:      // Shut down the server
callback-box/src/cli/commands/google-auth.ts:157:      await server.close();
callback-box/src/webapp/routes/chat-audio-routes.ts:30:import { serveMockTts } from "../tts-mock.js";
callback-box/src/webapp/routes/chat-audio-routes.ts:48:  const { server, boxRoot, openaiAudio } = ctx;
callback-box/src/webapp/routes/chat-audio-routes.ts:53:  server.post("/api/chat/transcribe-audio", async (request, reply) => {
callback-box/src/webapp/routes/chat-audio-routes.ts:57:    const filename = data.filename || "segment.webm";
callback-box/src/webapp/routes/chat-audio-routes.ts:91:  server.get("/api/chat/voice-config", async (_request, _reply): Promise<CompiledSpeakingVoice> => {
callback-box/src/webapp/routes/chat-audio-routes.ts:110:  server.post<{ Body: TtsBody }>("/api/chat/tts", async (request, reply) => {
callback-box/src/webapp/routes/chat-audio-routes.ts:116:      return serveMockTts(reply, { text, fixture, delayMs, chunkMs, chunkSize });
callback-box/src/webapp/routes/chat-audio-routes.ts:152:  server.get("/api/chat/transcribe-ws", { websocket: true }, async (socket) => {
callback-box/src/webapp/routes/scheduler.ts:2: * Scheduler log routes — serves JSONL scheduler logs for the current box.
callback-box/src/webapp/routes/scheduler.ts:21:  server: FastifyInstance,
callback-box/src/webapp/routes/scheduler.ts:32:  server.get<{
callback-box/src/webapp/routes/scheduler.ts:92:  server.get("/api/schedules", async () => {
callback-box/src/webapp/routes/chat-session-routes.ts:5: * GET  /api/chat/sessions         - List web chat sessions (history + metadata)
callback-box/src/webapp/routes/chat-session-routes.ts:7: * POST /api/chat/restart          - Kill the subprocess (preserves session id)
callback-box/src/webapp/routes/chat-session-routes.ts:73:/** Build the labeled, sorted web-chat session list for GET /api/chat/sessions. */
callback-box/src/webapp/routes/chat-session-routes.ts:110:  const { server, boxRoot, registry, scheduleManager, wireSession } = ctx;
callback-box/src/webapp/routes/chat-session-routes.ts:114:  server.get<{ Querystring: HistoryQuery }>("/api/chat/history", async (request, reply) => {
callback-box/src/webapp/routes/chat-session-routes.ts:121:  // GET /api/chat/sessions — list web chat sessions only, with first-user-snippet labels.
callback-box/src/webapp/routes/chat-session-routes.ts:122:  server.get("/api/chat/sessions", async () => listWebChatSessions(boxRoot));
callback-box/src/webapp/routes/chat-session-routes.ts:125:  server.post<{ Body: { session?: string } }>("/api/chat/interrupt", async (request, reply) => {
callback-box/src/webapp/routes/chat-session-routes.ts:135:  server.post<{ Body: { session?: string } }>("/api/chat/restart", async (request, reply) => {
callback-box/src/webapp/routes/chat-session-routes.ts:146:  server.get<{ Querystring: { session?: string } }>("/api/chat/status", async (request) => {
callback-box/src/webapp/routes/chat-session-routes.ts:170:  server.get("/api/chat/default", async () => {
callback-box/src/webapp/routes/chat-session-routes.ts:182:  server.post<{ Body: { model: string | null; session?: string } }>(
callback-box/src/webapp/routes/chat-session-routes.ts:211:  server.get<{ Querystring: { session?: string } }>(
callback-box/src/webapp/routes/chat-session-routes.ts:226:  server.post<{ Body: { session?: string; feature?: string; value?: string } }>(
callback-box/src/webapp/routes/chat-session-routes.ts:252:  server.get("/api/chat/schedules", async () => {
callback-box/src/webapp/routes/chat-session-routes.ts:257:  server.post<{ Body: { label: string } }>(
callback-box/src/cli/commands/scheduler.ts:49:// manifest is now shared with `cb serve`, so the canonical commands
callback-box/src/webapp/routes/chat-uploads.ts:18:  server: FastifyInstance;
callback-box/src/webapp/routes/chat-uploads.ts:47:  const { server, boxRoot } = options;
callback-box/src/webapp/routes/chat-uploads.ts:49:  server.post("/api/chat/upload-file", async (request, reply) => {
callback-box/src/cli/commands/feedback.ts:118:      const serverUrl = process.env["CB_SERVER_URL"] ?? null;
callback-box/src/cli/commands/feedback.ts:127:        ...(serverUrl ? [`**Server:** ${serverUrl}`] : []),
callback-box/src/webapp/routes/admin.ts:11: *   POST /api/admin/telegram-setup — save bot token, register webhook
callback-box/src/webapp/routes/admin.ts:46: * Extract the base server URL from a box's publicUrl by stripping the
callback-box/src/webapp/routes/admin.ts:58:function addOwnerCheck(server: FastifyInstance) {
callback-box/src/webapp/routes/admin.ts:59:  server.addHook("preHandler", async (request, reply) => {
callback-box/src/webapp/routes/admin.ts:69:export async function registerSystemAdminRoutes(server: FastifyInstance, services?: Services) {
callback-box/src/webapp/routes/admin.ts:71:  addOwnerCheck(server);
callback-box/src/webapp/routes/admin.ts:75:  server.get("/api/admin/claude-status", async () => {
callback-box/src/webapp/routes/admin.ts:79:  server.post("/api/admin/claude-login", async (_request, reply) => {
callback-box/src/webapp/routes/admin.ts:88:  server.post("/api/admin/claude-logout", async () => {
callback-box/src/webapp/routes/admin.ts:99:export async function registerGoogleServicesCallback(server: FastifyInstance, { boxes }: { boxes: Array<{ slug: string; boxRoot: string }> }) {
callback-box/src/webapp/routes/admin.ts:100:  server.get("/auth/google-services/callback", async (request, reply) => {
callback-box/src/webapp/routes/admin.ts:127:    // Use the server base URL (strip box slug from publicUrl)
callback-box/src/webapp/routes/admin.ts:156:export async function registerBoxAdminRoutes(server: FastifyInstance, { boxRoot, boxSlug, services }: { boxRoot: string; boxSlug: string; services?: Services }) {
callback-box/src/webapp/routes/admin.ts:158:  addOwnerCheck(server);
callback-box/src/webapp/routes/admin.ts:160:  registerTelegramAdminRoutes(server, { boxRoot, boxSlug, services: resolvedServices });
callback-box/src/webapp/routes/admin.ts:161:  registerGoogleAdminRoutes(server, { boxRoot, boxSlug });
callback-box/src/webapp/routes/admin.ts:162:  registerBoxConfigRoutes(server, { boxRoot, boxSlug });
callback-box/src/webapp/routes/admin.ts:166:function registerTelegramAdminRoutes(server: FastifyInstance, { boxRoot, boxSlug, services }: { boxRoot: string; boxSlug: string; services: Services }) {
callback-box/src/webapp/routes/admin.ts:174:  server.get("/api/admin/telegram-status", async () => {
callback-box/src/webapp/routes/admin.ts:183:      const [me, webhookInfo] = await Promise.all([
callback-box/src/webapp/routes/admin.ts:191:        webhookUrl: webhookInfo.url || null,
callback-box/src/webapp/routes/admin.ts:205:  server.post("/api/admin/telegram-setup", async (request, reply) => {
callback-box/src/webapp/routes/admin.ts:219:    const webhookSecret = crypto.randomBytes(32).toString("hex");
callback-box/src/webapp/routes/admin.ts:224:      JSON.stringify({ botToken, webhookSecret }, null, 2) + "\n",
callback-box/src/webapp/routes/admin.ts:228:    let webhookUrl: string | null = null;
callback-box/src/webapp/routes/admin.ts:230:      webhookUrl = `${baseServerUrl(publicUrl)}/webhook/${boxSlug}/telegram`;
callback-box/src/webapp/routes/admin.ts:232:        await tg.setWebhook(webhookUrl, {
callback-box/src/webapp/routes/admin.ts:233:          secret_token: webhookSecret,
callback-box/src/webapp/routes/admin.ts:241:          webhookUrl,
callback-box/src/webapp/routes/admin.ts:242:          webhookError: (err as Error).message,
callback-box/src/webapp/routes/admin.ts:251:      webhookUrl,
callback-box/src/webapp/routes/admin.ts:255:  server.post("/api/admin/telegram-disconnect", async () => {
callback-box/src/webapp/routes/admin.ts:261:      } catch (e) { console.warn("Failed to delete Telegram webhook during disconnect, continuing:", e); }
callback-box/src/webapp/routes/admin.ts:274:function registerGoogleAdminRoutes(server: FastifyInstance, { boxRoot, boxSlug }: { boxRoot: string; boxSlug: string }) {
callback-box/src/webapp/routes/admin.ts:280:  server.get("/api/admin/google-status", async () => {
callback-box/src/webapp/routes/admin.ts:295:  server.post("/api/admin/google-setup", async (request, reply) => {
callback-box/src/webapp/routes/admin.ts:302:    // Use the server base URL (strip box slug from publicUrl) for the redirect URI
callback-box/src/webapp/routes/admin.ts:322:  server.post("/api/admin/google-disconnect", async () => {
callback-box/src/webapp/routes/admin.ts:340:function registerBoxConfigRoutes(server: FastifyInstance, { boxRoot, boxSlug }: { boxRoot: string; boxSlug: string }) {
callback-box/src/webapp/routes/admin.ts:343:  server.get("/api/admin/box-config", async () => {
callback-box/src/webapp/routes/admin.ts:364:  server.post("/api/admin/box-config", async (request, reply) => {
callback-box/src/webapp/routes/chat-last-audio-routes.ts:56:  const { server, eventBus } = ctx;
callback-box/src/webapp/routes/chat-last-audio-routes.ts:59:  server.post<{ Body: LastAudioRequestBody | null }>(
callback-box/src/webapp/routes/chat-last-audio-routes.ts:94:  server.post<{ Params: { requestId: string }; Body: LastAudioAnswerBody | null }>(
callback-box/src/webapp/routes/calendar.ts:26:  server: FastifyInstance;
callback-box/src/webapp/routes/calendar.ts:34:  const { server, boxRoot, calendar } = options;
callback-box/src/webapp/routes/calendar.ts:37:  server.get("/api/calendar/available", async (_request, reply) => {
callback-box/src/webapp/routes/calendar.ts:77:  server.get("/api/calendar/config", async () => {
callback-box/src/webapp/routes/calendar.ts:82:  server.put<{ Body: CalendarConfig }>(
callback-box/src/webapp/routes/api-debug-log.ts:25:  server: FastifyInstance;
callback-box/src/webapp/routes/api-debug-log.ts:30: * Register the `/api/debug-log` read/append/clear routes on the Fastify server.
callback-box/src/webapp/routes/api-debug-log.ts:33:  const { server, boxRoot } = options;
callback-box/src/webapp/routes/api-debug-log.ts:55:  server.post<{ Body: { entries: Array<{ level: string; message: string }> } }>(
callback-box/src/webapp/routes/api-debug-log.ts:75:  server.get("/api/debug-log", async () => {
callback-box/src/webapp/routes/api-debug-log.ts:79:  server.delete("/api/debug-log", async () => {
callback-box/src/webapp/routes/clerk.ts:12:import { createWebpageTemplate } from "../../schemas/webpage.js";
callback-box/src/webapp/routes/clerk.ts:38:  server: FastifyInstance;
callback-box/src/webapp/routes/clerk.ts:45:  const { server, boxRoot } = options;
callback-box/src/webapp/routes/clerk.ts:47:  server.options("/api/clerk/*", async (request, reply) => {
callback-box/src/webapp/routes/clerk.ts:55:  server.get("/api/clerk/commentary-destinations", async (request, reply) => {
callback-box/src/webapp/routes/clerk.ts:61:  server.post("/api/clerk/commentary", async (request, reply) => {
callback-box/src/webapp/routes/clerk.ts:87:    const cardRel = path.join(destDir, `${filename}.webpage.card`);
callback-box/src/webapp/routes/clerk.ts:89:    // The captured page is the webpage card (readable body + frozen snapshot).
callback-box/src/webapp/routes/clerk.ts:103:    // The commentary is a separate card inside the webpage's attach scope: it
callback-box/src/webapp/routes/clerk.ts:105:    // authors the {% source %} anchors. The webpage view surfaces it inline.
callback-box/src/webapp/routes/clerk.ts:118:    // Open the webpage card in a chat companion pane (it renders the page plus
callback-box/src/webapp/routes/clerk.ts:128:  server.get("/api/clerk/actions", async (request, reply) => {
callback-box/src/webapp/routes/clerk.ts:134:  server.post<{ Params: { id: string } }>("/api/clerk/actions/:id/dismiss", async (request, reply) => {
callback-box/src/webapp/routes/clerk.ts:153: * Write a `.webpage.card` (readable body + capture provenance) and, when a
callback-box/src/webapp/routes/api-browse.ts:25:  server: FastifyInstance;
callback-box/src/webapp/routes/api-browse.ts:30: * Register the `GET /api/browse/*` directory-listing route on the server.
callback-box/src/webapp/routes/api-browse.ts:33:  const { server, boxRoot } = options;
callback-box/src/webapp/routes/api-browse.ts:36:  server.get<{ Params: { "*": string } }>(
callback-box/src/webapp/routes/commands.ts:2: * Command execution routes for the webapp.
callback-box/src/webapp/routes/commands.ts:5: * that are shared between CLI and web.
callback-box/src/webapp/routes/commands.ts:76:  server: FastifyInstance;
callback-box/src/webapp/routes/commands.ts:82: * Register command routes on the Fastify server.
callback-box/src/webapp/routes/commands.ts:87:  const { server, boxRoot, eventBus } = options;
callback-box/src/webapp/routes/commands.ts:89:  server.get("/api/commands/list", async () => {
callback-box/src/webapp/routes/commands.ts:101:  server.get<{ Params: { name: string } }>(
callback-box/src/webapp/routes/commands.ts:117:  server.post<{ Body: ExecuteBody }>(
callback-box/src/webapp/routes/commands.ts:157:  server.post<{ Body: ExecuteBody }>(
callback-box/src/webapp/routes/commands.ts:213:  server.post("/api/upload", async (request: FastifyRequest, reply: FastifyReply) => {
callback-box/src/webapp/routes/commands.ts:258:    "audio/webm": ".webm",
callback-box/src/webapp/routes/commands.ts:269:    "image/webp": ".webp",
callback-box/src/webapp/routes/chat.ts:43:  server: FastifyInstance;
callback-box/src/webapp/routes/chat.ts:49:   * send doesn't pay spawn + initialize latency. Production servers set
callback-box/src/webapp/routes/chat.ts:57: * Register chat routes on the Fastify server.
callback-box/src/webapp/routes/chat.ts:62:  const { server, boxRoot, eventBus, openaiAudio, prewarmChat } = options;
callback-box/src/webapp/routes/chat.ts:65:  await registerChatUploadRoutes({ server, boxRoot });
callback-box/src/webapp/routes/chat.ts:189:    server,
callback-box/src/webapp/routes/chat.ts:212:  // Tear down the registry on server close so subprocesses don't linger.
callback-box/src/webapp/routes/chat.ts:213:  server.addHook("onClose", async () => {
callback-box/src/cli/commands/serve.ts:2: * cb serve - Start the webapp server
callback-box/src/cli/commands/serve.ts:5: * Usage: cb serve [dirs...]
callback-box/src/cli/commands/serve.ts:7: *   - No args, manifest populated: serves every box in ~/.config/cb/boxes.json.
callback-box/src/cli/commands/serve.ts:8: *   - No args, manifest empty: serves the current directory (legacy fallback,
callback-box/src/cli/commands/serve.ts:15:import { startServer, DEFAULT_PORT, type BoxSpec } from "../../webapp/server.js";
callback-box/src/cli/commands/serve.ts:44:export const serveCommand = new Command("serve")
callback-box/src/cli/commands/serve.ts:45:  .description("Start the webapp server")
callback-box/src/cli/commands/serve.ts:46:  .argument("[dirs...]", "Box directories to serve (default: current directory)")
callback-box/src/cli/commands/serve.ts:58:    // Resolve which box dirs to serve. Precedence:
callback-box/src/cli/commands/serve.ts:61:    //      servers — added/removed via `cb boxes add|remove`).
callback-box/src/cli/commands/serve.ts:82:      const serverTs = path.join(projectDir, "src/webapp/server-main.ts");
callback-box/src/cli/commands/serve.ts:90:        serverTs,
callback-box/src/cli/commands/serve.ts:94:      // Set PORT/HOST as env vars for the server entry point
callback-box/src/webapp/routes/capture-session-store.ts:5: * as session.json inside the temp dir so it survives server restarts.
callback-box/src/webapp/routes/api-external.ts:10: * server never mounts it.
callback-box/src/webapp/routes/api-external.ts:44:export function registerApiExternalRoute(options: { server: FastifyInstance; boxRoot: string }): void {
callback-box/src/webapp/routes/api-external.ts:45:  const { server, boxRoot } = options;
callback-box/src/webapp/routes/api-external.ts:47:  server.get<{ Querystring: { href?: string } }>("/api/external", async (request, reply) => {
callback-box/src/webapp/routes/telegram.ts:2: * Telegram webhook route.
callback-box/src/webapp/routes/telegram.ts:4: * POST /webhook/<box>/telegram — receives updates from Telegram's Bot API.
callback-box/src/webapp/routes/telegram.ts:26:  server: FastifyInstance;
callback-box/src/webapp/routes/telegram.ts:32:  const { server, boxRoot, eventBus } = opts;
callback-box/src/webapp/routes/telegram.ts:37:  server.post("/telegram", async (request: FastifyRequest, reply: FastifyReply) => {
callback-box/src/webapp/routes/telegram.ts:45:    if (secretHeader !== config.webhookSecret) {
callback-box/src/webapp/routes/telegram.ts:84:          console.error(`[telegram-webhook] Pool handling failed: ${err}`);
callback-box/src/webapp/routes/telegram.ts:90:      request.log.error(err, "Telegram webhook processing failed");
callback-box/src/webapp/routes/capture.ts:2: * Capture session routes — audio recording + photo capture from the web UI.
callback-box/src/webapp/routes/capture.ts:5: * as session.json inside the temp dir so it survives server restarts (see
callback-box/src/webapp/routes/capture.ts:35:  server: FastifyInstance;
callback-box/src/webapp/routes/capture.ts:44:  const { server, boxRoot, boxSlug, eventBus } = options;
callback-box/src/webapp/routes/capture.ts:47:  server.post("/api/capture/sessions", async (_request, _reply) => {
callback-box/src/webapp/routes/capture.ts:64:  server.post<{
callback-box/src/webapp/routes/capture.ts:130:  server.delete<{
callback-box/src/webapp/routes/capture.ts:143:  server.post<{
callback-box/src/webapp/routes/views.ts:22:  server: FastifyInstance;
callback-box/src/webapp/routes/views.ts:27:  const { server, boxRoot } = options;
callback-box/src/webapp/routes/views.ts:30:  server.get("/api/views", async () => {
callback-box/src/webapp/routes/views.ts:35:  server.get<{ Params: { slug: string } }>(
callback-box/src/webapp/routes/views.ts:58:  server.get<{ Params: { slug: string } }>(
callback-box/src/cli/commands/boxes.ts:4: * Both `cb serve` (when invoked without explicit box arguments) and
callback-box/src/cli/commands/boxes.ts:6: * makes it visible to both the webapp and the schedule runner without
callback-box/src/cli/commands/boxes.ts:20:  .description("Manage the box manifest used by serve and scheduler");
callback-box/src/webapp/routes/capture-finalize.ts:88:  const mediaFilename = `${audioBasename}.webm`;
callback-box/src/webapp/routes/capture-finalize.ts:249:  // not session creation time (server-provided) which may differ significantly
callback-box/src/webapp/routes/proxy-image.ts:7: * endpoint, which fetches the image server-side (no Referer restriction) and
callback-box/src/webapp/routes/proxy-image.ts:55:  return a >= 224; // multicast / reserved
callback-box/src/webapp/routes/proxy-image.ts:73: * True when `ip` (a numeric literal) is in a range we must not let the server
callback-box/src/webapp/routes/proxy-image.ts:75: * multicast/reserved. Pure — exported for tests.
callback-box/src/webapp/routes/proxy-image.ts:121:  server: FastifyInstance;
callback-box/src/webapp/routes/proxy-image.ts:125:  const { server } = options;
callback-box/src/webapp/routes/proxy-image.ts:127:  server.get<{ Querystring: { url?: string } }>("/api/proxy-image", async (request, reply) => {
callback-box/src/cli/commands/drive.ts:77:    if (file.webViewLink) {
callback-box/src/cli/commands/drive.ts:78:      console.log(`Link:     ${file.webViewLink}`);
callback-box/src/webapp/routes/chat-helpers.ts:6: * Fastify server, the session registry, or the event bus.
callback-box/src/webapp/routes/chat-helpers.ts:36:   * first turn. Unknown features / invalid values are dropped server-side.
callback-box/src/webapp/routes/chat-helpers.ts:68:  /** Target session id; defaults to the most-active session server-side. */
callback-box/src/webapp/routes/chat-helpers.ts:85:  return /mobi|android|iphone|ipad/i.test(userAgent) ? "web-mobile" : "web-desktop";
callback-box/src/cli/commands/chat.ts:25:  serverUrl: string;
callback-box/src/cli/commands/chat.ts:32:  const url = `${args.serverUrl.replace(/\/+$/, "")}/${args.boxName}/api/chat/self-note`;
callback-box/src/cli/commands/chat.ts:54:    const serverUrl = process.env.CB_SERVER_URL;
callback-box/src/cli/commands/chat.ts:57:    if (!serverUrl) {
callback-box/src/cli/commands/chat.ts:73:        serverUrl,
callback-box/src/cli/commands/chat.ts:86:        `cb chat self-note: server returned ${result.status}: ${result.body}`
callback-box/src/cli/commands/chat.ts:102:  serverUrl: string;
callback-box/src/cli/commands/chat.ts:107:  const url = `${args.serverUrl.replace(/\/+$/, "")}/${args.boxName}/api/chat/whats-changed`;
callback-box/src/cli/commands/chat.ts:126:    const serverUrl = process.env.CB_SERVER_URL;
callback-box/src/cli/commands/chat.ts:128:    if (!serverUrl) {
callback-box/src/cli/commands/chat.ts:138:      const result = await postWhatsChanged({ serverUrl, boxName, session: options.session, card: options.card });
callback-box/src/cli/commands/chat.ts:144:      console.error(`cb chat whats-changed: server returned ${result.status}: ${result.body}`);
callback-box/src/webapp/routes/actions.ts:2: * Action routes for the webapp.
callback-box/src/webapp/routes/actions.ts:36:  server: FastifyInstance;
callback-box/src/webapp/routes/actions.ts:46:  if (mimetype === "audio/webm") return ".webm";
callback-box/src/webapp/routes/actions.ts:52:  return ".webm";
callback-box/src/webapp/routes/actions.ts:158:        via: "web",
callback-box/src/webapp/routes/actions.ts:220:        commit: true, // Always commit from web API
callback-box/src/webapp/routes/actions.ts:339: * Register action routes on the Fastify server.
callback-box/src/webapp/routes/actions.ts:344:  const { server, boxRoot, eventBus } = options;
callback-box/src/webapp/routes/actions.ts:347:  server.post<{ Body: WakeupBody }>("/api/actions/wakeup", async (request, reply) =>
callback-box/src/webapp/routes/actions.ts:352:  server.post<{ Body: AnswerBody }>("/api/actions/answer", async (request, reply) =>
callback-box/src/webapp/routes/actions.ts:357:  server.post<{ Body: CreateBody }>("/api/actions/create", async (request, reply) =>
callback-box/src/webapp/routes/actions.ts:362:  server.post("/api/actions/create-voice-memo", async (request: FastifyRequest, reply) =>
callback-box/src/cli/commands/retro.ts:10: * (and, with the observer, records observations and the run report).
callback-box/src/cli/commands/retro.ts:21:import { createSdkRetroObserver } from "../../core/retro/observer.js";
callback-box/src/cli/commands/retro.ts:25:/** Default per-run cap on sessions observed; overflow waits for the next run. */
callback-box/src/cli/commands/retro.ts:69:  .description("Observe new chat sessions and record what the boxholder taught")
callback-box/src/cli/commands/retro.ts:70:  .option("--max-sessions <n>", "Per-run cap on sessions observed", String(DEFAULT_MAX_SESSIONS))
callback-box/src/cli/commands/retro.ts:71:  .option("--dry-run", "List the sessions that would be observed, without observing")
callback-box/src/cli/commands/retro.ts:86:        `would observe ${planned.length} of ${result.qualified.length} qualified session(s)`
callback-box/src/cli/commands/retro.ts:99:    const observer = createSdkRetroObserver({ boxRoot });
callback-box/src/cli/commands/retro.ts:101:      observer,
callback-box/src/cli/commands/retro.ts:107:      console.log(`run ${summary.runId}: no sessions ready to observe`);
callback-box/src/cli/commands/retro.ts:111:      `observed ${summary.observed} session(s)`,
callback-box/src/cli/commands/retro.ts:115:    if (summary.observerFailures > 0) parts.push(`${summary.observerFailures} failure(s)`);
callback-box/src/webapp/routes/api.ts:2: * REST API routes for the webapp.
callback-box/src/webapp/routes/api.ts:31: * Register API routes on the Fastify server.
callback-box/src/webapp/routes/api.ts:39:  server: FastifyInstance,
callback-box/src/webapp/routes/api.ts:44:  server.get("/api/health", async () => {
callback-box/src/webapp/routes/api.ts:53:  server.get("/api/status", async () => {
callback-box/src/webapp/routes/api.ts:69:  server.get("/api/inbox", async () => {
callback-box/src/webapp/routes/api.ts:77:  server.get("/api/questions", async () => {
callback-box/src/webapp/routes/api.ts:97:  server.get<{ Querystring: { count?: string } }>("/api/activity", async (request) => {
callback-box/src/webapp/routes/api.ts:106:  server.get("/api/context", async () => {
callback-box/src/webapp/routes/api.ts:112:  registerApiBrowseRoutes({ server, boxRoot });
callback-box/src/webapp/routes/api.ts:114:  // /api/files/* — serve and delete raw box files (images, audio, etc.)
callback-box/src/webapp/routes/api.ts:115:  registerApiFilesRoutes({ server, boxRoot, eventBus });
callback-box/src/webapp/routes/api.ts:117:  registerProxyImageRoutes({ server });
callback-box/src/webapp/routes/api.ts:118:  registerApiFilesWriteRoutes({ server, boxRoot, eventBus });
callback-box/src/webapp/routes/api.ts:119:  registerApiAdapterRoutes({ server, boxRoot });
callback-box/src/webapp/routes/api.ts:122:  registerApiImageRoutes({ server, boxRoot });
callback-box/src/webapp/routes/api.ts:127:    registerApiExternalRoute({ server, boxRoot });
callback-box/src/webapp/routes/api.ts:131:  server.get<{ Querystring: { file?: string } }>(
callback-box/src/webapp/routes/api.ts:158:  registerApiDebugLogRoutes({ server, boxRoot });
callback-box/src/webapp/tts-mock.ts:7: * (dev-only /dev/speech route) observe playback timing deterministically:
callback-box/src/webapp/tts-mock.ts:53:export function serveMockTts(reply: FastifyReply, req: MockTtsRequest): FastifyReply {
callback-box/src/webapp/routes/chat-send-routes.ts:147:  const { server, boxRoot, eventBus, registry, scheduleManager, processedMessageIds } = ctx;
callback-box/src/webapp/routes/chat-send-routes.ts:150:  server.post<{ Body: SendBody }>("/api/chat/send", async (request, reply) => {
callback-box/src/webapp/routes/chat-send-routes.ts:260:  server.post<{ Body: SelfNoteBody }>("/api/chat/self-note", async (request, reply) => {
callback-box/src/webapp/routes/chat-send-routes.ts:306:  server.post<{ Body: WhatsChangedBody }>("/api/chat/whats-changed", async (request, reply) => {
callback-box/src/webapp/server-types.ts:2: * Shared types for the web app server and its sibling helper modules.
callback-box/src/webapp/server-types.ts:4: * forming an import cycle with server.ts.
callback-box/src/webapp/server-types.ts:25:   * production (`cb serve`); leave undefined in tests so test runs don't
callback-box/src/webapp/server-types.ts:33:  server: FastifyInstance;
callback-box/src/cli/lib/session-text.ts:30: * See `cb chat self-note` and the webapp `/api/chat/self-note` endpoint.
callback-box/src/webapp/server-box-scope.ts:2: * Per-box route registration for the web app server.
callback-box/src/webapp/server-box-scope.ts:5: * and its webhooks are mounted under /webhook/<slug> outside the auth wall.
callback-box/src/webapp/server-box-scope.ts:6: * Split out of server.ts to keep that file under its line budget.
callback-box/src/webapp/server-box-scope.ts:11:import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
callback-box/src/webapp/server-box-scope.ts:31:import type { BoxSpec, ServerOptions } from "./server-types.js";
callback-box/src/webapp/server-box-scope.ts:46:    // Let static assets (served by fastify-static) through. Scope this
callback-box/src/webapp/server-box-scope.ts:110:  // @fastify/websocket is registered once at the root (server.ts); the box
callback-box/src/webapp/server-box-scope.ts:120:    // where there's no HTTP access log) leaves no server-side trace at all —
callback-box/src/webapp/server-box-scope.ts:148:  await registerActionRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
callback-box/src/webapp/server-box-scope.ts:149:  await registerCommandRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
callback-box/src/webapp/server-box-scope.ts:151:  await registerCalendarRoutes({ server: instance, boxRoot: box.boxRoot, calendar: options.services?.calendar });
callback-box/src/webapp/server-box-scope.ts:153:  await registerChatRoutes({ server: instance, boxRoot: box.boxRoot, eventBus, openaiAudio: options.services?.openaiAudio, prewarmChat: options.prewarmChat });
callback-box/src/webapp/server-box-scope.ts:164:  await registerCaptureRoutes({ server: instance, boxRoot: box.boxRoot, boxSlug: box.slug, eventBus });
callback-box/src/webapp/server-box-scope.ts:165:  await registerClerkRoutes({ server: instance, boxRoot: box.boxRoot });
callback-box/src/webapp/server-box-scope.ts:166:  await registerViewRoutes({ server: instance, boxRoot: box.boxRoot });
callback-box/src/webapp/server-box-scope.ts:180: * Register a box on the server: its main scope under `/<slug>` and its
callback-box/src/webapp/server-box-scope.ts:181: * webhook scope under `/webhook/<slug>` (outside the auth wall).
callback-box/src/webapp/server-box-scope.ts:183:export async function registerBox(server: FastifyInstance, deps: BoxScopeDeps): Promise<void> {
callback-box/src/webapp/server-box-scope.ts:186:  await server.register(async (instance) => {
callback-box/src/webapp/server-box-scope.ts:190:  // Register webhooks at /webhook/<slug>/ — outside auth so external
callback-box/src/webapp/server-box-scope.ts:193:  await server.register(async (instance) => {
callback-box/src/webapp/server-box-scope.ts:194:    await registerTelegramRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
callback-box/src/webapp/server-box-scope.ts:195:  }, { prefix: `/webhook/${box.slug}` });
callback-box/src/webapp/file-etag.ts:6: * the server compares strings, never re-deriving floats.
callback-box/src/webapp/server.ts:2: * Web app server - combined frontend + runner
callback-box/src/webapp/server.ts:10:import fastifyWebsocket from "@fastify/websocket";
callback-box/src/webapp/server.ts:19:import type { ServerOptions } from "./server-types.js";
callback-box/src/webapp/server.ts:20:import { resolveBoxes, killPreviousServer } from "./server-lifecycle.js";
callback-box/src/webapp/server.ts:21:import { registerBox } from "./server-box-scope.js";
callback-box/src/webapp/server.ts:27:} from "./server-root.js";
callback-box/src/webapp/server.ts:29:export type { BoxSpec, ServerOptions, ServerContext } from "./server-types.js";
callback-box/src/webapp/server.ts:34: * Create and configure the Fastify server.
callback-box/src/webapp/server.ts:40:  const server = Fastify({
callback-box/src/webapp/server.ts:49:    // extension POSTs frozen web-page snapshots (single-file HTML with inlined
callback-box/src/webapp/server.ts:55:  registerChromeExtensionCors(server);
callback-box/src/webapp/server.ts:58:  await server.register(fastifyCookie);
callback-box/src/webapp/server.ts:61:  await server.register(fastifyMultipart, {
callback-box/src/webapp/server.ts:68:  await server.register(fastifyWebsocket);
callback-box/src/webapp/server.ts:72:    await server.register(registerAuthRoutes, { boxes });
callback-box/src/webapp/server.ts:77:    server.get("/auth/me", async (_request, reply) => {
callback-box/src/webapp/server.ts:82:  await server.register(async (instance) => {
callback-box/src/webapp/server.ts:86:  await server.register(async (instance) => {
callback-box/src/webapp/server.ts:90:  registerRootInfoRoutes(server, boxes);
callback-box/src/webapp/server.ts:92:  // Path from dist/webapp/ to src/frontend/dist
callback-box/src/webapp/server.ts:98:    await server.register(fastifyStatic, {
callback-box/src/webapp/server.ts:107:    // One EventBus per box — shared by main routes and webhook routes
callback-box/src/webapp/server.ts:111:    await registerBox(server, { box, eventBus, options, frontendPath, frontendExists });
callback-box/src/webapp/server.ts:115:    // SPA fallback — serve index.html for non-API, non-asset routes
callback-box/src/webapp/server.ts:116:    registerSpaFallback(server, frontendPath);
callback-box/src/webapp/server.ts:119:    registerUnbuiltFrontendRoot(server, boxes);
callback-box/src/webapp/server.ts:122:  return server;
callback-box/src/webapp/server.ts:126: * Start the server.
callback-box/src/webapp/server.ts:135:  // Kill previous server for each box
callback-box/src/webapp/server.ts:137:    const pidFile = path.join(box.boxRoot, ".cb-serve.pid");
callback-box/src/webapp/server.ts:141:  const server = await createServer({ ...options, boxes });
callback-box/src/webapp/server.ts:146:    const pidFile = path.join(box.boxRoot, ".cb-serve.pid");
callback-box/src/webapp/server.ts:158:    server.server.closeAllConnections();
callback-box/src/webapp/server.ts:159:    await server.close();
callback-box/src/webapp/server.ts:170:    await server.listen({ port, host });
callback-box/src/webapp/server.ts:171:    // Register live public URLs for each served box so subprocess spawns
callback-box/src/webapp/server.ts:185:    server.log.error(err);
callback-box/src/webapp/context.ts:2: * Agent-shaped context summary for the webapp.
callback-box/src/cli/lib/session.ts:2: * Session log parsing - shared between CLI and web routes.
callback-box/src/cli/lib/session.ts:276: * by the <chat-app .../> snapshot tag the server prepends to every turn.
callback-box/src/cli/lib/session-content.ts:4: * shape used by the CLI and web routes, plus the compact summaries used in
callback-box/src/cli/lib/session-content.ts:80:  // Preserve image blocks so user-pasted images render in history.
callback-box/src/webapp/routes/api-adapters.ts:7: * The adapter injects the provider's auth header server-side, reading the
callback-box/src/webapp/routes/api-adapters.ts:14: * LLM calls normally happen server-side (agents, CLI); this is the bridge
callback-box/src/webapp/routes/api-adapters.ts:54:  server: FastifyInstance;
callback-box/src/webapp/routes/api-adapters.ts:59:  const { server, boxRoot } = options;
callback-box/src/webapp/routes/api-adapters.ts:61:  server.route<{ Params: { adapter: string; "*": string } }>({
callback-box/src/webapp/routes/history.ts:18:  ".webp": "image/webp",
callback-box/src/webapp/routes/history.ts:20:  ".webm": "audio/webm",
callback-box/src/webapp/routes/history.ts:33:  server: FastifyInstance,
callback-box/src/webapp/routes/history.ts:39:  server.get<{
callback-box/src/webapp/routes/history.ts:53:  server.get<{
callback-box/src/webapp/routes/history.ts:70:  server.get<{
callback-box/src/webapp/routes/history.ts:102:  server.get<{
callback-box/src/cli/lib/format.ts:2: * Semantic text formatting for CLI and web output.
callback-box/src/cli/lib/format.ts:5: * translate to ANSI colors for terminal output. The web UI can
callback-box/src/cli/lib/format.ts:11:// Force color output even when not a TTY (for web streaming)
callback-box/src/cli/lib/git-internal.ts:16: * preserved.
callback-box/src/webapp/routes/api-files.ts:8: *   GET (and HEAD) /api/files/* — serve images, audio, etc. with weak ETags
callback-box/src/webapp/routes/api-files.ts:20:// Injected into frozen pages at serve time so a hot-linked image that fails
callback-box/src/webapp/routes/api-files.ts:53:  ".webp": "image/webp",
callback-box/src/webapp/routes/api-files.ts:55:  ".webm": "audio/webm",
callback-box/src/webapp/routes/api-files.ts:67:  // Frozen page captures (SingleFile output, scripts stripped) — serve as HTML
callback-box/src/webapp/routes/api-files.ts:80:  server: FastifyInstance;
callback-box/src/webapp/routes/api-files.ts:86: * Register the `/api/files/*` read + delete routes on the Fastify server.
callback-box/src/webapp/routes/api-files.ts:89:  const { server, boxRoot, eventBus } = options;
callback-box/src/webapp/routes/api-files.ts:92:  server.get<{ Params: { "*": string } }>(
callback-box/src/webapp/routes/api-files.ts:104:      // Don't serve .card files or dotfiles through this endpoint
callback-box/src/webapp/routes/api-files.ts:119:        // Frozen page captures are untrusted, user-saved HTML. We serve them as
callback-box/src/webapp/routes/api-files.ts:126:        // Conditional GET: build weak ETag from mtime + size, serve 304 when
callback-box/src/webapp/routes/api-files.ts:151:        // Frozen pages are never range-served: we inject a fallback script into
callback-box/src/webapp/routes/api-files.ts:208:  server.delete<{ Params: { "*": string } }>(
callback-box/src/webapp/routes/api-files.ts:271: * forms we don't serve (multi-range, malformed) — those get the full file.
callback-box/src/webapp/server-lifecycle.ts:3: * cleanup. Split out of server.ts to keep that file under its line budget.
callback-box/src/webapp/server-lifecycle.ts:9:import type { BoxSpec, ServerOptions } from "./server-types.js";
callback-box/src/webapp/server-lifecycle.ts:24: * Kill any previous server process using the PID file.
callback-box/src/webapp/server-lifecycle.ts:35:      console.log(`Killing previous server (PID ${pid})...`);
callback-box/src/webapp/server-lifecycle.ts:42:        console.log(`Force killing previous server (PID ${pid})...`);
callback-box/src/webapp/server-lifecycle.ts:53:    // readFile threw — no PID file (or unreadable). No previous server to kill.
callback-box/src/cli/lib/git-log.ts:49: * Filter criteria applied server-side via `git log --grep --all-match`.
callback-box/src/webapp/trpc/trpc.ts:1:import { initTRPC } from "@trpc/server";
callback-box/src/cli/lib/git-trailers.ts:24: * Trailer keys indicating a user-facing touchpoint (webapp, API call, voice/text input).
callback-box/src/webapp/trpc/routers/drive.ts:3:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/trpc/routers/drive.ts:76:        link: file.webViewLink,
callback-box/src/webapp/trpc/routers/transcription.ts:4:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/trpc/routers/scheduler.ts:6:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/trpc/routers/scheduler.ts:130:        trailers: { "Source": "webapp", "Endpoint": "scheduler.setEnabled" },
callback-box/src/webapp/trpc/routers/scheduler-run.ts:1:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/trpc/routers/scheduler-run.ts:81:    triggeredBy: "webapp-trigger",
callback-box/src/webapp/trpc/routers/scheduler-run.ts:87:      CB_TRIGGERED_BY: "webapp-trigger",
callback-box/src/webapp/trpc/routers/commands.ts:2:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/trpc/routers/card.ts:4:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/trpc/routers/todos.ts:9:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/trpc/routers/todos.ts:87:        trailers: { Source: "webapp", Endpoint: "todos.updateItem" },
callback-box/src/webapp/trpc/routers/actions.ts:2:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/trpc/routers/actions.ts:82:          via: "web",
callback-box/src/webapp/trpc/routers/health.ts:35:  /** ISO timestamp of when this server process started. */
callback-box/src/webapp/trpc/routers/health.ts:42:// (src/webapp/trpc/routers/health.ts) that's four levels up.
callback-box/src/webapp/trpc/routers/health.ts:235:  // On Linux (the deployed server) Claude Code stores them at
callback-box/src/webapp/trpc/routers/calendar.ts:3:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/trpc/routers/chat.ts:4: * history live as raw Fastify routes (see src/webapp/routes/chat.ts)
callback-box/src/webapp/trpc/routers/chat.ts:219:   * deserve a row.
callback-box/src/webapp/trpc/routers/events.ts:16:import { tracked } from "@trpc/server";
callback-box/src/webapp/trpc/routers/admin.ts:5:import { TRPCError } from "@trpc/server";
callback-box/src/webapp/trpc/routers/admin.ts:40:      const [me, webhookInfo] = await Promise.all([
callback-box/src/webapp/trpc/routers/admin.ts:48:        webhookUrl: webhookInfo.url || null,
callback-box/src/webapp/trpc/routers/admin.ts:76:      const webhookSecret = crypto.randomBytes(32).toString("hex");
callback-box/src/webapp/trpc/routers/admin.ts:81:        JSON.stringify({ botToken: input.botToken, webhookSecret }, null, 2) + "\n",
callback-box/src/webapp/trpc/routers/admin.ts:95:      let webhookUrl: string | null = null;
callback-box/src/webapp/trpc/routers/admin.ts:97:        webhookUrl = `${baseServerUrl(publicUrl)}/webhook/${ctx.boxSlug}/telegram`;
callback-box/src/webapp/trpc/routers/admin.ts:99:          await tg.setWebhook(webhookUrl, {
callback-box/src/webapp/trpc/routers/admin.ts:100:            secret_token: webhookSecret,
callback-box/src/webapp/trpc/routers/admin.ts:108:            webhookUrl,
callback-box/src/webapp/trpc/routers/admin.ts:109:            webhookError: (err as Error).message,
callback-box/src/webapp/trpc/routers/admin.ts:118:        webhookUrl,
callback-box/src/webapp/trpc/routers/admin.ts:128:      } catch (e) { console.warn("Failed to delete Telegram webhook during disconnect (continuing):", e); }

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/box.ts | sed -n '1,280p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Box directory structure operations.
     3	 *
     4	 * Creates and manages the standard directory layout for a callback box.
     5	 */
     6	
     7	import * as fs from "node:fs/promises";
     8	import * as path from "node:path";
     9	import { BOX_DIRS, BOX_MARKER, boxPath } from "../cli/lib/paths.js";
    10	import { initRepo, isRepo } from "../cli/lib/git.js";
    11	import { MIGRATIONS } from "./migrations.js";
    12	import {
    13	  installSchemasGuide,
    14	  installTricksFiles,
    15	  installViewsGuide,
    16	} from "./box-templates.js";
    17	
    18	export interface InitOptions {
    19	  /** Skip git initialization */
    20	  skipGit?: boolean | undefined;
    21	  /** Initial branch name */
    22	  branch?: string | undefined;
    23	}
    24	
    25	export interface InitResult {
    26	  /** Whether this was a fresh init or an update of an existing box */
    27	  isUpdate: boolean;
    28	}
    29	
    30	/**
    31	 * Initialize a new callback box or update an existing one.
    32	 *
    33	 * On a fresh init: creates directories, marker, .gitignore, git repo, initial commit.
    34	 * On an existing box: ensures directories exist, updates .gitignore.
    35	 *
    36	 * @param boxRoot - Directory to initialize (will be created if needed)
    37	 * @param options - Initialization options
    38	 */
    39	export async function initBox(boxRoot: string, options?: InitOptions): Promise<InitResult> {
    40	  options = options ?? {};
    41	  const resolvedRoot = path.resolve(boxRoot);
    42	
    43	  // Create root directory if needed
    44	  await fs.mkdir(resolvedRoot, { recursive: true });
    45	
    46	  // Check if already initialized
    47	  const markerPath = path.join(resolvedRoot, BOX_MARKER);
    48	  const isUpdate = await isValidBox(resolvedRoot);
    49	
    50	  // Create all standard directories (safe to re-run)
    51	  await ensureDirectories(resolvedRoot);
    52	
    53	  if (!isUpdate) {
    54	    // Create marker file with metadata
    55	    const marker = {
    56	      version: "1.0.0",
    57	      created: new Date().toISOString(),
    58	    };
    59	    await fs.writeFile(markerPath, JSON.stringify(marker, null, 2) + "\n");
    60	  }
    61	
    62	  // Seed the migration manifest for fresh boxes with every known migration
    63	  // marked applied — a brand-new box's data is created in the current
    64	  // format, so none of the historical data migrations need to run against
    65	  // it. Future migrations added after init will show up as pending.
    66	  // Already-initialized boxes never get one auto-created here: an existing
    67	  // box without a manifest is a legacy box, and the user must explicitly
    68	  // run `cb migrate --mark-all-applied` (or --init) to decide its starting
    69	  // state. See `src/cli/commands/migrate.ts`.
    70	  if (!isUpdate) {
    71	    const manifestPath = path.join(resolvedRoot, "config/migrations.jsonl");
    72	    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    73	    try {
    74	      await fs.access(manifestPath);
    75	    } catch (_e) {
    76	      // No manifest yet (fs.access throws ENOENT) — seed one. The error
    77	      // carries no actionable info; absence is the normal create path.
    78	      const now = new Date().toISOString();
    79	      const lines = MIGRATIONS
    80	        .map((m) => `${JSON.stringify({ name: m.name, "applied-at": now })}\n`)
    81	        .join("");
    82	      await fs.writeFile(manifestPath, lines);
    83	    }
    84	  }
    85	
    86	  // Install default transcription config if missing
    87	  const transcriptionConfigPath = path.join(resolvedRoot, "config/transcription.json");
    88	  try {
    89	    await fs.access(transcriptionConfigPath);
    90	  } catch (_e) {
    91	    // Config absent (fs.access throws ENOENT) — install the default. The
    92	    // error carries no actionable info; absence is the normal install path.
    93	    await fs.mkdir(path.join(resolvedRoot, "config"), { recursive: true });
    94	    await fs.writeFile(
    95	      transcriptionConfigPath,
    96	      JSON.stringify({ service: "voxtral" }, null, 2) + "\n"
    97	    );
    98	  }
    99	
   100	  // Always write .gitattributes (LFS rules for binary files)
   101	  const gitattributes = `# Audio files (voice memos, recordings)
   102	*.m4a filter=lfs diff=lfs merge=lfs -text
   103	*.webm filter=lfs diff=lfs merge=lfs -text
   104	*.wav filter=lfs diff=lfs merge=lfs -text
   105	*.mp3 filter=lfs diff=lfs merge=lfs -text
   106	*.ogg filter=lfs diff=lfs merge=lfs -text
   107	
   108	# Images
   109	*.jpg filter=lfs diff=lfs merge=lfs -text
   110	*.jpeg filter=lfs diff=lfs merge=lfs -text
   111	*.png filter=lfs diff=lfs merge=lfs -text
   112	*.heic filter=lfs diff=lfs merge=lfs -text
   113	
   114	# Frozen page captures
   115	*.frozen filter=lfs diff=lfs merge=lfs -text
   116	`;
   117	  await fs.writeFile(path.join(resolvedRoot, ".gitattributes"), gitattributes);
   118	
   119	  // Always write .gitignore (keep in sync with cb version)
   120	  const gitignore = `# Callback Box .gitignore
   121	# Lock files
   122	.cb-lock
   123	.cb-reactor.lock
   124	
   125	# Local config (credentials, etc.)
   126	config/connectors/*.secret.*
   127	
   128	# Transient connector state (timestamps, sync tokens — machine-local)
   129	config/connectors/*.state.*
   130	
   131	# Server PID file
   132	.cb-serve.pid
   133	
   134	# Generated agent docs (regenerated by cb init/reactor)
   135	.callback-box/
   136	docs/generated/
   137	
   138	# Schedule state (machine-local)
   139	config/schedules/.state/
   140	
   141	# Trick dependencies (installed by agent)
   142	tricks/node_modules/
   143	
   144	# Chat file uploads (transient, swept by cb wakeup housekeeping)
   145	tmp/
   146	
   147	# Temporary files
   148	*.tmp
   149	*.swp
   150	*~
   151	
   152	# cb-assets (managed by cb attachments init-gitignore)
   153	# Assets inside .attach/ scopes are tracked via per-dir manifest.json
   154	# (size + sha256), not committed directly. See docs/asset-manifests.md.
   155	**/*.attach/**/*.jpg
   156	**/*.attach/**/*.jpeg
   157	**/*.attach/**/*.png
   158	**/*.attach/**/*.webp
   159	**/*.attach/**/*.avif
   160	**/*.attach/**/*.heic
   161	**/*.attach/**/*.tif
   162	**/*.attach/**/*.tiff
   163	**/*.attach/**/*.gif
   164	**/*.attach/**/*.webm
   165	**/*.attach/**/*.mp3
   166	**/*.attach/**/*.m4a
   167	**/*.attach/**/*.wav
   168	**/*.attach/**/*.pdf
   169	**/*.attach/**/*.mp4
   170	**/*.attach/**/*.mov
   171	`;
   172	  await fs.writeFile(path.join(resolvedRoot, ".gitignore"), gitignore);
   173	
   174	  // Install tricks types.d.ts and CLAUDE.md if missing
   175	  await installTricksFiles(resolvedRoot);
   176	
   177	  // Install schemas guide CLAUDE.md if missing
   178	  await installSchemasGuide(resolvedRoot);
   179	
   180	  // Install views CLAUDE.md if missing
   181	  await installViewsGuide(resolvedRoot);
   182	
   183	  // Initialize git repo (only on fresh init) — don't commit yet;
   184	  // the init command installs more files (schedules, procedures, etc.)
   185	  // after this returns and commits everything together.
   186	  if (!options.skipGit && !isUpdate) {
   187	    const isExistingRepo = await isRepo(resolvedRoot);
   188	    if (!isExistingRepo) {
   189	      await initRepo(resolvedRoot, options.branch ?? "main");
   190	    }
   191	  }
   192	
   193	  return { isUpdate };
   194	}
   195	
   196	/**
   197	 * Ensure all standard directories exist.
   198	 *
   199	 * @param boxRoot - The box root directory
   200	 */
   201	export async function ensureDirectories(boxRoot: string): Promise<void> {
   202	  const dirs = Object.values(BOX_DIRS);
   203	
   204	  for (const dir of dirs) {
   205	    const fullPath = boxPath(boxRoot, dir);
   206	    await fs.mkdir(fullPath, { recursive: true });
   207	
   208	    // Create .gitkeep to preserve empty directories
   209	    const gitkeep = path.join(fullPath, ".gitkeep");
   210	    try {
   211	      await fs.access(gitkeep);
   212	    } catch (_e) {
   213	      // No .gitkeep yet (fs.access throws ENOENT) — create it. The error
   214	      // carries no actionable info; absence is the normal create path.
   215	      await fs.writeFile(gitkeep, "");
   216	    }
   217	  }
   218	}
   219	
   220	/**
   221	 * Check if a directory is a valid callback box.
   222	 *
   223	 * @param boxRoot - Directory to check
   224	 * @returns Whether it's a valid box
   225	 */
   226	export async function isValidBox(boxRoot: string): Promise<boolean> {
   227	  const markerPath = path.join(boxRoot, BOX_MARKER);
   228	  try {
   229	    await fs.access(markerPath);
   230	    return true;
   231	  } catch (_e) {
   232	    // No marker file (fs.access throws ENOENT) — that is precisely what
   233	    // "not a valid box" means. The error carries no actionable info.
   234	    return false;
   235	  }
   236	}
   237	
   238	/**
   239	 * Get box metadata from the marker file.
   240	 *
   241	 * @param boxRoot - The box root directory
   242	 * @returns Box metadata or null if not a valid box
   243	 */
   244	export async function getBoxMetadata(
   245	  boxRoot: string
   246	): Promise<{ version: string; created: string } | null> {
   247	  const markerPath = path.join(boxRoot, BOX_MARKER);
   248	  try {
   249	    const content = await fs.readFile(markerPath, "utf-8");
   250	    return JSON.parse(content) as { version: string; created: string };
   251	  } catch (e) {
   252	    // Missing marker is the normal "not a box" case; a malformed marker is
   253	    // worth surfacing. Either way we report no metadata, but log so a
   254	    // corrupt marker doesn't vanish silently.
   255	    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
   256	      console.warn(`Could not read box marker at ${markerPath}:`, e);
   257	    }
   258	    return null;
   259	  }
   260	}
   261	
   262	// Default-card installers (procedures, guides, personality, landmark,
   263	// briefing, scheduled scripts) live in ./box-defaults and are re-exported
   264	// here so `cb init` and other callers can keep importing them from "./box".
   265	export {
   266	  installProcedures,
   267	  installGuides,
   268	  installPersonality,
   269	  installRootLandmark,
   270	  installBriefing,
   271	  installSchedules,
   272	} from "./box-defaults.js";
   273	
   274	/**
   275	 * Ensure `.claude/memory/` exists in the box and symlink it from
   276	 * `~/.claude/projects/<slug>/memory` so Claude Code's auto-memory
   277	 * is stored inside the git-tracked project directory.
   278	 *
   279	 * Claude Code derives the project slug by replacing `/` with `-`
   280	 * in the absolute path. We compute the same slug and create a

exec
/opt/homebrew/bin/bash -lc 'nl -ba callback-box/src/cli/commands/migrate.ts 2>/dev/null || true' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * `cb migrate` — apply pending data migrations to the box.
     3	 *
     4	 * Compares the box's `config/migrations.jsonl` against the canonical
     5	 * `MIGRATIONS` list in `src/core/migrations.ts`. Runs any pending
     6	 * migrations in order, appending a manifest entry after each success.
     7	 *
     8	 * No auto-commit: the migrators leave their changes (plus the manifest
     9	 * update) in the working tree. The user reviews and commits, normally
    10	 * with `git commit -m "Apply migration X"`.
    11	 */
    12	
    13	import * as fs from "node:fs/promises";
    14	import * as path from "node:path";
    15	import { spawn } from "node:child_process";
    16	import { Command } from "commander";
    17	import { requireBoxRoot } from "../lib/paths.js";
    18	import {
    19	  MIGRATIONS,
    20	  MANIFEST_PATH,
    21	  type Migration,
    22	  type ManifestEntry,
    23	} from "../../core/migrations.js";
    24	import { PACKAGE_ROOT } from "../../lib/package-root.js";
    25	
    26	const CALLBACK_BOX_ROOT = PACKAGE_ROOT;
    27	
    28	class ManifestReadError extends Error {
    29	  readonly manifestPath: string;
    30	  constructor(manifestPath: string, cause: unknown) {
    31	    super(`failed to read migration manifest: ${manifestPath}`, { cause });
    32	    this.name = "ManifestReadError";
    33	    this.manifestPath = manifestPath;
    34	  }
    35	}
    36	
    37	async function readManifest(boxRoot: string): Promise<ManifestEntry[] | null> {
    38	  const abs = path.join(boxRoot, MANIFEST_PATH);
    39	  try {
    40	    const text = await fs.readFile(abs, "utf-8");
    41	    const entries: ManifestEntry[] = [];
    42	    for (const line of text.split("\n")) {
    43	      const trimmed = line.trim();
    44	      if (trimmed === "") continue;
    45	      entries.push(JSON.parse(trimmed) as ManifestEntry);
    46	    }
    47	    return entries;
    48	  } catch (e) {
    49	    const err = e as NodeJS.ErrnoException;
    50	    if (err.code === "ENOENT") return null;
    51	    throw new ManifestReadError(abs, e);
    52	  }
    53	}
    54	
    55	async function appendManifestEntry(boxRoot: string, entry: ManifestEntry): Promise<void> {
    56	  const abs = path.join(boxRoot, MANIFEST_PATH);
    57	  await fs.mkdir(path.dirname(abs), { recursive: true });
    58	  await fs.appendFile(abs, `${JSON.stringify(entry)}\n`);
    59	}
    60	
    61	async function writeManifest(boxRoot: string, entries: ManifestEntry[]): Promise<void> {
    62	  const abs = path.join(boxRoot, MANIFEST_PATH);
    63	  await fs.mkdir(path.dirname(abs), { recursive: true });
    64	  const text = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length > 0 ? "\n" : "");
    65	  await fs.writeFile(abs, text);
    66	}
    67	
    68	function computePending(applied: ManifestEntry[]): Migration[] {
    69	  const seen = new Set(applied.map((e) => e.name));
    70	  return MIGRATIONS.filter((m) => !seen.has(m.name));
    71	}
    72	
    73	function runScript(args: { script: string; boxRoot: string }): Promise<number> {
    74	  return new Promise((resolve, reject) => {
    75	    const scriptPath = path.join(CALLBACK_BOX_ROOT, args.script);
    76	    const child = spawn(
    77	      "npx",
    78	      ["tsx", scriptPath, args.boxRoot, "--apply"],
    79	      { cwd: CALLBACK_BOX_ROOT, stdio: "inherit" }
    80	    );
    81	    child.on("error", reject);
    82	    child.on("close", (code) => resolve(code ?? 1));
    83	  });
    84	}
    85	
    86	function formatStatus(applied: ManifestEntry[], pending: Migration[]): string {
    87	  const lines: string[] = [];
    88	  lines.push(`Applied (${String(applied.length)}):`);
    89	  for (const e of applied) {
    90	    lines.push(`  ✓ ${e.name}  (${e["applied-at"]})`);
    91	  }
    92	  if (applied.length === 0) lines.push("  (none)");
    93	  lines.push("");
    94	  lines.push(`Pending (${String(pending.length)}):`);
    95	  for (const m of pending) {
    96	    lines.push(`  • ${m.name}`);
    97	  }
    98	  if (pending.length === 0) lines.push("  (none — manifest is up to date)");
    99	  return lines.join("\n");
   100	}
   101	
   102	interface MigrateOptions {
   103	  apply?: boolean;
   104	  status?: boolean;
   105	  markAllApplied?: boolean;
   106	}
   107	
   108	export const migrateCommand = new Command("migrate")
   109	  .description("Apply pending data migrations to this box")
   110	  .option("--apply", "Run all pending migrations in order")
   111	  .option("--status", "Show applied + pending lists (default when no flag given)")
   112	  .option("--mark-all-applied", "Seed the manifest as if every known migration ran. Use only for legacy boxes that were already fully migrated before this command existed; new boxes get their manifest seeded automatically by `cb init`.")
   113	  .action(async (options: MigrateOptions) => {
   114	    const boxRoot = await requireBoxRoot();
   115	
   116	    if (options.markAllApplied) {
   117	      const existing = await readManifest(boxRoot);
   118	      if (existing !== null && existing.length > 0) {
   119	        console.error(
   120	          `Manifest already exists at ${MANIFEST_PATH} with ${String(existing.length)} entries; --mark-all-applied refuses to overwrite. Delete the file if you really want to reseed.`,
   121	        );
   122	        process.exit(1);
   123	      }
   124	      const now = new Date().toISOString();
   125	      const entries: ManifestEntry[] = MIGRATIONS.map((m) => ({
   126	        name: m.name,
   127	        "applied-at": now,
   128	      }));
   129	      await writeManifest(boxRoot, entries);
   130	      console.log(`Wrote ${String(entries.length)} entries to ${MANIFEST_PATH} (no migrations actually ran).`);
   131	      return;
   132	    }
   133	
   134	    const applied = await readManifest(boxRoot);
   135	    if (applied === null) {
   136	      console.error(
   137	        `No migration manifest at ${MANIFEST_PATH}.\n\nThis box predates the cb migrate command. If it has already had all data migrations applied, seed the manifest with:\n  cb migrate --mark-all-applied\n\nNew boxes (via cb init) get their manifest automatically.`,
   138	      );
   139	      process.exit(1);
   140	    }
   141	    const pending = computePending(applied);
   142	
   143	    if (!options.apply || options.status) {
   144	      console.log(formatStatus(applied, pending));
   145	      return;
   146	    }
   147	
   148	    if (pending.length === 0) {
   149	      console.log("Nothing to do — manifest is up to date.");
   150	      return;
   151	    }
   152	
   153	    console.log(`Running ${String(pending.length)} pending migration(s) in order:\n`);
   154	    // Exit-code convention shared by the harness and every migrator: 2 means
   155	    // the migration ran but some individual cards couldn't be converted (left
   156	    // unchanged) — a soft, per-card failure; 1 (or any other non-zero) means a
   157	    // hard/precondition failure that should stop the sweep. A single malformed
   158	    // card in a large box must not halt the whole migration, so a soft failure
   159	    // records the migration as applied and continues; the unconverted cards are
   160	    // printed above and surfaced by `cb validate` for manual cleanup.
   161	    const softFailures: string[] = [];
   162	    for (const m of pending) {
   163	      console.log(`=== ${m.name} (${m.script}) ===`);
   164	      const code = await runScript({ script: m.script, boxRoot });
   165	      if (code !== 0 && code !== 2) {
   166	        console.error(`\nMigration "${m.name}" failed hard (exit code ${String(code)}). Manifest not updated for this entry. Subsequent migrations not run.`);
   167	        process.exit(code);
   168	      }
   169	      await appendManifestEntry(boxRoot, { name: m.name, "applied-at": new Date().toISOString() });
   170	      if (code === 2) {
   171	        softFailures.push(m.name);
   172	        console.log(`⚠ ${m.name} applied with per-card failures (see above); continuing.\n`);
   173	      } else {
   174	        console.log(`✓ ${m.name} applied and recorded.\n`);
   175	      }
   176	    }
   177	    if (softFailures.length > 0) {
   178	      console.log(
   179	        `All pending migrations ran. ${String(softFailures.length)} had per-card failures (some cards left unconverted): ${softFailures.join(", ")}.\nRun \`cb validate\` to see the affected cards.`,
   180	      );
   181	    } else {
   182	      console.log("All pending migrations applied.");
   183	    }
   184	  });

exec
/opt/homebrew/bin/bash -lc "rg -n \"MIGRATIONS|migrate|Migration|scripts/migrate|cb init|init\" callback-box/src/core/box.ts callback-box/src/cli/commands callback-box/src/core callback-box/scripts/migrate -g '"'!*.md'"'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/src/core/box.ts:10:import { initRepo, isRepo } from "../cli/lib/git.js";
callback-box/src/core/box.ts:11:import { MIGRATIONS } from "./migrations.js";
callback-box/src/core/box.ts:19:  /** Skip git initialization */
callback-box/src/core/box.ts:26:  /** Whether this was a fresh init or an update of an existing box */
callback-box/src/core/box.ts:33: * On a fresh init: creates directories, marker, .gitignore, git repo, initial commit.
callback-box/src/core/box.ts:36: * @param boxRoot - Directory to initialize (will be created if needed)
callback-box/src/core/box.ts:39:export async function initBox(boxRoot: string, options?: InitOptions): Promise<InitResult> {
callback-box/src/core/box.ts:46:  // Check if already initialized
callback-box/src/core/box.ts:65:  // it. Future migrations added after init will show up as pending.
callback-box/src/core/box.ts:66:  // Already-initialized boxes never get one auto-created here: an existing
callback-box/src/core/box.ts:68:  // run `cb migrate --mark-all-applied` (or --init) to decide its starting
callback-box/src/core/box.ts:69:  // state. See `src/cli/commands/migrate.ts`.
callback-box/src/core/box.ts:79:      const lines = MIGRATIONS
callback-box/src/core/box.ts:134:# Generated agent docs (regenerated by cb init/reactor)
callback-box/src/core/box.ts:152:# cb-assets (managed by cb attachments init-gitignore)
callback-box/src/core/box.ts:183:  // Initialize git repo (only on fresh init) — don't commit yet;
callback-box/src/core/box.ts:184:  // the init command installs more files (schedules, procedures, etc.)
callback-box/src/core/box.ts:189:      await initRepo(resolvedRoot, options.branch ?? "main");
callback-box/src/core/box.ts:264:// here so `cb init` and other callers can keep importing them from "./box".
callback-box/scripts/migrate/landmark.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/landmark.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/src/core/intake.ts:162: * intake-complete by definition.
callback-box/scripts/migrate/_harness.ts:7: * `runMigration` so all migrators have consistent flags, output, and exit
callback-box/scripts/migrate/_harness.ts:15: *   import { runMigration } from "./_harness.js";
callback-box/scripts/migrate/_harness.ts:20: *   await runMigration({
callback-box/scripts/migrate/_harness.ts:39:export interface MigrationOptions {
callback-box/scripts/migrate/_harness.ts:92:export async function runMigration(opts: MigrationOptions): Promise<void> {
callback-box/scripts/migrate/_harness.ts:98:    const cmd = process.argv[1] ?? "migrate";
callback-box/scripts/migrate/_harness.ts:123:    `Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`,
callback-box/scripts/migrate/bill.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/bill.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/src/cli/commands/chat-audio.ts:95:  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
callback-box/src/cli/commands/validate.ts:27: * Cards under `store/trash/` are by definition orphaned/discarded and
callback-box/scripts/migrate/guide.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/guide.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/src/cli/commands/wakeup-connectors.ts:2: * Step 4 of `cb wakeup`: initialize connectors, resolve the active
callback-box/scripts/migrate/personality.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/personality.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/src/cli/commands/procedure.ts:6: *   cb procedure list            List available procedure definitions
callback-box/src/cli/commands/procedure.ts:55:  .description("List available procedure definitions")
callback-box/scripts/migrate/misc.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/misc.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/src/cli/commands/scheduler-helpers.ts:57:    crlfDelay: Infinity,
callback-box/src/cli/commands/index.ts:7:export { initCommand } from "./init.js";
callback-box/src/cli/commands/index.ts:8:export { migrateCommand } from "./migrate.js";
callback-box/src/cli/commands/attachments.ts:7: *   cb attachments migrate        # write manifests for every asset in .attach/
callback-box/src/cli/commands/attachments.ts:26:  .command("migrate")
callback-box/src/cli/commands/attachments.ts:28:  .action(async () => dispatch("migrate"));
callback-box/src/cli/commands/attachments.ts:42:  .description("Migration step: git rm --cached every asset covered by a manifest. Idempotent.")
callback-box/src/cli/commands/attachments.ts:46:  .command("init-gitignore")
callback-box/src/cli/commands/attachments.ts:48:  .action(async () => dispatch("init-gitignore"));
callback-box/scripts/migrate/chat-thread.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/chat-thread.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/src/core/init-rules.ts:7: * Called from `cb init`. Not a standalone CLI command — invoke `cb init`
callback-box/src/core/init-rules.ts:63: * Called by `cb init`.
callback-box/src/cli/commands/init.ts:2: * cb init - Initialize a new callback box
callback-box/src/cli/commands/init.ts:4: * When you change what `cb init` creates, installs, or generates, also
callback-box/src/cli/commands/init.ts:12:import { initBox, installProcedures, installGuides, installSchedules, installPersonality, installBriefing, installRootLandmark, symlinkClaudeMemory } from "../../core/box.js";
callback-box/src/cli/commands/init.ts:14:import { generateRules } from "../../core/init-rules.js";
callback-box/src/cli/commands/init.ts:19:export const initCommand = new Command("init")
callback-box/src/cli/commands/init.ts:21:  .argument("[path]", "Path to initialize", ".")
callback-box/src/cli/commands/init.ts:22:  .option("--skip-git", "Skip git initialization")
callback-box/src/cli/commands/init.ts:27:      const { isUpdate } = await initBox(targetPath, {
callback-box/src/cli/commands/init.ts:40:          console.log("Git repository initialized with initial commit.");
callback-box/src/cli/commands/init.ts:124:      // `cb init` after switching cb sources (monorepo migration, new
callback-box/src/cli/commands/init.ts:142:      // on fresh init — initBox() only creates the git repo without committing.
callback-box/src/cli/commands/init.ts:149:            "Created-By": "cb init",
callback-box/scripts/migrate/doc-sheet.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/doc-sheet.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/src/core/agent-guide/behavior.ts:15:    "- This guide and `docs/generated/` are code-generated by `cb init`. If docs seem stale, re-run `cb init` to regenerate.",
callback-box/src/core/agent-guide/behavior.ts:30:    "| `Triggered-By: cb procedure` | What command/system initiated this work |",
callback-box/src/core/install-validation-hooks.ts:48:# Regenerate via \`cb init\` if you delete this file.
callback-box/src/core/install-validation-hooks.ts:167:  // future `git init`.
callback-box/src/core/chat-session-history.ts:9: *   v1 (legacy): { "sessionIds": ["abc-123", ...], "migrated": true }
callback-box/src/core/chat-session-history.ts:10: *   v2 (current): { "sessions": [{ "id": "abc-123", "contextDir": "store/recipes" }, ...], "migrated": true }
callback-box/src/core/chat-session-history.ts:15: * The `migrated` flag gates a one-shot backfill that scans existing
callback-box/src/core/chat-session-history.ts:46:  migrated: boolean;
callback-box/src/core/chat-session-history.ts:90:      migrated?: unknown;
callback-box/src/core/chat-session-history.ts:103:    return { sessions, migrated: parsed.migrated === true };
callback-box/src/core/chat-session-history.ts:155:  const file = (await readHistoryFile(boxRoot)) ?? { sessions: [], migrated: false };
callback-box/src/core/chat-session-history.ts:279:  const file = (await readHistoryFile(boxRoot)) ?? { sessions: [], migrated: false };
callback-box/src/core/chat-session-history.ts:351:  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
callback-box/src/core/chat-session-history.ts:388: * file, then sets `migrated: true` so it never runs again.
callback-box/src/core/chat-session-history.ts:394:  const file = (await readHistoryFile(boxRoot)) ?? { sessions: [], migrated: false };
callback-box/src/core/chat-session-history.ts:395:  if (file.migrated) return;
callback-box/src/core/chat-session-history.ts:413:  file.migrated = true;
callback-box/src/core/chat-voice-doc.ts:38:<speech voice="onyx">Stand by. Launching sequence initiated.</speech>
callback-box/scripts/migrate/memo.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/memo.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/src/core/generate-docs-procedure-guide.ts:26:Procedure definitions live in \`config/procedures/\`. Each run creates a tracking card in \`procedure/runs/<name>_<timestamp>/\`. Run dirs are a recent cache, not an archive: a run where every step skips is removed at completion, and finished runs get an \`expires\` stamp (30d completed / 90d failed, or the procedure card's \`run-expiry\`/\`failed-run-expiry\` override) that \`cb procedure gc\` enforces daily. Git history retains every committed run. To pin a specific run, set \`expires: never\` on its run card.
callback-box/src/core/generate-docs-procedure-guide.ts:173:## System Procedures and Migration
callback-box/src/core/generate-docs-procedure-guide.ts:175:Procedure cards in \`config/procedures/\` are installed by \`cb init\` from built-in templates. If you edit a system procedure, your changes are preserved:
callback-box/src/core/generate-docs-procedure-guide.ts:177:- **\`cb init\` on a fresh box**: Templates are copied directly.
callback-box/src/core/generate-docs-procedure-guide.ts:178:- **\`cb init\` on an existing box (unchanged procedures)**: Templates are updated in place.
callback-box/src/core/generate-docs-procedure-guide.ts:179:- **\`cb init\` on an existing box (modified procedures)**: The new template is parked under \`config/_template-updates/procedures/<name>.procedure.card\` so you can diff and merge manually. The active file at \`config/procedures/<name>.procedure.card\` is left untouched.
callback-box/src/core/generate-docs-procedure-guide.ts:188:After merging, delete the file under \`config/_template-updates/procedures/\`. The next \`cb init\` will see your merged version as the current copy.
callback-box/src/cli/commands/migrate.ts:2: * `cb migrate` — apply pending data migrations to the box.
callback-box/src/cli/commands/migrate.ts:5: * `MIGRATIONS` list in `src/core/migrations.ts`. Runs any pending
callback-box/src/cli/commands/migrate.ts:19:  MIGRATIONS,
callback-box/src/cli/commands/migrate.ts:21:  type Migration,
callback-box/src/cli/commands/migrate.ts:68:function computePending(applied: ManifestEntry[]): Migration[] {
callback-box/src/cli/commands/migrate.ts:70:  return MIGRATIONS.filter((m) => !seen.has(m.name));
callback-box/src/cli/commands/migrate.ts:86:function formatStatus(applied: ManifestEntry[], pending: Migration[]): string {
callback-box/src/cli/commands/migrate.ts:108:export const migrateCommand = new Command("migrate")
callback-box/src/cli/commands/migrate.ts:112:  .option("--mark-all-applied", "Seed the manifest as if every known migration ran. Use only for legacy boxes that were already fully migrated before this command existed; new boxes get their manifest seeded automatically by `cb init`.")
callback-box/src/cli/commands/migrate.ts:125:      const entries: ManifestEntry[] = MIGRATIONS.map((m) => ({
callback-box/src/cli/commands/migrate.ts:137:        `No migration manifest at ${MANIFEST_PATH}.\n\nThis box predates the cb migrate command. If it has already had all data migrations applied, seed the manifest with:\n  cb migrate --mark-all-applied\n\nNew boxes (via cb init) get their manifest automatically.`,
callback-box/src/cli/commands/migrate.ts:166:        console.error(`\nMigration "${m.name}" failed hard (exit code ${String(code)}). Manifest not updated for this entry. Subsequent migrations not run.`);
callback-box/src/core/maps/precheck-listing.ts:33: *   of the cb-init skeleton (`store/`, `box/`, `config/`, ...) and is
callback-box/src/core/external-ref.ts:156: * signal) plus `size`/`mtime` (informational). One definition of "the file's
callback-box/scripts/migrate/webpage-card.ts:28: *   pnpm exec tsx scripts/migrate/webpage-card.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/webpage-card.ts:29: *   pnpm exec tsx scripts/migrate/webpage-card.ts <boxRoot> --apply
callback-box/scripts/migrate/webpage-card.ts:36:import { runMigration, type ConvertOutcome } from "./_harness.js";
callback-box/scripts/migrate/webpage-card.ts:93: * source URL + captured date out and strip that line, so those cards migrate
callback-box/scripts/migrate/webpage-card.ts:197:  await runMigration({
callback-box/src/core/agent-guide/cards.ts:19:  lines.push("New card types can be defined in `config/schemas/` using `cardSchema()` (YAML frontmatter + markdown body) + Zod — see `config/schemas/CLAUDE.md` for how. Run `cb init` after adding a schema to generate rules and docs.");
callback-box/scripts/migrate/scheduled-script.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/scheduled-script.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/src/core/maps/precheck-ignore.ts:42: * Standard cb-init skeleton paths whose contents are pure scaffolding —
callback-box/src/core/asset-manifest-scan.ts:5: *   - `cb attachments migrate` (claim every binary into a manifest)
callback-box/scripts/migrate/procedure-run.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/procedure-run.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/src/core/box-templates.ts:2: * Static scaffold files installed into a box on init.
callback-box/src/core/box-templates.ts:10: * init` can run repeatedly without clobbering user edits.
callback-box/src/core/box-templates.ts:136:  // ... schema definition
callback-box/src/core/box-templates.ts:142:Run \`cb init\` to regenerate rules and documentation:
callback-box/src/core/box-templates.ts:145:cb init .
callback-box/src/core/chat-session-options.ts:45:  initialSessionId?: string;
callback-box/src/core/chat-session-options.ts:50:   * tests where the box isn't a fully-initialized callback-box, and in
callback-box/src/core/usage.ts:132:  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
callback-box/scripts/migrate/question.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/question.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/src/core/views-doc-files.ts:100:adapters** instead — \`adapterFetch(adapter, {path, ...init})\` hits
callback-box/src/core/boxes-config.ts:10: * `~/.config/cb/scheduler.json`. We migrate it transparently on first
callback-box/src/core/migrations.ts:4: * `cb migrate` reads this and the per-box manifest at
callback-box/src/core/migrations.ts:13: * data loss (see scripts/migrate/_warnings.ts and the author guide
callback-box/src/core/migrations.ts:17:export interface Migration {
callback-box/src/core/migrations.ts:24:export const MIGRATIONS: ReadonlyArray<Migration> = [
callback-box/src/core/migrations.ts:25:  { name: "attachments",       script: "scripts/migrate/attachments.ts" },
callback-box/src/core/migrations.ts:26:  { name: "card-frontmatter",  script: "scripts/migrate/card-frontmatter.ts" },
callback-box/src/core/migrations.ts:27:  { name: "email-thread",      script: "scripts/migrate/email-thread.ts" },
callback-box/src/core/migrations.ts:28:  { name: "email-message",     script: "scripts/migrate/email-message.ts" },
callback-box/src/core/migrations.ts:29:  { name: "briefing",          script: "scripts/migrate/briefing.ts" },
callback-box/src/core/migrations.ts:30:  { name: "doc-sheet",         script: "scripts/migrate/doc-sheet.ts" },
callback-box/src/core/migrations.ts:31:  { name: "file",              script: "scripts/migrate/file.ts" },
callback-box/src/core/migrations.ts:32:  { name: "image",             script: "scripts/migrate/image.ts" },
callback-box/src/core/migrations.ts:33:  { name: "audio",             script: "scripts/migrate/audio.ts" },
callback-box/src/core/migrations.ts:34:  { name: "record-person",     script: "scripts/migrate/record-person.ts" },
callback-box/src/core/migrations.ts:35:  { name: "memo",              script: "scripts/migrate/memo.ts" },
callback-box/src/core/migrations.ts:36:  { name: "misc",              script: "scripts/migrate/misc.ts" },
callback-box/src/core/migrations.ts:37:  { name: "jobs",              script: "scripts/migrate/jobs.ts" },
callback-box/src/core/migrations.ts:38:  { name: "personality",       script: "scripts/migrate/personality.ts" },
callback-box/src/core/migrations.ts:39:  { name: "scheduled-script",  script: "scripts/migrate/scheduled-script.ts" },
callback-box/src/core/migrations.ts:40:  { name: "question",          script: "scripts/migrate/question.ts" },
callback-box/src/core/migrations.ts:41:  { name: "chat-thread",       script: "scripts/migrate/chat-thread.ts" },
callback-box/src/core/migrations.ts:42:  { name: "doc-to-gdoc",       script: "scripts/migrate/doc-to-gdoc.ts" },
callback-box/src/core/migrations.ts:43:  { name: "strip-type-field",  script: "scripts/migrate/strip-type-field.ts" },
callback-box/src/core/migrations.ts:44:  { name: "repair-refs",       script: "scripts/migrate/repair-refs.ts" },
callback-box/src/core/migrations.ts:45:  { name: "asset-marker",      script: "scripts/migrate/asset-marker.ts" },
callback-box/src/core/migrations.ts:46:  { name: "webpage-card",      script: "scripts/migrate/webpage-card.ts" },
callback-box/src/core/migrations.ts:47:  { name: "landmark",          script: "scripts/migrate/landmark.ts" },
callback-box/src/core/migrations.ts:48:  { name: "recipe",            script: "scripts/migrate/recipe.ts" },
callback-box/src/core/migrations.ts:49:  { name: "procedure-run",     script: "scripts/migrate/procedure-run.ts" },
callback-box/src/core/migrations.ts:50:  { name: "procedure",         script: "scripts/migrate/procedure.ts" },
callback-box/src/core/migrations.ts:51:  { name: "guide",             script: "scripts/migrate/guide.ts" },
callback-box/src/core/migrations.ts:52:  { name: "capture-session",   script: "scripts/migrate/capture-session.ts" },
callback-box/src/core/migrations.ts:53:  { name: "delete-deprecated-cards", script: "scripts/migrate/delete-deprecated-cards.ts" },
callback-box/src/core/migrations.ts:54:  { name: "bill",              script: "scripts/migrate/bill.ts" },
callback-box/src/core/install-template-file.ts:186: * `config/_template-updates/` from accumulating cruft indefinitely.
callback-box/src/core/agent-stream.ts:96:    if (msg.type === "system" && msg.subtype === "init" && assignedSessionId === null) {
callback-box/scripts/migrate/asset-marker.ts:7: *   # cb-attach-binaries (managed by cb attachments init-gitignore)
callback-box/scripts/migrate/asset-marker.ts:11: *   # cb-assets (managed by cb attachments init-gitignore)
callback-box/scripts/migrate/asset-marker.ts:18: *   pnpm exec tsx scripts/migrate/asset-marker.ts <boxRoot>             # dry-run
callback-box/scripts/migrate/asset-marker.ts:19: *   pnpm exec tsx scripts/migrate/asset-marker.ts <boxRoot> --apply
callback-box/scripts/migrate/asset-marker.ts:25:const OLD_MARKER = "# cb-attach-binaries (managed by cb attachments init-gitignore)";
callback-box/scripts/migrate/asset-marker.ts:26:const NEW_MARKER = "# cb-assets (managed by cb attachments init-gitignore)";
callback-box/src/core/chat-session.ts:107:    if (options.initialSessionId !== undefined) {
callback-box/src/core/chat-session.ts:108:      this.sessionId = options.initialSessionId;
callback-box/src/core/chat-session.ts:122:      log("init", `Loaded session: ${this.sessionId}`);
callback-box/src/core/chat-session.ts:124:      log("init", "No saved session, will create on first message");
callback-box/src/core/chat-session.ts:127:      log("init", `Loaded model override: ${this.currentModel}`);
callback-box/src/core/agent-render.ts:95:  if (msg.type === "system" && msg.subtype === "init") {
callback-box/src/core/chat-thread-session.ts:112:      if (msg.subtype !== "init") return null;
callback-box/src/core/chat-thread-session.ts:113:      return { type: "system", subtype: "init", session_id: msg.session_id };
callback-box/src/core/chat-session-registry.ts:57:   * `initialSessionId`, `sessionFile: null`, and `onSessionIdAssigned`
callback-box/src/core/chat-session-registry.ts:112:   * options so the next "new chat" send doesn't pay spawn + initialize
callback-box/src/core/chat-session-registry.ts:189:      initialSessionId: sessionId,
callback-box/src/core/event-bus.ts:109:  const initialRow = maxIdStmt.get() as { maxId: number | null };
callback-box/src/core/event-bus.ts:110:  let highWaterMark = initialRow.maxId ?? 0;
callback-box/scripts/migrate/procedure.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/procedure.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/src/core/chat-session-start.ts:71:  if (ctx.options.initialSessionId === undefined) return null;
callback-box/src/core/chat-session-start.ts:73:    return await getDirectoryForSession(ctx.boxRoot, ctx.options.initialSessionId);
callback-box/src/core/chat-session-start.ts:89:  if (ctx.options.initialSessionId === undefined) return null;
callback-box/scripts/migrate/delete-deprecated-cards.ts:10: * `cb validate` can neither validate nor migrate, so they would block the
callback-box/scripts/migrate/delete-deprecated-cards.ts:18: *   pnpm exec tsx scripts/migrate/delete-deprecated-cards.ts <root>           # dry-run
callback-box/scripts/migrate/delete-deprecated-cards.ts:19: *   pnpm exec tsx scripts/migrate/delete-deprecated-cards.ts <root> --apply
callback-box/scripts/migrate/delete-deprecated-cards.ts:24:import { runMigration } from "./_harness.js";
callback-box/scripts/migrate/delete-deprecated-cards.ts:38:  await runMigration({
callback-box/src/core/chat-session-messages.ts:232:      if (msg.subtype === "init") {
callback-box/src/core/chat-session-messages.ts:235:          subtype: "init",
callback-box/src/core/box.ts:10:import { initRepo, isRepo } from "../cli/lib/git.js";
callback-box/src/core/box.ts:11:import { MIGRATIONS } from "./migrations.js";
callback-box/src/core/box.ts:19:  /** Skip git initialization */
callback-box/src/core/box.ts:26:  /** Whether this was a fresh init or an update of an existing box */
callback-box/src/core/box.ts:33: * On a fresh init: creates directories, marker, .gitignore, git repo, initial commit.
callback-box/src/core/box.ts:36: * @param boxRoot - Directory to initialize (will be created if needed)
callback-box/src/core/box.ts:39:export async function initBox(boxRoot: string, options?: InitOptions): Promise<InitResult> {
callback-box/src/core/box.ts:46:  // Check if already initialized
callback-box/src/core/box.ts:65:  // it. Future migrations added after init will show up as pending.
callback-box/src/core/box.ts:66:  // Already-initialized boxes never get one auto-created here: an existing
callback-box/src/core/box.ts:68:  // run `cb migrate --mark-all-applied` (or --init) to decide its starting
callback-box/src/core/box.ts:69:  // state. See `src/cli/commands/migrate.ts`.
callback-box/src/core/box.ts:79:      const lines = MIGRATIONS
callback-box/src/core/box.ts:134:# Generated agent docs (regenerated by cb init/reactor)
callback-box/src/core/box.ts:152:# cb-assets (managed by cb attachments init-gitignore)
callback-box/src/core/box.ts:183:  // Initialize git repo (only on fresh init) — don't commit yet;
callback-box/src/core/box.ts:184:  // the init command installs more files (schedules, procedures, etc.)
callback-box/src/core/box.ts:189:      await initRepo(resolvedRoot, options.branch ?? "main");
callback-box/src/core/box.ts:264:// here so `cb init` and other callers can keep importing them from "./box".
callback-box/src/core/command-runner.ts:21: * Argument definition for a command.
callback-box/src/core/command-runner.ts:23:export interface ArgDefinition {
callback-box/src/core/command-runner.ts:37: * Command definition.
callback-box/src/core/command-runner.ts:39:export interface CommandDefinition {
callback-box/src/core/command-runner.ts:44:  /** Argument definitions */
callback-box/src/core/command-runner.ts:45:  args: ArgDefinition[];
callback-box/src/core/command-runner.ts:73:const registry = new Map<string, CommandDefinition>();
callback-box/src/core/command-runner.ts:78:export function registerCommand(cmd: CommandDefinition): void {
callback-box/src/core/command-runner.ts:88:export function getCommand(name: string): CommandDefinition | undefined {
callback-box/src/core/command-runner.ts:95:export function listCommands(): CommandDefinition[] {
callback-box/src/core/views-doc.ts:109:| \`adapterFetch\` | (adapter, {path, ...init}) => Promise<Response> | Call an external API with the box's key injected server-side |
callback-box/src/core/commands/attachments-gitignore.ts:4: * The `init-gitignore` subcommand appends a managed block to the box's
callback-box/src/core/commands/attachments-gitignore.ts:40:const GITIGNORE_BLOCK_MARKER = "# cb-assets (managed by cb attachments init-gitignore)";
callback-box/src/core/commands/attachments-gitignore.ts:41:/** Older marker the box may have if it was initialized before the rename. */
callback-box/src/core/commands/attachments-gitignore.ts:42:const LEGACY_GITIGNORE_BLOCK_MARKER = "# cb-attach-binaries (managed by cb attachments init-gitignore)";
callback-box/src/core/commands/attachments-gitignore.ts:192: * Migration step: ask git which currently-tracked files would now be ignored
callback-box/src/core/commands/attachments-gitignore.ts:201: * untrack — running this before `cb attachments migrate` would lose the
callback-box/src/core/commands/attachments-gitignore.ts:238:    ctx.writeLine("Run 'cb attachments migrate' first so every binary is tracked.");
callback-box/scripts/migrate/attachments.ts:35: *   pnpm exec tsx scripts/migrate/attachments.ts <boxRoot>             # dry-run
callback-box/scripts/migrate/attachments.ts:36: *   pnpm exec tsx scripts/migrate/attachments.ts <boxRoot> --apply     # execute
callback-box/scripts/migrate/attachments.ts:37: *   pnpm exec tsx scripts/migrate/attachments.ts <boxRoot> --apply --no-commit
callback-box/scripts/migrate/attachments.ts:47:interface MigrationOptions {
callback-box/scripts/migrate/attachments.ts:84:interface MigrationPlan {
callback-box/scripts/migrate/attachments.ts:107:function parseArgs(argv: string[]): MigrationOptions {
callback-box/scripts/migrate/attachments.ts:121:    console.error("Usage: migrate-attachments.ts <boxRoot> [--apply] [--commit]");
callback-box/scripts/migrate/attachments.ts:200:async function buildPlan(boxRoot: string): Promise<MigrationPlan> {
callback-box/scripts/migrate/attachments.ts:201:  const plan: MigrationPlan = {
callback-box/scripts/migrate/attachments.ts:616:  plan: MigrationPlan;
callback-box/scripts/migrate/attachments.ts:714:async function executePlan(boxRoot: string, plan: MigrationPlan): Promise<void> {
callback-box/scripts/migrate/attachments.ts:855:function printPlan(plan: MigrationPlan): void {
callback-box/scripts/migrate/attachments.ts:856:  console.log(`\n=== Migration plan ===`);
callback-box/scripts/migrate/attachments.ts:929:    console.log("\nMigration complete. Review changes and commit when ready.");
callback-box/scripts/migrate/attachments.ts:934:  console.error("Migration failed:", e);
callback-box/scripts/migrate/image.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/image.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/scripts/migrate/email-thread.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/email-thread.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/scripts/migrate/email-message.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/email-message.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/scripts/migrate/jobs.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/jobs.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/scripts/migrate/doc-to-gdoc.ts:12: *   pnpm exec tsx scripts/migrate/doc-to-gdoc.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/doc-to-gdoc.ts:13: *   pnpm exec tsx scripts/migrate/doc-to-gdoc.ts <boxRoot> --apply
callback-box/scripts/migrate/doc-to-gdoc.ts:49:async function migrateFile(absPath: string): Promise<Outcome> {
callback-box/scripts/migrate/doc-to-gdoc.ts:97:    console.error("Usage: migrate-doc-to-gdoc <boxRoot> [--apply]");
callback-box/scripts/migrate/doc-to-gdoc.ts:114:      const o = await migrateFile(f);
callback-box/src/core/procedure/engine-parse.ts:2: * Procedure definition parsing — turns a procedure card's YAML frontmatter
callback-box/src/core/procedure/engine-parse.ts:8:  parseProcedureDefinition,
callback-box/src/core/procedure/engine-parse.ts:14:/** Raised when a procedure card can't be parsed as a valid definition. */
callback-box/src/core/procedure/engine-parse.ts:17:    super(`Invalid procedure definition: ${cardPath}`);
callback-box/src/core/procedure/engine-parse.ts:23: * Parse a procedure definition card into a structured object.
callback-box/src/core/procedure/engine-parse.ts:25:export async function loadProcedureDefinition(
callback-box/src/core/procedure/engine-parse.ts:29:  const def = parseProcedureDefinition(content);
callback-box/scripts/migrate/capture-session.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/capture-session.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/src/core/commands/procedure.ts:75:  description: "List available procedure definitions",
callback-box/scripts/migrate/file.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/file.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/scripts/migrate/repair-refs.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/repair-refs.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/src/core/generate-docs.ts:8: * Called by `cb init` and at the start of `cb reactor`.
callback-box/src/core/generate-docs.ts:32:import { generateRules } from "./init-rules.js";
callback-box/src/core/generate-docs.ts:249:  // just on an explicit `cb init`). Tracker-based, so user-edited guides are
callback-box/src/core/commands/attachments.ts:8: *   - migrate  : claim every asset into its manifest (idempotent first run)
callback-box/src/core/commands/attachments.ts:16: * The gitignore subcommands (init-gitignore, untrack-assets) live in the
callback-box/src/core/commands/attachments.ts:58:    case "migrate":
callback-box/src/core/commands/attachments.ts:68:    case "init-gitignore":
callback-box/src/core/commands/attachments.ts:107: * write of manifests across the box (the safe initial migration step before
callback-box/src/core/commands/attachments.ts:240:  description: "Manifest-aware operations on assets (verify, migrate, overwrite, add)",
callback-box/src/core/commands/attachments.ts:244:      description: "verify | migrate | overwrite | add",
callback-box/scripts/migrate/record-person.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/record-person.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/scripts/migrate/card-frontmatter.ts:18: *   pnpm exec tsx scripts/migrate/card-frontmatter.ts <boxRoot>             # dry-run
callback-box/scripts/migrate/card-frontmatter.ts:19: *   pnpm exec tsx scripts/migrate/card-frontmatter.ts <boxRoot> --apply     # execute
callback-box/scripts/migrate/card-frontmatter.ts:28:interface MigrationPlan {
callback-box/scripts/migrate/card-frontmatter.ts:58:async function planMigration(cardFiles: string[]): Promise<MigrationPlan> {
callback-box/scripts/migrate/card-frontmatter.ts:72:async function applyMigration(toRewrite: string[]): Promise<void> {
callback-box/scripts/migrate/card-frontmatter.ts:85:    console.error("Usage: migrate-card-frontmatter <boxRoot> [--apply]");
callback-box/scripts/migrate/card-frontmatter.ts:90:  const plan = await planMigration(cardFiles);
callback-box/scripts/migrate/card-frontmatter.ts:110:  await applyMigration(plan.toRewrite);
callback-box/src/core/commands/trash.ts:138:    // The initial access() throwing means this card has no attach scope —
callback-box/src/core/commands/index.ts:36:  type CommandDefinition,
callback-box/src/core/commands/index.ts:38:  type ArgDefinition,
callback-box/scripts/migrate/briefing.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/briefing.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/src/core/procedure/engine-types.ts:31:// ─── Types for parsed procedure definitions ───────────────────────────
callback-box/scripts/migrate/recipe.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/recipe.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/src/core/box-defaults.ts:2: * Default-card installers for `cb init`.
callback-box/src/core/box-defaults.ts:25: * string that the `cb init` UI prints. `fresh` and `overwritten` outcomes
callback-box/src/core/box-defaults.ts:57:    // installing rather than fail init, but log so a misconfigured package
callback-box/scripts/migrate/strip-type-field.ts:16: *   pnpm exec tsx scripts/migrate/strip-type-field.ts <boxRoot>           # dry-run
callback-box/scripts/migrate/strip-type-field.ts:17: *   pnpm exec tsx scripts/migrate/strip-type-field.ts <boxRoot> --apply
callback-box/src/core/procedure/engine-run-card.ts:2: * Run-card serialization and mutation — building the initial run card and
callback-box/src/core/procedure/engine-run-card.ts:90: * Build the initial run card (all steps pending).
callback-box/scripts/migrate/audio.ts:5: * removed. Every box is migrated, and `cb init` seeds a full migrations
callback-box/scripts/migrate/audio.ts:7: * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
callback-box/src/core/procedure/dedent.ts:21:  let minIndent = Infinity;
callback-box/src/core/procedure/dedent.ts:30:  if (minIndent === Infinity || minIndent === 0) {
callback-box/src/core/procedure/engine.ts:2: * Procedure engine — executes procedure definitions step by step.
callback-box/src/core/procedure/engine.ts:4: * Loads a procedure definition card, creates a run directory with a run card,
callback-box/src/core/procedure/engine.ts:16:import { loadProcedureDefinition } from "./engine-parse.js";
callback-box/src/core/procedure/engine.ts:34: * Resolve a procedure definition path from a bare name or a path.
callback-box/src/core/procedure/engine.ts:138:    console.warn(`Procedure definition not accessible at ${procedureCardPath}:`, e);
callback-box/src/core/procedure/engine.ts:141:      error: `Procedure definition not found: ${procedureCardPath}`,
callback-box/src/core/procedure/engine.ts:145:  // Parse procedure definition
callback-box/src/core/procedure/engine.ts:146:  const procedure = await loadProcedureDefinition(procedureCardPath);
callback-box/src/core/procedure/engine.ts:178:  // Generate initial run card
callback-box/src/core/procedure/engine.ts:181:  const initialRunCard = buildInitialRunCard({ procedure, procedurePath: relProcedurePath, startedAt: now, ...(options.directive && { directive: options.directive }) });
callback-box/src/core/procedure/engine.ts:182:  await fs.writeFile(runCardPath, initialRunCard);
callback-box/src/core/procedure/engine.ts:251: * List available procedure definitions.
callback-box/src/core/procedure/engine.ts:263:      ctx.writeLine(fmt.dim("No procedure definitions found."));
callback-box/src/core/procedure/engine-phase.ts:4: * locating a step's line range in its definition card.
callback-box/src/core/procedure/engine-phase.ts:246: * Find the line range of a step definition in the procedure card.

exec
/opt/homebrew/bin/bash -lc 'ls callback-box/src/cli/commands && rg -n "migrate" callback-box/src/cli/commands callback-box/src/cli/index.ts' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
answer.ts
assemble-timeline.ts
attachments.ts
boxes.ts
calendar.ts
chat-audio.ts
chat.ts
contains.ts
create.ts
describe-images.ts
drive.ts
extfile.ts
feedback.ts
finalize.ts
finish.ts
google-auth.ts
handle.ts
health.ts
index.ts
init.ts
intake.ts
ls.ts
migrate.ts
move.ts
procedure.ts
prompt.ts
reactor.ts
refresh-maps.ts
render.ts
retro.ts
scan-import.ts
scenario.ts
scheduled.ts
scheduler-helpers.ts
scheduler.ts
search.ts
serve.ts
session-format.ts
session-modes.ts
session-render.ts
session.ts
status.ts
tick-helpers.ts
tick-utils.ts
tick.ts
transcribe-captures.ts
trash.ts
triage.ts
trick.ts
upload.ts
usage.ts
validate.ts
wakeup-connectors.ts
wakeup-steps.ts
wakeup.ts
callback-box/src/cli/index.ts:15:  migrateCommand,
callback-box/src/cli/index.ts:73:program.addCommand(migrateCommand);
callback-box/src/cli/commands/index.ts:8:export { migrateCommand } from "./migrate.js";
callback-box/src/cli/commands/attachments.ts:7: *   cb attachments migrate        # write manifests for every asset in .attach/
callback-box/src/cli/commands/attachments.ts:26:  .command("migrate")
callback-box/src/cli/commands/attachments.ts:28:  .action(async () => dispatch("migrate"));
callback-box/src/cli/commands/migrate.ts:2: * `cb migrate` — apply pending data migrations to the box.
callback-box/src/cli/commands/migrate.ts:108:export const migrateCommand = new Command("migrate")
callback-box/src/cli/commands/migrate.ts:112:  .option("--mark-all-applied", "Seed the manifest as if every known migration ran. Use only for legacy boxes that were already fully migrated before this command existed; new boxes get their manifest seeded automatically by `cb init`.")
callback-box/src/cli/commands/migrate.ts:137:        `No migration manifest at ${MANIFEST_PATH}.\n\nThis box predates the cb migrate command. If it has already had all data migrations applied, seed the manifest with:\n  cb migrate --mark-all-applied\n\nNew boxes (via cb init) get their manifest automatically.`,

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/migrations.ts | sed -n '1,90p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * Canonical ordered list of box data migrations.
     3	 *
     4	 * `cb migrate` reads this and the per-box manifest at
     5	 * `config/migrations.jsonl` to decide what to run. New migrations get
     6	 * appended to the array; never reorder or remove existing entries —
     7	 * the `name` is the manifest key and reordering would change which
     8	 * migrations a box thinks it has applied.
     9	 *
    10	 * Each migration is a script under `scripts/` invoked with the box root
    11	 * and `--apply`. Scripts are expected to be idempotent (safe to re-run
    12	 * if for some reason the manifest is wrong) and noisy about possible
    13	 * data loss (see scripts/migrate/_warnings.ts and the author guide
    14	 * in docs/migrations.md § "Writing a new migration").
    15	 */
    16	
    17	export interface Migration {
    18	  /** Stable key recorded in the box's migrations.jsonl. */
    19	  readonly name: string;
    20	  /** Path to the migrator script, relative to the callback-box repo root. */
    21	  readonly script: string;
    22	}
    23	
    24	export const MIGRATIONS: ReadonlyArray<Migration> = [
    25	  { name: "attachments",       script: "scripts/migrate/attachments.ts" },
    26	  { name: "card-frontmatter",  script: "scripts/migrate/card-frontmatter.ts" },
    27	  { name: "email-thread",      script: "scripts/migrate/email-thread.ts" },
    28	  { name: "email-message",     script: "scripts/migrate/email-message.ts" },
    29	  { name: "briefing",          script: "scripts/migrate/briefing.ts" },
    30	  { name: "doc-sheet",         script: "scripts/migrate/doc-sheet.ts" },
    31	  { name: "file",              script: "scripts/migrate/file.ts" },
    32	  { name: "image",             script: "scripts/migrate/image.ts" },
    33	  { name: "audio",             script: "scripts/migrate/audio.ts" },
    34	  { name: "record-person",     script: "scripts/migrate/record-person.ts" },
    35	  { name: "memo",              script: "scripts/migrate/memo.ts" },
    36	  { name: "misc",              script: "scripts/migrate/misc.ts" },
    37	  { name: "jobs",              script: "scripts/migrate/jobs.ts" },
    38	  { name: "personality",       script: "scripts/migrate/personality.ts" },
    39	  { name: "scheduled-script",  script: "scripts/migrate/scheduled-script.ts" },
    40	  { name: "question",          script: "scripts/migrate/question.ts" },
    41	  { name: "chat-thread",       script: "scripts/migrate/chat-thread.ts" },
    42	  { name: "doc-to-gdoc",       script: "scripts/migrate/doc-to-gdoc.ts" },
    43	  { name: "strip-type-field",  script: "scripts/migrate/strip-type-field.ts" },
    44	  { name: "repair-refs",       script: "scripts/migrate/repair-refs.ts" },
    45	  { name: "asset-marker",      script: "scripts/migrate/asset-marker.ts" },
    46	  { name: "webpage-card",      script: "scripts/migrate/webpage-card.ts" },
    47	  { name: "landmark",          script: "scripts/migrate/landmark.ts" },
    48	  { name: "recipe",            script: "scripts/migrate/recipe.ts" },
    49	  { name: "procedure-run",     script: "scripts/migrate/procedure-run.ts" },
    50	  { name: "procedure",         script: "scripts/migrate/procedure.ts" },
    51	  { name: "guide",             script: "scripts/migrate/guide.ts" },
    52	  { name: "capture-session",   script: "scripts/migrate/capture-session.ts" },
    53	  { name: "delete-deprecated-cards", script: "scripts/migrate/delete-deprecated-cards.ts" },
    54	  { name: "bill",              script: "scripts/migrate/bill.ts" },
    55	];
    56	
    57	export const MANIFEST_PATH = "config/migrations.jsonl";
    58	
    59	export interface ManifestEntry {
    60	  readonly name: string;
    61	  readonly "applied-at": string;
    62	}

exec
/opt/homebrew/bin/bash -lc "git show main:callback-box/src/core/migrations.ts | nl -ba | sed -n '1,90p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-22kdgdMB' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-J1uyKl5Z' (errno=Operation not permitted)
     1	/**
     2	 * Canonical ordered list of box data migrations.
     3	 *
     4	 * `cb migrate` reads this and the per-box manifest at
     5	 * `config/migrations.jsonl` to decide what to run. New migrations get
     6	 * appended to the array; never reorder or remove existing entries —
     7	 * the `name` is the manifest key and reordering would change which
     8	 * migrations a box thinks it has applied.
     9	 *
    10	 * Each migration is a script under `scripts/` invoked with the box root
    11	 * and `--apply`. Scripts are expected to be idempotent (safe to re-run
    12	 * if for some reason the manifest is wrong) and noisy about possible
    13	 * data loss (see scripts/migrate/_warnings.ts and the author guide
    14	 * in docs/migrations.md § "Writing a new migration").
    15	 */
    16	
    17	export interface Migration {
    18	  /** Stable key recorded in the box's migrations.jsonl. */
    19	  readonly name: string;
    20	  /** Path to the migrator script, relative to the callback-box repo root. */
    21	  readonly script: string;
    22	}
    23	
    24	export const MIGRATIONS: ReadonlyArray<Migration> = [
    25	  { name: "attachments",       script: "scripts/migrate/attachments.ts" },
    26	  { name: "card-frontmatter",  script: "scripts/migrate/card-frontmatter.ts" },
    27	  { name: "email-thread",      script: "scripts/migrate/email-thread.ts" },
    28	  { name: "email-message",     script: "scripts/migrate/email-message.ts" },
    29	  { name: "briefing",          script: "scripts/migrate/briefing.ts" },
    30	  { name: "doc-sheet",         script: "scripts/migrate/doc-sheet.ts" },
    31	  { name: "file",              script: "scripts/migrate/file.ts" },
    32	  { name: "image",             script: "scripts/migrate/image.ts" },
    33	  { name: "audio",             script: "scripts/migrate/audio.ts" },
    34	  { name: "record-person",     script: "scripts/migrate/record-person.ts" },
    35	  { name: "memo",              script: "scripts/migrate/memo.ts" },
    36	  { name: "misc",              script: "scripts/migrate/misc.ts" },
    37	  { name: "jobs",              script: "scripts/migrate/jobs.ts" },
    38	  { name: "personality",       script: "scripts/migrate/personality.ts" },
    39	  { name: "scheduled-script",  script: "scripts/migrate/scheduled-script.ts" },
    40	  { name: "question",          script: "scripts/migrate/question.ts" },
    41	  { name: "chat-thread",       script: "scripts/migrate/chat-thread.ts" },
    42	  { name: "doc-to-gdoc",       script: "scripts/migrate/doc-to-gdoc.ts" },
    43	  { name: "strip-type-field",  script: "scripts/migrate/strip-type-field.ts" },
    44	  { name: "repair-refs",       script: "scripts/migrate/repair-refs.ts" },
    45	  { name: "asset-marker",      script: "scripts/migrate/asset-marker.ts" },
    46	  { name: "webpage-card",      script: "scripts/migrate/webpage-card.ts" },
    47	  { name: "landmark",          script: "scripts/migrate/landmark.ts" },
    48	  { name: "recipe",            script: "scripts/migrate/recipe.ts" },
    49	  { name: "procedure-run",     script: "scripts/migrate/procedure-run.ts" },
    50	  { name: "procedure",         script: "scripts/migrate/procedure.ts" },
    51	  { name: "guide",             script: "scripts/migrate/guide.ts" },
    52	  { name: "capture-session",   script: "scripts/migrate/capture-session.ts" },
    53	  { name: "delete-deprecated-cards", script: "scripts/migrate/delete-deprecated-cards.ts" },
    54	  { name: "bill",              script: "scripts/migrate/bill.ts" },
    55	];
    56	
    57	export const MANIFEST_PATH = "config/migrations.jsonl";
    58	
    59	export interface ManifestEntry {
    60	  readonly name: string;
    61	  readonly "applied-at": string;
    62	}

exec
/opt/homebrew/bin/bash -lc "for f in callback-box/scripts/migrate/image.ts callback-box/scripts/migrate/memo.ts callback-box/scripts/migrate/delete-deprecated-cards.ts callback-box/scripts/migrate/card-frontmatter.ts; do printf '\\n== %s ==\\n' \""'$f"; nl -ba "$f" | sed -n '"'1,80p'; done" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:

== callback-box/scripts/migrate/image.ts ==
     1	/**
     2	 * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
     3	 *
     4	 * This XML→frontmatter migration ran before the `cardworks` XML library was
     5	 * removed. Every box is migrated, and `cb init` seeds a full migrations
     6	 * manifest on new boxes, so this never runs. It is a no-op kept only so its
     7	 * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
     8	 * never delete that entry.
     9	 */
    10	console.log("retired migrator (cardworks removed); nothing to do");

== callback-box/scripts/migrate/memo.ts ==
     1	/**
     2	 * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
     3	 *
     4	 * This XML→frontmatter migration ran before the `cardworks` XML library was
     5	 * removed. Every box is migrated, and `cb init` seeds a full migrations
     6	 * manifest on new boxes, so this never runs. It is a no-op kept only so its
     7	 * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
     8	 * never delete that entry.
     9	 */
    10	console.log("retired migrator (cardworks removed); nothing to do");

== callback-box/scripts/migrate/delete-deprecated-cards.ts ==
     1	#!/usr/bin/env tsx
     2	/* eslint-disable security/detect-non-literal-fs-filename */
     3	/**
     4	 * Delete deprecated, schema-less card types: `news-item`, `news-brief`, and
     5	 * `workflow`.
     6	 *
     7	 * None of these has a registered schema or any code that reads it: `workflow`
     8	 * is the pre-procedures engine, fully superseded by `procedure`; `news-item` /
     9	 * `news-brief` are a removed feature. They are XML-bodied dead data that
    10	 * `cb validate` can neither validate nor migrate, so they would block the
    11	 * "no XML remains" end state for the cardworks removal. Git history is the
    12	 * archive — this hard-deletes them.
    13	 *
    14	 * Empty parent directories (e.g. `config/workflows/`, `box/inbox/news/`) are
    15	 * left behind; git doesn't track empty dirs, so they vanish on commit.
    16	 *
    17	 * Usage:
    18	 *   pnpm exec tsx scripts/migrate/delete-deprecated-cards.ts <root>           # dry-run
    19	 *   pnpm exec tsx scripts/migrate/delete-deprecated-cards.ts <root> --apply
    20	 */
    21	
    22	import { unlink } from "node:fs/promises";
    23	import { pathToFileURL } from "node:url";
    24	import { runMigration } from "./_harness.js";
    25	
    26	const DEPRECATED_SUFFIXES = [".news-item.card", ".news-brief.card", ".workflow.card"];
    27	
    28	/**
    29	 * True for the deprecated, schema-less card types this migration deletes — the
    30	 * load-bearing selection logic. Exported for tests.
    31	 */
    32	export function isDeprecatedCard(name: string): boolean {
    33	  return DEPRECATED_SUFFIXES.some((suffix) => name.endsWith(suffix));
    34	}
    35	
    36	// CLI entry — only when run directly, not when imported by a test.
    37	if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    38	  await runMigration({
    39	    description: "Delete deprecated schema-less cards: news-item, news-brief, workflow.",
    40	    match: isDeprecatedCard,
    41	    convert: async (absPath) => {
    42	      await unlink(absPath);
    43	      return "converted";
    44	    },
    45	  });
    46	}

== callback-box/scripts/migrate/card-frontmatter.ts ==
     1	#!/usr/bin/env tsx
     2	/* eslint-disable import/no-namespace, security/detect-non-literal-fs-filename */
     3	/**
     4	 * Phase 1 of the markdown-card migration: ensure every `.card` file begins
     5	 * with a YAML frontmatter block. Cards that already have a frontmatter block
     6	 * are left alone. Cards without one get this prepended:
     7	 *
     8	 *   ---
     9	 *   content-type: application/x-card+xml
    10	 *   ---
    11	 *
    12	 * No body content is altered. The cardworks parser handles the new prefix
    13	 * transparently via `parseCard()`, so this migration is a no-op for readers
    14	 * — it just sets up the file shape for Phase 2 (per-schema frontmatter/body
    15	 * splits) without exposing any cards yet.
    16	 *
    17	 * Usage:
    18	 *   pnpm exec tsx scripts/migrate/card-frontmatter.ts <boxRoot>             # dry-run
    19	 *   pnpm exec tsx scripts/migrate/card-frontmatter.ts <boxRoot> --apply     # execute
    20	 */
    21	
    22	import * as fs from "node:fs/promises";
    23	import * as path from "node:path";
    24	
    25	const CONTENT_TYPE_HEADER = "---\ncontent-type: application/x-card+xml\n---\n";
    26	const FRONTMATTER_OPEN = /^---\r?\n/;
    27	
    28	interface MigrationPlan {
    29	  toRewrite: string[];
    30	  alreadyHasFrontmatter: string[];
    31	}
    32	
    33	async function findCardFiles(root: string): Promise<string[]> {
    34	  const out: string[] = [];
    35	  async function walk(dir: string): Promise<void> {
    36	    let entries;
    37	    try {
    38	      entries = await fs.readdir(dir, { withFileTypes: true });
    39	    } catch (e) {
    40	      const err = e as NodeJS.ErrnoException;
    41	      if (err.code === "ENOENT") return;
    42	      throw e;
    43	    }
    44	    for (const entry of entries) {
    45	      if (entry.name === ".git" || entry.name === "node_modules") continue;
    46	      const full = path.join(dir, entry.name);
    47	      if (entry.isDirectory()) {
    48	        await walk(full);
    49	      } else if (entry.isFile() && entry.name.endsWith(".card")) {
    50	        out.push(full);
    51	      }
    52	    }
    53	  }
    54	  await walk(root);
    55	  return out;
    56	}
    57	
    58	async function planMigration(cardFiles: string[]): Promise<MigrationPlan> {
    59	  const toRewrite: string[] = [];
    60	  const alreadyHasFrontmatter: string[] = [];
    61	  for (const file of cardFiles) {
    62	    const content = await fs.readFile(file, "utf8");
    63	    if (FRONTMATTER_OPEN.test(content)) {
    64	      alreadyHasFrontmatter.push(file);
    65	    } else {
    66	      toRewrite.push(file);
    67	    }
    68	  }
    69	  return { toRewrite, alreadyHasFrontmatter };
    70	}
    71	
    72	async function applyMigration(toRewrite: string[]): Promise<void> {
    73	  for (const file of toRewrite) {
    74	    const original = await fs.readFile(file, "utf8");
    75	    await fs.writeFile(file, CONTENT_TYPE_HEADER + original);
    76	  }
    77	}
    78	
    79	async function main(): Promise<void> {
    80	  const args = process.argv.slice(2);

exec
/opt/homebrew/bin/bash -lc "git diff main...HEAD -- callback-box/src/core/migrations.ts callback-box/scripts/migrate/image.ts callback-box/scripts/migrate/memo.ts callback-box/scripts/migrate/delete-deprecated-cards.ts | sed -n '1,220p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-GxymtR9y' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-b2iGPUf0' (errno=Operation not permitted)
diff --git a/callback-box/scripts/migrate/image.ts b/callback-box/scripts/migrate/image.ts
index 3552893f..9d9dfe60 100644
--- a/callback-box/scripts/migrate/image.ts
+++ b/callback-box/scripts/migrate/image.ts
@@ -1,207 +1,10 @@
-#!/usr/bin/env tsx
-/* eslint-disable security/detect-non-literal-fs-filename */
 /**
- * Phase 2 (per-schema): migrate `.image.card` files from Phase 1
- * frontmatter-with-XML-body to flat frontmatter.
+ * Retired migrator — see docs/plans/remove-cardworks-deletion.md.
  *
- * Usage:
- *   pnpm exec tsx scripts/migrate/image.ts <boxRoot>           # dry-run
- *   pnpm exec tsx scripts/migrate/image.ts <boxRoot> --apply
+ * This XML→frontmatter migration ran before the `cardworks` XML library was
+ * removed. Every box is migrated, and `cb init` seeds a full migrations
+ * manifest on new boxes, so this never runs. It is a no-op kept only so its
+ * MIGRATIONS entry (the manifest key in src/core/migrations.ts) stays valid —
+ * never delete that entry.
  */
-
-import { readFile, readdir, writeFile } from "node:fs/promises";
-import { join, relative, resolve } from "node:path";
-import { parseCard, type ElementNode } from "cardworks";
-import { stringify as stringifyYaml } from "yaml";
-import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
-
-const SPEC: ElementSpec = {
-  attrs: ["status", "has-text", "rotation"],
-  children: {
-    filename: { attrs: ["ref", "captured", "source"] },
-    description: { attrs: [] },
-    creation: { attrs: [] },
-    text: { attrs: ["source"] },
-    exif: { attrs: ["date", "camera", "gps", "width", "height"] },
-    "subject-bbox": { attrs: ["y1", "x1", "y2", "x2"] },
-    document: {
-      attrs: ["kind", "from"],
-      children: { date: { attrs: ["label"] } },
-    },
-  },
-};
-
-const warnings = new WarningCollector();
-
-async function findCards(root: string): Promise<string[]> {
-  const out: string[] = [];
-  async function walk(dir: string): Promise<void> {
-    let entries;
-    try {
-      entries = await readdir(dir, { withFileTypes: true });
-    } catch (e) {
-      const err = e as NodeJS.ErrnoException;
-      if (err.code === "ENOENT") return;
-      throw e;
-    }
-    for (const entry of entries) {
-      if (entry.name === ".git" || entry.name === "node_modules") continue;
-      const full = join(dir, entry.name);
-      if (entry.isDirectory()) {
-        await walk(full);
-      } else if (entry.isFile() && entry.name.endsWith(".image.card")) {
-        out.push(full);
-      }
-    }
-  }
-  await walk(root);
-  return out;
-}
-
-function firstChild(node: ElementNode, tagName: string): ElementNode | undefined {
-  return node.children.find((c) => c.tagName === tagName);
-}
-
-function convertOne(node: ElementNode, source: string): Record<string, unknown> {
-  if (node.tagName !== "image") {
-    throw new Error(`${source}: expected <image> root, got <${node.tagName}>`);
-  }
-  const fields: Record<string, unknown> = {
-    type: "image",
-    status: node.attrs["status"] ?? "new",
-  };
-  if (node.attrs["has-text"] !== undefined) {
-    fields["has-text"] = node.attrs["has-text"] === "true";
-  }
-  if (node.attrs["rotation"] !== undefined) {
-    fields["rotation"] = node.attrs["rotation"];
-  }
-
-  const filenameEl = firstChild(node, "filename");
-  if (filenameEl === undefined) {
-    throw new Error(`${source}: missing <filename>`);
-  }
-  const ref = filenameEl.attrs["ref"];
-  const captured = filenameEl.attrs["captured"];
-  const fSource = filenameEl.attrs["source"];
-  if (ref === undefined || captured === undefined || fSource === undefined) {
-    throw new Error(`${source}: <filename> missing ref/captured/source`);
-  }
-  fields["filename"] = { ref, captured, source: fSource };
-
-  const descEl = firstChild(node, "description");
-  if (descEl !== undefined && descEl.text !== undefined && descEl.text !== "") {
-    fields["description"] = descEl.text;
-  }
-
-  const creationEl = firstChild(node, "creation");
-  if (creationEl !== undefined && creationEl.text !== undefined && creationEl.text !== "") {
-    fields["creation"] = creationEl.text;
-  }
-
-  const textBlocks: Array<{ source?: string; content: string }> = [];
-  for (const c of node.children) {
-    if (c.tagName !== "text") continue;
-    if (c.text === undefined || c.text === "") continue;
-    const entry: { source?: string; content: string } = { content: c.text };
-    if (c.attrs["source"] !== undefined) entry.source = c.attrs["source"];
-    textBlocks.push(entry);
-  }
-  if (textBlocks.length > 0) fields["text"] = textBlocks;
-
-  const exifEl = firstChild(node, "exif");
-  if (exifEl !== undefined) {
-    const exif: Record<string, string> = {};
-    for (const k of ["date", "camera", "gps", "width", "height"]) {
-      const v = exifEl.attrs[k];
-      if (v !== undefined) exif[k] = v;
-    }
-    if (Object.keys(exif).length > 0) fields["exif"] = exif;
-  }
-
-  const bboxEl = firstChild(node, "subject-bbox");
-  if (bboxEl !== undefined) {
-    const y1 = bboxEl.attrs["y1"];
-    const x1 = bboxEl.attrs["x1"];
-    const y2 = bboxEl.attrs["y2"];
-    const x2 = bboxEl.attrs["x2"];
-    if (y1 !== undefined && x1 !== undefined && y2 !== undefined && x2 !== undefined) {
-      fields["subject-bbox"] = { y1, x1, y2, x2 };
-    }
-  }
-
-  const docEl = firstChild(node, "document");
-  if (docEl !== undefined) {
-    const doc: Record<string, unknown> = {};
-    if (docEl.attrs["kind"] !== undefined) doc["kind"] = docEl.attrs["kind"];
-    if (docEl.attrs["from"] !== undefined) doc["from"] = docEl.attrs["from"];
-    const dates: Array<{ label: string; value: string }> = [];
-    for (const d of docEl.children) {
-      if (d.tagName !== "date") continue;
-      const label = d.attrs["label"];
-      const value = d.text;
-      if (label !== undefined && value !== undefined) {
-        dates.push({ label, value });
-      }
-    }
-    if (dates.length > 0) doc["dates"] = dates;
-    fields["document"] = doc;
-  }
-
-  return fields;
-}
-
-async function migrateFile(absPath: string): Promise<"converted" | "already-migrated"> {
-  const raw = await readFile(absPath, "utf8");
-  // Already frontmatter (or empty/degenerate) — only an XML card starts with "<".
-  if (!raw.trimStart().startsWith("<")) {
-    return "already-migrated";
-  }
-  const node = await parseCard(raw, { source: absPath });
-  checkElement({ node, source: absPath, spec: SPEC, warnings });
-  const fields = convertOne(node, absPath);
-  const yamlText = stringifyYaml(fields);
-  await writeFile(absPath, `---\n${yamlText}---\n`);
-  return "converted";
-}
-
-async function main(): Promise<void> {
-  const args = process.argv.slice(2);
-  const apply = args.includes("--apply");
-  const positional = args.filter((a) => !a.startsWith("--"));
-  const boxRoot = positional[0];
-  if (boxRoot === undefined) {
-    console.error("Usage: migrate-image <boxRoot> [--apply]");
-    process.exit(1);
-  }
-  const absRoot = resolve(boxRoot);
-  const cards = await findCards(absRoot);
-  console.log(`Found ${String(cards.length)} *.image.card files under ${absRoot}`);
-  if (!apply) {
-    console.log("Dry run. Pass --apply to convert.");
-    return;
-  }
-  let converted = 0;
-  let already = 0;
-  const failed: Array<{ file: string; error: string }> = [];
-  for (const f of cards) {
-    try {
-      const r = await migrateFile(f);
-      if (r === "converted") converted++;
-      else already++;
-    } catch (e) {
-      failed.push({ file: f, error: (e as Error).message });
-    }
-  }
-  console.log(`Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`);
-  for (const f of failed) {
-    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
-  }
-  warnings.dump(absRoot);
-  if (failed.length > 0) process.exit(2);
-}
-
-main().catch((e) => {
-  console.error(e);
-  process.exit(1);
-});
+console.log("retired migrator (cardworks removed); nothing to do");
diff --git a/callback-box/scripts/migrate/memo.ts b/callback-box/scripts/migrate/memo.ts

codex
I found one suspicious lint edge already: the dispatcher warns for unknown *frontmatter* card types, but a `.card` with no frontmatter now returns a clean result. That is exactly the sort of quiet pass that matters if any legacy or malformed file slips in, so I’m checking whether anything else catches it before calling it a finding.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/list-cards.ts | sed -n '1,160p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/cli/commands/validate.ts | sed -n '1,220p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
     1	/**
     2	 * List the `.card` files in a box.
     3	 *
     4	 * Replaces the cardworks `CardLoader.listCards()` — a plain glob for `*.card`
     5	 * files, returning absolute paths, skipping the usual non-content directories.
     6	 */
     7	
     8	import { glob } from "glob";
     9	
    10	const CARD_GLOB_IGNORE = ["node_modules/**", ".git/**", "tmp/**", ".callback-box/**"];
    11	
    12	export async function listBoxCardFiles(boxRoot: string): Promise<string[]> {
    13	  return glob("**/*.card", {
    14	    cwd: boxRoot,
    15	    nodir: true,
    16	    absolute: true,
    17	    ignore: CARD_GLOB_IGNORE,
    18	  });
    19	}

 succeeded in 0ms:
     1	/**
     2	 * cb validate - Validate cards and markdown against schemas/rules
     3	 */
     4	
     5	import { execFile } from "node:child_process";
     6	import * as fs from "node:fs/promises";
     7	import * as path from "node:path";
     8	import { promisify } from "node:util";
     9	import { Command } from "commander";
    10	import { formatLintResults, type LintSummary } from "../../cards/index.js";
    11	import { lint as markdownlint } from "markdownlint/promise";
    12	import type { LintError } from "markdownlint";
    13	import { noViewLabelLinks, noBrokenInternalLinks } from "../../core/markdown-lint-rules.js";
    14	import { requireBoxRoot, isCardFile, isMarkdownFile } from "../lib/paths.js";
    15	import { listBoxCardFiles } from "../../core/list-cards.js";
    16	import { getStatus } from "../lib/git.js";
    17	import { lintAttachLayout, type AttachLintError } from "../../lib/attach-lint.js";
    18	import { lintCardsDispatch } from "../../core/card-lint.js";
    19	import { isClaudeMdFile, lintClaudeMdFile, lintAllClaudeMd } from "../../core/claude-md-lint.js";
    20	import { buildLoadContext } from "../../core/load-context.js";
    21	import { staleContainsWarning } from "../../core/search/contains-state.js";
    22	import type { LoadCardContext } from "../../core/card-io.js";
    23	
    24	const execFileP = promisify(execFile);
    25	
    26	/**
    27	 * Cards under `store/trash/` are by definition orphaned/discarded and
    28	 * routinely have broken refs (their attachments and related cards have
    29	 * been deleted). We skip them from default validation so trash drift
    30	 * doesn't block normal commits. `cb validate <path>` on an explicit
    31	 * trash path still validates — the skip only applies to the implicit
    32	 * scans (--all, --staged, no-args).
    33	 */
    34	function isTrashedCard(boxRelOrAbs: string): boolean {
    35	  return /(^|\/)store\/trash\//.test(boxRelOrAbs);
    36	}
    37	
    38	async function listStagedCards(boxRoot: string): Promise<string[]> {
    39	  const { stdout } = await execFileP(
    40	    "git",
    41	    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    42	    { cwd: boxRoot, maxBuffer: 10 * 1024 * 1024 }
    43	  );
    44	  return stdout
    45	    .split("\n")
    46	    .filter((line) => line.endsWith(".card") && !isTrashedCard(line))
    47	    .map((rel) => path.join(boxRoot, rel));
    48	}
    49	
    50	/**
    51	 * Read the file path from a Claude Code PostToolUse hook payload on stdin.
    52	 * Returns undefined if stdin isn't JSON or doesn't carry a card path —
    53	 * the hook just exits 0 silently in that case.
    54	 */
    55	async function readHookFilePath(): Promise<string | undefined> {
    56	  const chunks: Buffer[] = [];
    57	  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    58	  const raw = Buffer.concat(chunks).toString("utf-8").trim();
    59	  if (raw === "") return undefined;
    60	  try {
    61	    const parsed = JSON.parse(raw) as { tool_input?: { file_path?: unknown } };
    62	    const fp = parsed.tool_input?.file_path;
    63	    return typeof fp === "string" ? fp : undefined;
    64	  } catch (_e) {
    65	    // stdin wasn't valid JSON: per this helper's contract the hook just exits 0
    66	    // silently when there's no parseable payload, so the parse error is expected
    67	    // and carries nothing actionable.
    68	    return undefined;
    69	  }
    70	}
    71	
    72	const SKIP_DIRS = new Set(["node_modules", ".git", ".pnpm", ".claude"]);
    73	const SKIP_FILES = new Set(["CLAUDE.md"]);
    74	
    75	// Opt-in validity rules only — style rules are not enforced.
    76	const MARKDOWN_CONFIG = {
    77	  default: false,
    78	  MD009: true, // trailing spaces
    79	  MD037: true, // spaces inside emphasis markers
    80	  MD038: true, // spaces inside code span elements
    81	  MD047: true, // files should end with a single newline
    82	};
    83	
    84	const CUSTOM_RULES = [noViewLabelLinks, noBrokenInternalLinks];
    85	
    86	async function findMarkdownFiles(dir: string): Promise<string[]> {
    87	  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
    88	  if (entries === null) return [];
    89	  const results: string[] = [];
    90	  for (const entry of entries) {
    91	    if (entry.isDirectory()) {
    92	      if (!SKIP_DIRS.has(entry.name)) {
    93	        const sub = await findMarkdownFiles(path.join(dir, entry.name));
    94	        results.push(...sub);
    95	      }
    96	    } else if (entry.isFile() && entry.name.endsWith(".md") && !SKIP_FILES.has(entry.name)) {
    97	      results.push(path.join(dir, entry.name));
    98	    }
    99	  }
   100	  return results.toSorted();
   101	}
   102	
   103	interface MarkdownLintSummary {
   104	  filesChecked: number;
   105	  filesWithErrors: number;
   106	  totalErrors: number;
   107	  errors: Record<string, LintError[]>;
   108	}
   109	
   110	async function lintMarkdownFiles(files: string[]): Promise<MarkdownLintSummary> {
   111	  const results = await markdownlint({ files, config: MARKDOWN_CONFIG, customRules: CUSTOM_RULES });
   112	  let filesWithErrors = 0;
   113	  let totalErrors = 0;
   114	  const errors: Record<string, LintError[]> = {};
   115	  for (const file of files) {
   116	    const fileErrors = results[file] ?? [];
   117	    if (fileErrors.length > 0) {
   118	      filesWithErrors++;
   119	      totalErrors += fileErrors.length;
   120	      errors[file] = fileErrors;
   121	    }
   122	  }
   123	  return { filesChecked: files.length, filesWithErrors, totalErrors, errors };
   124	}
   125	
   126	function formatMarkdownResults(summary: MarkdownLintSummary, { colors }: { colors: boolean }): string {
   127	  const lines: string[] = [];
   128	  const ESC = "";
   129	  const red = colors ? (s: string) => `${ESC}[31m${s}${ESC}[0m` : (s: string) => s;
   130	  for (const [file, fileErrors] of Object.entries(summary.errors)) {
   131	    for (const e of fileErrors) {
   132	      const rule = e.ruleNames[0] ?? "unknown";
   133	      const detail = e.errorDetail ? ` (${e.errorDetail})` : "";
   134	      lines.push(`${red("error")}  ${file}:${e.lineNumber}  [${rule}] ${e.ruleDescription}${detail}`);
   135	    }
   136	  }
   137	  return lines.join("\n");
   138	}
   139	
   140	function formatAttachLintErrors(errors: AttachLintError[], { colors }: { colors: boolean }): string {
   141	  if (errors.length === 0) return "";
   142	  const ESC = "";
   143	  const red = colors ? (s: string) => `${ESC}[31m${s}${ESC}[0m` : (s: string) => s;
   144	  return errors
   145	    .map((e) => `${red("error")}  ${e.path}  [${e.rule}] ${e.message}`)
   146	    .join("\n");
   147	}
   148	
   149	interface ValidationResults {
   150	  cardSummary: LintSummary | null;
   151	  mdSummary: MarkdownLintSummary | null;
   152	  attachErrors: AttachLintError[];
   153	  /** Soft, non-blocking size warnings for oversized CLAUDE.md files. */
   154	  claudeMdWarnings: string[];
   155	}
   156	
   157	/**
   158	 * Hook mode: read the touched card path from stdin, validate it, and exit.
   159	 * Non-card paths exit 0 silently; errors AND warnings exit 2 so the agent
   160	 * sees feedback (the hook is a nudge, not a gate — pre-commit blocks only
   161	 * on errors). This always exits the process and never returns.
   162	 */
   163	async function runHookMode(): Promise<never> {
   164	  const fp = await readHookFilePath();
   165	  if (fp === undefined) {
   166	    process.exit(0);
   167	  }
   168	  // CLAUDE.md gets only the soft size lint (it isn't a card and isn't markdown-
   169	  // validity-checked); a too-large one is surfaced as a warning, never blocked.
   170	  if (isClaudeMdFile(fp)) {
   171	    const boxRoot = await requireBoxRoot();
   172	    const warning = await lintClaudeMdFile(boxRoot, fp);
   173	    if (warning !== null) {
   174	      process.stderr.write(`${warning}\n`);
   175	      process.exit(2);
   176	    }
   177	    process.exit(0);
   178	  }
   179	  if (!isCardFile(fp)) {
   180	    process.exit(0);
   181	  }
   182	  const boxRoot = await requireBoxRoot();
   183	  const ctx = await buildLoadContext(boxRoot);
   184	  const summary = await lintCardsDispatch([fp], { boxRoot, ctx });
   185	  const stale = await staleContainsWarning(boxRoot, {
   186	    relPath: path.relative(boxRoot, fp),
   187	    ctx,
   188	  });
   189	  if (summary.totalErrors > 0 || summary.totalWarnings > 0 || stale !== null) {
   190	    const parts: string[] = [];
   191	    if (summary.totalErrors > 0 || summary.totalWarnings > 0) {
   192	      parts.push(formatLintResults(summary, { colors: false }));
   193	    }
   194	    if (stale !== null) parts.push(stale);
   195	    process.stderr.write(`${parts.join("\n")}\n`);
   196	    process.exit(2);
   197	  }
   198	  process.exit(0);
   199	}
   200	
   201	interface CollectArgs {
   202	  boxRoot: string;
   203	  ctx: LoadCardContext;
   204	  resolved: string[];
   205	  json: boolean;
   206	}
   207	
   208	/**
   209	 * Pick the validation scope from the options and run it. Mirrors the original
   210	 * staged / all-or-empty / explicit-paths branch order exactly.
   211	 */
   212	async function collectResults(
   213	  options: { staged?: boolean; all?: boolean; json?: boolean },
   214	  args: CollectArgs
   215	): Promise<ValidationResults> {
   216	  if (options.staged) return collectStagedResults(args);
   217	  if (options.all || args.resolved.length === 0) return collectAllResults(args);
   218	  return collectExplicitResults(args);
   219	}
   220	

exec
/opt/homebrew/bin/bash -lc "git show main:callback-box/src/core/card-lint.ts | nl -ba | sed -n '1,220p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-jNSuEubi' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-xfYyd5EU' (errno=Operation not permitted)
     1	/**
     2	 * Lint dispatcher for mixed XML / markdown-frontmatter cards.
     3	 *
     4	 * For each card path, peeks at the frontmatter to decide which path to
     5	 * take: cards declaring a `type:` that matches a registered CardSchema
     6	 * are validated through parseCardText (Zod schema check); everything
     7	 * else falls through to cardworks' existing XML lintCard. Results are
     8	 * merged into a single LintSummary so callers (e.g. cb validate) can
     9	 * format them uniformly.
    10	 *
    11	 * Ref-checking walks two sides: `extractRefs` (src/cards) over parsed
    12	 * frontmatter fields, and `extractBodyRefs` over the Markdoc body. Both
    13	 * yield `{path, ref}` entries with the same shape; both are surfaced as
    14	 * warnings (not errors) so legitimate moves don't block commits.
    15	 *
    16	 * Type-specific, self-contained validation (rules Zod can't express, e.g.
    17	 * commentary's Markdoc check or extfile's `file:`-URL refinement) is NOT here:
    18	 * it lives on each schema as a `validate` hook (cardworks), invoked generically
    19	 * below. The ref-existence walk stays here because it is box-aware (needs the
    20	 * loader), which the self-contained hook deliberately lacks.
    21	 */
    22	
    23	import { readFile } from "node:fs/promises";
    24	import { lintCard, type ICardLoader } from "cardworks";
    25	import {
    26	  splitCardContent,
    27	  extractRefs,
    28	  type CardSchema,
    29	  type LintResult,
    30	  type LintSummary,
    31	  type LintIssue,
    32	} from "../cards/index.js";
    33	import { parse as parseYaml } from "yaml";
    34	import { parseCardText, typeFromFilename, type LoadCardContext } from "./card-io.js";
    35	import { extractBodyRefs } from "./body-refs.js";
    36	
    37	export interface LintDispatchOptions {
    38	  loader: ICardLoader;
    39	  ctx: LoadCardContext;
    40	}
    41	
    42	/**
    43	 * Lint a list of card paths, dispatching each to the appropriate
    44	 * validator based on file shape.
    45	 */
    46	export async function lintCardsDispatch(
    47	  paths: string[],
    48	  options: LintDispatchOptions
    49	): Promise<LintSummary> {
    50	  const results: LintResult[] = [];
    51	  let totalErrors = 0;
    52	  let totalWarnings = 0;
    53	  let filesWithErrors = 0;
    54	
    55	  for (const path of paths) {
    56	    const result = await lintOne(path, options);
    57	    results.push(result);
    58	    totalErrors += result.errors.length;
    59	    totalWarnings += result.warnings.length;
    60	    if (result.errors.length > 0) {
    61	      filesWithErrors++;
    62	    }
    63	  }
    64	
    65	  return {
    66	    results,
    67	    filesChecked: paths.length,
    68	    filesWithErrors,
    69	    totalErrors,
    70	    totalWarnings,
    71	  };
    72	}
    73	
    74	async function lintOne(path: string, options: LintDispatchOptions): Promise<LintResult> {
    75	  let content: string;
    76	  try {
    77	    content = await readFile(path, "utf8");
    78	  } catch (e) {
    79	    return errorResult(path, (e as Error).message);
    80	  }
    81	
    82	  const split = splitCardContent(content);
    83	  if (split.hasFrontmatter) {
    84	    const type = typeFromFilename(path);
    85	    if (type !== undefined && options.ctx.cardSchemas.has(type)) {
    86	      return lintFrontmatterCard({ path, content, options, type });
    87	    }
    88	  }
    89	  return lintCard(options.loader, { path });
    90	}
    91	
    92	async function lintFrontmatterCard(input: {
    93	  path: string;
    94	  content: string;
    95	  options: LintDispatchOptions;
    96	  type: string;
    97	}): Promise<LintResult> {
    98	  const { path, content, options, type } = input;
    99	  let parsed;
   100	  try {
   101	    parsed = parseCardText(content, { source: path, schemas: options.ctx.cardSchemas, type });
   102	  } catch (e) {
   103	    return errorResult(path, (e as Error).message);
   104	  }
   105	  // Broken refs are surfaced as WARNINGS, not errors. Refs commonly go
   106	  // stale via legitimate operations (the referent got moved, archived,
   107	  // trashed, or hand-deleted), and treating each one as a hard error
   108	  // would have the pre-commit hook blocking every commit on any box
   109	  // with accumulated data drift. Schema validation failures (which come
   110	  // out of parseCardText as a thrown CardIOError → errorResult above)
   111	  // remain errors and do block.
   112	  const frontmatterRefs = extractRefs(parsed.fields);
   113	  const bodyField = parsed.fields["body"];
   114	  const bodyRefs = typeof bodyField === "string" ? extractBodyRefs(bodyField) : [];
   115	  const warnings: LintIssue[] = [];
   116	  for (const { path: refPath, ref } of [...frontmatterRefs, ...bodyRefs]) {
   117	    try {
   118	      const resolved = await options.loader.resolveRef(ref, path);
   119	      if (!resolved.exists) {
   120	        warnings.push({
   121	          type: "reference",
   122	          severity: "warning",
   123	          message: `Broken reference at ${refPath}: ${ref} does not exist`,
   124	        });
   125	      }
   126	    } catch (e) {
   127	      warnings.push({
   128	        type: "reference",
   129	        severity: "warning",
   130	        message: `Reference at ${refPath} failed to resolve: ${(e as Error).message}`,
   131	      });
   132	    }
   133	  }
   134	  const containsWarning = lintContainsLength(parsed.fields);
   135	  if (containsWarning !== null) warnings.push(containsWarning);
   136	  warnings.push(...unknownKeyWarnings({ content, schema: parsed.schema }));
   137	  // Type-specific, self-contained validation (rules Zod can't express) lives on
   138	  // the schema as its `validate` hook — see the commentary/extfile schema
   139	  // modules. The generic ref-existence walk above stays here because it needs
   140	  // the loader (box-aware), which the self-contained hook deliberately lacks.
   141	  const errors = parsed.schema.validate ? parsed.schema.validate({ fields: parsed.fields }) : [];
   142	  return { path, errors, warnings };
   143	}
   144	
   145	/**
   146	 * Frontmatter keys present on disk that the card's schema doesn't declare. The
   147	 * loader strips these in memory (a drifted card still loads, renders, and
   148	 * indexes), so they are surfaced as **warnings** — visible to `cb validate` and
   149	 * the PostToolUse hook — to be cleaned off disk eventually, without blocking
   150	 * commits or breaking load. Allowed keys are the schema's own fields (minus the
   151	 * body field, which lives in the file body, not frontmatter), the injected
   152	 * global fields, and `type`.
   153	 */
   154	function unknownKeyWarnings(input: { content: string; schema: CardSchema }): LintIssue[] {
   155	  const { content, schema } = input;
   156	  const split = splitCardContent(content);
   157	  if (!split.hasFrontmatter) return [];
   158	  let fm: unknown;
   159	  try {
   160	    fm = parseYaml(split.frontmatterText);
   161	  } catch (_e) {
   162	    // Malformed YAML is a separate, error-level failure already surfaced by
   163	    // parseCardText (which threw → errorResult); nothing to add here.
   164	    return [];
   165	  }
   166	  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) return [];
   167	  const allowed = new Set<string>(["type", ...schema.globalFieldNames, ...Object.keys(schema.fields)]);
   168	  if (schema.bodyFieldName !== null) allowed.delete(schema.bodyFieldName);
   169	  const warnings: LintIssue[] = [];
   170	  for (const key of Object.keys(fm as Record<string, unknown>)) {
   171	    if (allowed.has(key)) continue;
   172	    warnings.push({
   173	      type: "schema",
   174	      severity: "warning",
   175	      message:
   176	        `Unknown frontmatter key "${key}" — not declared by the ${schema.type} schema; ` +
   177	        "it is ignored on load and should be removed",
   178	    });
   179	  }
   180	  return warnings;
   181	}
   182	
   183	/** Soft budget for the `contains` field — one concise sentence, not a summary essay. */
   184	const CONTAINS_MAX_CHARS = 200;
   185	
   186	function lintContainsLength(fields: Record<string, unknown>): LintIssue | null {
   187	  const contains = fields["contains"];
   188	  if (typeof contains !== "string" || contains.length <= CONTAINS_MAX_CHARS) return null;
   189	  return {
   190	    type: "contains",
   191	    severity: "warning",
   192	    message:
   193	      `contains: is ${String(contains.length)} chars (budget ${String(CONTAINS_MAX_CHARS)}) — ` +
   194	      "tighten it to one sentence stating what can be found in this card",
   195	  };
   196	}
   197	
   198	function errorResult(path: string, message: string): LintResult {
   199	  // The cardworks formatter prints the file path as a header above each
   200	  // result's issues, so strip any leading "<path>: " prefix the underlying
   201	  // error (e.g. CardIOError) included to avoid printing the path twice.
   202	  const prefix = `${path}: `;
   203	  const cleaned = message.startsWith(prefix) ? message.slice(prefix.length) : message;
   204	  const issue: LintIssue = {
   205	    type: "validation",
   206	    severity: "error",
   207	    message: cleaned,
   208	  };
   209	  return { path, errors: [issue], warnings: [] };
   210	}
   211	

exec
/opt/homebrew/bin/bash -lc "git show main:callback-box/src/cli/commands/validate.ts | nl -ba | sed -n '1,180p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-0J3e2q9s' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-ABbEOFmc' (errno=Operation not permitted)
     1	/**
     2	 * cb validate - Validate cards and markdown against schemas/rules
     3	 */
     4	
     5	import { execFile } from "node:child_process";
     6	import * as fs from "node:fs/promises";
     7	import * as path from "node:path";
     8	import { promisify } from "node:util";
     9	import { Command } from "commander";
    10	import { formatLintResults, type LintSummary } from "../../cards/index.js";
    11	import { lint as markdownlint } from "markdownlint/promise";
    12	import type { LintError } from "markdownlint";
    13	import { noViewLabelLinks, noBrokenInternalLinks } from "../../core/markdown-lint-rules.js";
    14	import { requireBoxRoot, isCardFile, isMarkdownFile } from "../lib/paths.js";
    15	import { createLoader } from "../lib/loader.js";
    16	import { getStatus } from "../lib/git.js";
    17	import { lintAttachLayout, type AttachLintError } from "../../lib/attach-lint.js";
    18	import { lintCardsDispatch } from "../../core/card-lint.js";
    19	import { isClaudeMdFile, lintClaudeMdFile, lintAllClaudeMd } from "../../core/claude-md-lint.js";
    20	import { buildLoadContext } from "../../core/load-context.js";
    21	import { staleContainsWarning } from "../../core/search/contains-state.js";
    22	import type { LoadCardContext } from "../../core/card-io.js";
    23	
    24	const execFileP = promisify(execFile);
    25	
    26	/**
    27	 * Cards under `store/trash/` are by definition orphaned/discarded and
    28	 * routinely have broken refs (their attachments and related cards have
    29	 * been deleted). We skip them from default validation so trash drift
    30	 * doesn't block normal commits. `cb validate <path>` on an explicit
    31	 * trash path still validates — the skip only applies to the implicit
    32	 * scans (--all, --staged, no-args).
    33	 */
    34	function isTrashedCard(boxRelOrAbs: string): boolean {
    35	  return /(^|\/)store\/trash\//.test(boxRelOrAbs);
    36	}
    37	
    38	async function listStagedCards(boxRoot: string): Promise<string[]> {
    39	  const { stdout } = await execFileP(
    40	    "git",
    41	    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    42	    { cwd: boxRoot, maxBuffer: 10 * 1024 * 1024 }
    43	  );
    44	  return stdout
    45	    .split("\n")
    46	    .filter((line) => line.endsWith(".card") && !isTrashedCard(line))
    47	    .map((rel) => path.join(boxRoot, rel));
    48	}
    49	
    50	/**
    51	 * Read the file path from a Claude Code PostToolUse hook payload on stdin.
    52	 * Returns undefined if stdin isn't JSON or doesn't carry a card path —
    53	 * the hook just exits 0 silently in that case.
    54	 */
    55	async function readHookFilePath(): Promise<string | undefined> {
    56	  const chunks: Buffer[] = [];
    57	  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    58	  const raw = Buffer.concat(chunks).toString("utf-8").trim();
    59	  if (raw === "") return undefined;
    60	  try {
    61	    const parsed = JSON.parse(raw) as { tool_input?: { file_path?: unknown } };
    62	    const fp = parsed.tool_input?.file_path;
    63	    return typeof fp === "string" ? fp : undefined;
    64	  } catch (_e) {
    65	    // stdin wasn't valid JSON: per this helper's contract the hook just exits 0
    66	    // silently when there's no parseable payload, so the parse error is expected
    67	    // and carries nothing actionable.
    68	    return undefined;
    69	  }
    70	}
    71	
    72	const SKIP_DIRS = new Set(["node_modules", ".git", ".pnpm", ".claude"]);
    73	const SKIP_FILES = new Set(["CLAUDE.md"]);
    74	
    75	// Opt-in validity rules only — style rules are not enforced.
    76	const MARKDOWN_CONFIG = {
    77	  default: false,
    78	  MD009: true, // trailing spaces
    79	  MD037: true, // spaces inside emphasis markers
    80	  MD038: true, // spaces inside code span elements
    81	  MD047: true, // files should end with a single newline
    82	};
    83	
    84	const CUSTOM_RULES = [noViewLabelLinks, noBrokenInternalLinks];
    85	
    86	async function findMarkdownFiles(dir: string): Promise<string[]> {
    87	  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
    88	  if (entries === null) return [];
    89	  const results: string[] = [];
    90	  for (const entry of entries) {
    91	    if (entry.isDirectory()) {
    92	      if (!SKIP_DIRS.has(entry.name)) {
    93	        const sub = await findMarkdownFiles(path.join(dir, entry.name));
    94	        results.push(...sub);
    95	      }
    96	    } else if (entry.isFile() && entry.name.endsWith(".md") && !SKIP_FILES.has(entry.name)) {
    97	      results.push(path.join(dir, entry.name));
    98	    }
    99	  }
   100	  return results.toSorted();
   101	}
   102	
   103	interface MarkdownLintSummary {
   104	  filesChecked: number;
   105	  filesWithErrors: number;
   106	  totalErrors: number;
   107	  errors: Record<string, LintError[]>;
   108	}
   109	
   110	async function lintMarkdownFiles(files: string[]): Promise<MarkdownLintSummary> {
   111	  const results = await markdownlint({ files, config: MARKDOWN_CONFIG, customRules: CUSTOM_RULES });
   112	  let filesWithErrors = 0;
   113	  let totalErrors = 0;
   114	  const errors: Record<string, LintError[]> = {};
   115	  for (const file of files) {
   116	    const fileErrors = results[file] ?? [];
   117	    if (fileErrors.length > 0) {
   118	      filesWithErrors++;
   119	      totalErrors += fileErrors.length;
   120	      errors[file] = fileErrors;
   121	    }
   122	  }
   123	  return { filesChecked: files.length, filesWithErrors, totalErrors, errors };
   124	}
   125	
   126	function formatMarkdownResults(summary: MarkdownLintSummary, { colors }: { colors: boolean }): string {
   127	  const lines: string[] = [];
   128	  const ESC = "";
   129	  const red = colors ? (s: string) => `${ESC}[31m${s}${ESC}[0m` : (s: string) => s;
   130	  for (const [file, fileErrors] of Object.entries(summary.errors)) {
   131	    for (const e of fileErrors) {
   132	      const rule = e.ruleNames[0] ?? "unknown";
   133	      const detail = e.errorDetail ? ` (${e.errorDetail})` : "";
   134	      lines.push(`${red("error")}  ${file}:${e.lineNumber}  [${rule}] ${e.ruleDescription}${detail}`);
   135	    }
   136	  }
   137	  return lines.join("\n");
   138	}
   139	
   140	function formatAttachLintErrors(errors: AttachLintError[], { colors }: { colors: boolean }): string {
   141	  if (errors.length === 0) return "";
   142	  const ESC = "";
   143	  const red = colors ? (s: string) => `${ESC}[31m${s}${ESC}[0m` : (s: string) => s;
   144	  return errors
   145	    .map((e) => `${red("error")}  ${e.path}  [${e.rule}] ${e.message}`)
   146	    .join("\n");
   147	}
   148	
   149	interface ValidationContext {
   150	  loader: Awaited<ReturnType<typeof createLoader>>;
   151	  ctx: LoadCardContext;
   152	}
   153	
   154	interface ValidationResults {
   155	  cardSummary: LintSummary | null;
   156	  mdSummary: MarkdownLintSummary | null;
   157	  attachErrors: AttachLintError[];
   158	  /** Soft, non-blocking size warnings for oversized CLAUDE.md files. */
   159	  claudeMdWarnings: string[];
   160	}
   161	
   162	/**
   163	 * Hook mode: read the touched card path from stdin, validate it, and exit.
   164	 * Non-card paths exit 0 silently; errors AND warnings exit 2 so the agent
   165	 * sees feedback (the hook is a nudge, not a gate — pre-commit blocks only
   166	 * on errors). This always exits the process and never returns.
   167	 */
   168	async function runHookMode(): Promise<never> {
   169	  const fp = await readHookFilePath();
   170	  if (fp === undefined) {
   171	    process.exit(0);
   172	  }
   173	  // CLAUDE.md gets only the soft size lint (it isn't a card and isn't markdown-
   174	  // validity-checked); a too-large one is surfaced as a warning, never blocked.
   175	  if (isClaudeMdFile(fp)) {
   176	    const boxRoot = await requireBoxRoot();
   177	    const warning = await lintClaudeMdFile(boxRoot, fp);
   178	    if (warning !== null) {
   179	      process.stderr.write(`${warning}\n`);
   180	      process.exit(2);

codex
The no-frontmatter validation gap is real: `cb validate` enumerates all `*.card` files and feeds them to this dispatcher, and the old code would fall through to `lintCard`. I’m continuing through the browse/status and card-loading changes now to make sure I don’t miss a more serious runtime or data-loss problem.
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/webapp/routes/api-browse.ts | sed -n '1,220p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/webapp/trpc/routers/status.ts | sed -n '80,190p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
    80	
    81	      // Security: ensure we stay within boxRoot
    82	      const resolved = path.resolve(targetDir);
    83	      if (!resolved.startsWith(path.resolve(ctx.boxRoot))) {
    84	        return { path: input.path, dirs: [] as BrowseDir[], cards: [] as BrowseCard[], files: [] as BrowseFile[] };
    85	      }
    86	
    87	      let entries: Array<{ name: string; isDirectory: () => boolean }>;
    88	      try {
    89	        entries = await fs.readdir(resolved, { withFileTypes: true });
    90	      } catch (e) {
    91	        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
    92	          console.warn(`browse: cannot read directory ${resolved}, returning empty listing:`, e);
    93	        }
    94	        return { path: input.path, dirs: [] as BrowseDir[], cards: [] as BrowseCard[], files: [] as BrowseFile[] };
    95	      }
    96	
    97	      const dirs: BrowseDir[] = [];
    98	      const cards: BrowseCard[] = [];
    99	      const files: BrowseFile[] = [];
   100	
   101	      // Build a set of card basenames so we can fold owned `<basename>.attach/`
   102	      // directories into their owning card (cards-as-directories UI).
   103	      const cardBasenames = new Set<string>();
   104	      for (const e of entries) {
   105	        if (e.isDirectory()) continue;
   106	        if (!e.name.endsWith(".card")) continue;
   107	        const parsed = parseCardName(e.name);
   108	        if (parsed) cardBasenames.add(parsed.name);
   109	      }
   110	
   111	      for (const entry of entries) {
   112	        if (entry.name.startsWith(".")) continue;
   113	        if (entry.isDirectory()) {
   114	          // Hide `<basename>.attach/` when an owning card sits next to it.
   115	          // Stray attach dirs (no owner) still show up so they can be cleaned.
   116	          if (entry.name.endsWith(".attach")) {
   117	            const owner = entry.name.slice(0, -".attach".length);
   118	            if (cardBasenames.has(owner)) continue;
   119	          }
   120	          const dirFullPath = path.join(resolved, entry.name);
   121	          let fileCount = 0;
   122	          try {
   123	            const subEntries = await fs.readdir(dirFullPath, { recursive: true });
   124	            fileCount = subEntries.filter((f) => typeof f === "string" && f.endsWith(".card")).length;
   125	          } catch (e) {
   126	            // Can't read subdirectory — leave fileCount at 0 rather than failing the whole listing.
   127	            if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
   128	              console.warn(`browse: cannot count cards in ${dirFullPath}:`, e);
   129	            }
   130	          }
   131	          dirs.push({ name: entry.name, fileCount });
   132	          continue;
   133	        }
   134	        const fullPath = path.join(resolved, entry.name);
   135	        const relativePath = path.relative(ctx.boxRoot, fullPath);
   136	
   137	        if (entry.name.endsWith(".card")) {
   138	          const parsed = parseCardName(entry.name);
   139	          if (!parsed) continue;
   140	
   141	          const attachDirName = `${parsed.name}.attach`;
   142	          const hasAttachments = entries.some(
   143	            (e) => e.isDirectory() && e.name === attachDirName,
   144	          );
   145	
   146	          const fm = await loadCardFrontmatter(fullPath);
   147	          if (fm === null) {
   148	            // Card failed to parse — still list it (as unknown) so the UI shows it.
   149	            cards.push({ relativePath, name: parsed.name, type: parsed.type, tagName: "unknown", hasAttachments });
   150	            continue;
   151	          }
   152	          const str = (key: string): string | undefined =>
   153	            typeof fm[key] === "string" ? (fm[key] as string) : undefined;
   154	          cards.push({
   155	            relativePath,
   156	            name: parsed.name,
   157	            type: parsed.type,
   158	            // The filename type is the discriminator (the old XML root tag).
   159	            tagName: parsed.type,
   160	            ...(str("status") !== undefined && { status: str("status") }),
   161	            ...(str("title") !== undefined && { title: str("title") }),
   162	            hasAttachments,
   163	          });
   164	          continue;
   165	        }
   166	
   167	        // Non-card file: list it as a generic file
   168	        files.push({ relativePath, name: entry.name });
   169	      }
   170	
   171	      dirs.sort((a, b) => a.name.localeCompare(b.name));
   172	      cards.sort((a, b) => a.name.localeCompare(b.name));
   173	      files.sort((a, b) => a.name.localeCompare(b.name));
   174	      return { path: input.path, dirs, cards, files };
   175	    }),
   176	});

 succeeded in 0ms:
     1	/**
     2	 * Directory-browse route for the REST API.
     3	 *
     4	 * Split out of `api.ts`. Owns `GET /api/browse/*` — a one-level listing of a
     5	 * box directory that folds `<basename>.attach/` directories into their owning
     6	 * cards and loads each card so the frontend can render status + tag name.
     7	 */
     8	
     9	import type { FastifyInstance } from "fastify";
    10	import * as fs from "node:fs/promises";
    11	import * as path from "node:path";
    12	import { loadCardFrontmatter } from "../../core/frontmatter-field.js";
    13	import { parseCardName } from "../../cli/lib/paths.js";
    14	
    15	interface BrowseCard {
    16	  relativePath: string;
    17	  name: string;
    18	  type: string;
    19	  tagName: string;
    20	  status?: string | undefined;
    21	  hasAttachments?: boolean;
    22	}
    23	
    24	interface RegisterApiBrowseRoutesOptions {
    25	  server: FastifyInstance;
    26	  boxRoot: string;
    27	}
    28	
    29	/**
    30	 * Register the `GET /api/browse/*` directory-listing route on the server.
    31	 */
    32	export function registerApiBrowseRoutes(options: RegisterApiBrowseRoutesOptions): void {
    33	  const { server, boxRoot } = options;
    34	
    35	  // GET /api/browse/* - Browse directory contents (one level)
    36	  server.get<{ Params: { "*": string } }>(
    37	    "/api/browse/*",
    38	    async (request) => {
    39	      const reqPath = request.params["*"] || "";
    40	
    41	      // Resolve the target directory
    42	      const targetDir = reqPath ? path.join(boxRoot, reqPath) : boxRoot;
    43	
    44	      // Security: ensure we stay within boxRoot
    45	      const resolved = path.resolve(targetDir);
    46	      if (!resolved.startsWith(path.resolve(boxRoot))) {
    47	        return { path: reqPath, dirs: [], cards: [] };
    48	      }
    49	
    50	      let entries: Array<{ name: string; isDirectory: () => boolean }>;
    51	      try {
    52	        entries = await fs.readdir(resolved, { withFileTypes: true });
    53	      } catch (e) {
    54	        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
    55	          console.warn(`Could not read directory, returning empty listing: ${resolved}:`, e);
    56	        }
    57	        return { path: reqPath, dirs: [], cards: [] };
    58	      }
    59	
    60	      const dirs: string[] = [];
    61	      const cards: BrowseCard[] = [];
    62	
    63	      // Build basename → owning-card lookup so we can fold `<basename>.attach/`
    64	      // directories into their owning cards (rendered as navigable cards, not
    65	      // as standalone directories).
    66	      const cardBasenames = new Set<string>();
    67	      for (const entry of entries) {
    68	        if (entry.isDirectory()) continue;
    69	        if (!entry.name.endsWith(".card")) continue;
    70	        const parsed = parseCardName(entry.name);
    71	        if (parsed) cardBasenames.add(parsed.name);
    72	      }
    73	
    74	      for (const entry of entries) {
    75	        if (entry.name.startsWith(".")) continue;
    76	
    77	        if (entry.isDirectory()) {
    78	          // Hide `<basename>.attach/` when a sibling card owns it. Stray
    79	          // .attach/ directories (no owning card) still surface for triage.
    80	          if (entry.name.endsWith(".attach")) {
    81	            const owner = entry.name.slice(0, -".attach".length);
    82	            if (cardBasenames.has(owner)) continue;
    83	          }
    84	          dirs.push(entry.name);
    85	          continue;
    86	        }
    87	
    88	        if (!entry.name.endsWith(".card")) continue;
    89	
    90	        const parsed = parseCardName(entry.name);
    91	        if (!parsed) continue;
    92	
    93	        const fullPath = path.join(resolved, entry.name);
    94	        const relativePath = path.relative(boxRoot, fullPath);
    95	        const attachDirName = `${parsed.name}.attach`;
    96	        const hasAttachments = entries.some(
    97	          (e) => e.isDirectory() && e.name === attachDirName,
    98	        );
    99	
   100	        const fm = await loadCardFrontmatter(fullPath);
   101	        const status = fm !== null && typeof fm["status"] === "string" ? fm["status"] : undefined;
   102	        cards.push({
   103	          relativePath,
   104	          name: parsed.name,
   105	          type: parsed.type,
   106	          // The filename type is the discriminator; a card that won't parse is
   107	          // marked unknown.
   108	          tagName: fm === null ? "unknown" : parsed.type,
   109	          ...(status !== undefined && { status }),
   110	          hasAttachments,
   111	        });
   112	      }
   113	
   114	      dirs.sort();
   115	      cards.sort((a, b) => a.name.localeCompare(b.name));
   116	
   117	      return { path: reqPath, dirs, cards };
   118	    }
   119	  );
   120	}

exec
/opt/homebrew/bin/bash -lc "git diff main...HEAD -- callback-box/src/webapp/routes/api-browse.ts callback-box/src/webapp/trpc/routers/status.ts callback-box/src/core/commands/scan-import-cards.ts | sed -n '1,260p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-XnnGdgIr' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-V79Wm4km' (errno=Operation not permitted)
diff --git a/callback-box/src/core/commands/scan-import-cards.ts b/callback-box/src/core/commands/scan-import-cards.ts
index 9820bef1..440b8583 100644
--- a/callback-box/src/core/commands/scan-import-cards.ts
+++ b/callback-box/src/core/commands/scan-import-cards.ts
@@ -17,15 +17,14 @@
 
 import * as fs from "node:fs/promises";
 import * as path from "node:path";
-import type { createLoader } from "../../cli/lib/loader.js";
+import { parseCardText, serializeCardText } from "../card-io.js";
+import { type CardSchema } from "../../cards/index.js";
 import { createImageTemplate } from "../../schemas/image.js";
 import { createTextQuestionTemplate } from "../../schemas/question.js";
 import type { PhotoBundle, OrphanBack, ResolvedPage } from "./scan-import-helpers.js";
 
-type Loader = Awaited<ReturnType<typeof createLoader>>;
-
 interface PhotoBundleEmitContext {
-  loader: Loader;
+  cardSchemas: Map<string, CardSchema>;
   index: number;
   bundle: PhotoBundle;
   startedAt: string;
@@ -39,7 +38,7 @@ interface PhotoBundleEmitContext {
 
 export async function emitPhotoBundle(emitCtx: PhotoBundleEmitContext): Promise<void> {
   const {
-    loader,
+    cardSchemas,
     index,
     bundle,
     startedAt,
@@ -75,7 +74,7 @@ export async function emitPhotoBundle(emitCtx: PhotoBundleEmitContext): Promise<
   });
   const cardPath = path.join(sessionAttachAbsDir, cardFilename);
   await fs.writeFile(cardPath, cardContent);
-  await applyBundleAnalysisToCard(loader, { cardPath, bundle });
+  await applyBundleAnalysisToCard({ cardPath, bundle, cardSchemas });
   filesToStage.push(`${sessionAttachRelDir}/${cardFilename}`);
   imageRefs.push(cardFilename);
 
@@ -165,70 +164,38 @@ export async function emitUnsureQuestion(
 }
 
 async function applyBundleAnalysisToCard(
-  loader: Loader,
-  { cardPath, bundle }: { cardPath: string; bundle: PhotoBundle }
+  { cardPath, bundle, cardSchemas }: { cardPath: string; bundle: PhotoBundle; cardSchemas: Map<string, CardSchema> }
 ): Promise<void> {
-  const card = await loader.load(cardPath);
-  const el = card.element;
+  const content = await fs.readFile(cardPath, "utf-8");
+  const parsed = parseCardText(content, { source: cardPath, schemas: cardSchemas, type: "image" });
+  const fields = { ...parsed.fields };
 
-  el.attrs["status"] = "analyzed";
   const photo = bundle.photo;
   const back = bundle.back;
 
-  const photoTextBlocks = photo.text_blocks.map((b) => ({
-    source: b.source || "photo",
-    text: b.text,
-  }));
+  // The image schema's `text` field is an array of { source, content }.
+  const photoTextBlocks = photo.text_blocks.map((b) => ({ source: b.source || "photo", content: b.text }));
   const backTextBlocks = back
-    ? back.text_blocks.map((b) => ({ source: b.source || "back", text: b.text }))
+    ? back.text_blocks.map((b) => ({ source: b.source || "back", content: b.text }))
     : [];
   const allTextBlocks = [...photoTextBlocks, ...backTextBlocks];
-  const hasText = allTextBlocks.length > 0;
 
-  el.attrs["has-text"] = hasText ? "true" : "false";
-  if (photo.rotation !== 0) {
-    el.attrs["rotation"] = String(photo.rotation);
-  }
+  fields["status"] = "analyzed";
+  fields["has-text"] = allTextBlocks.length > 0;
+  fields["description"] = photo.description;
+  if (photo.rotation !== 0) fields["rotation"] = String(photo.rotation);
 
-  const descChild = el.children.find((c) => c.tagName === "description");
-  if (descChild) descChild.text = photo.description;
-
-  el.children = el.children.filter(
-    (c) =>
-      c.tagName !== "text" &&
-      c.tagName !== "exif" &&
-      c.tagName !== "subject-bbox" &&
-      c.tagName !== "document"
-  );
-
-  for (const block of allTextBlocks) {
-    el.children.push({
-      tagName: "text",
-      attrs: { source: block.source },
-      text: block.text,
-      children: [],
-      comments: {},
-      location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
-      dirty: true,
-    });
-  }
+  if (allTextBlocks.length > 0) fields["text"] = allTextBlocks;
+  else delete fields["text"];
 
   if (photo.subject_bbox && photo.subject_bbox.length === 4) {
-    el.children.push({
-      tagName: "subject-bbox",
-      attrs: {
-        y1: String(photo.subject_bbox[0]),
-        x1: String(photo.subject_bbox[1]),
-        y2: String(photo.subject_bbox[2]),
-        x2: String(photo.subject_bbox[3]),
-      },
-      text: "",
-      children: [],
-      comments: {},
-      location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
-      dirty: true,
-    });
+    fields["subject-bbox"] = {
+      y1: String(photo.subject_bbox[0]),
+      x1: String(photo.subject_bbox[1]),
+      y2: String(photo.subject_bbox[2]),
+      x2: String(photo.subject_bbox[3]),
+    };
   }
 
-  await loader.save(card);
+  await fs.writeFile(cardPath, serializeCardText({ schema: parsed.schema, fields }));
 }
diff --git a/callback-box/src/webapp/routes/api-browse.ts b/callback-box/src/webapp/routes/api-browse.ts
index d783db62..3d2e7567 100644
--- a/callback-box/src/webapp/routes/api-browse.ts
+++ b/callback-box/src/webapp/routes/api-browse.ts
@@ -9,7 +9,7 @@
 import type { FastifyInstance } from "fastify";
 import * as fs from "node:fs/promises";
 import * as path from "node:path";
-import { createLoader } from "../../cli/lib/loader.js";
+import { loadCardFrontmatter } from "../../core/frontmatter-field.js";
 import { parseCardName } from "../../cli/lib/paths.js";
 
 interface BrowseCard {
@@ -60,8 +60,6 @@ export function registerApiBrowseRoutes(options: RegisterApiBrowseRoutesOptions)
       const dirs: string[] = [];
       const cards: BrowseCard[] = [];
 
-      const loader = await createLoader(boxRoot);
-
       // Build basename → owning-card lookup so we can fold `<basename>.attach/`
       // directories into their owning cards (rendered as navigable cards, not
       // as standalone directories).
@@ -99,26 +97,18 @@ export function registerApiBrowseRoutes(options: RegisterApiBrowseRoutesOptions)
           (e) => e.isDirectory() && e.name === attachDirName,
         );
 
-        try {
-          const card = await loader.load(fullPath);
-          cards.push({
-            relativePath,
-            name: parsed.name,
-            type: parsed.type,
-            tagName: card.element.tagName,
-            status: card.element.attrs["status"],
-            hasAttachments,
-          });
-        } catch (e) {
-          console.warn(`Could not load card for browse listing, marking unknown: ${relativePath}:`, e);
-          cards.push({
-            relativePath,
-            name: parsed.name,
-            type: parsed.type,
-            tagName: "unknown",
-            hasAttachments,
-          });
-        }
+        const fm = await loadCardFrontmatter(fullPath);
+        const status = fm !== null && typeof fm["status"] === "string" ? fm["status"] : undefined;
+        cards.push({
+          relativePath,
+          name: parsed.name,
+          type: parsed.type,
+          // The filename type is the discriminator; a card that won't parse is
+          // marked unknown.
+          tagName: fm === null ? "unknown" : parsed.type,
+          ...(status !== undefined && { status }),
+          hasAttachments,
+        });
       }
 
       dirs.sort();
diff --git a/callback-box/src/webapp/trpc/routers/status.ts b/callback-box/src/webapp/trpc/routers/status.ts
index 06c553f3..7dd1e24e 100644
--- a/callback-box/src/webapp/trpc/routers/status.ts
+++ b/callback-box/src/webapp/trpc/routers/status.ts
@@ -4,7 +4,7 @@ import * as path from "node:path";
 import { router, publicProcedure } from "../trpc.js";
 import { getSystemState } from "../../../core/state.js";
 import { generateContext } from "../../context.js";
-import { createLoader } from "../../../cli/lib/loader.js";
+import { loadCardFrontmatter } from "../../../core/frontmatter-field.js";
 import { parseCardName } from "../../../cli/lib/paths.js";
 import { getLog } from "../../../cli/lib/git.js";
 
@@ -97,7 +97,6 @@ export const statusRouter = router({
       const dirs: BrowseDir[] = [];
       const cards: BrowseCard[] = [];
       const files: BrowseFile[] = [];
-      const loader = await createLoader(ctx.boxRoot);
 
       // Build a set of card basenames so we can fold owned `<basename>.attach/`
       // directories into their owning card (cards-as-directories UI).
@@ -144,22 +143,24 @@ export const statusRouter = router({
             (e) => e.isDirectory() && e.name === attachDirName,
           );
 
-          try {
-            const card = await loader.load(fullPath);
-            cards.push({
-              relativePath,
-              name: parsed.name,
-              type: parsed.type,
-              tagName: card.element.tagName,
-              status: card.element.attrs["status"],
-              title: card.element.attrs["title"],
-              hasAttachments,
-            });
-          } catch (e) {
-            // Card failed to load/parse — still list it (as unknown) so the UI shows it.
-            console.warn(`browse: cannot load card ${fullPath}:`, e);
+          const fm = await loadCardFrontmatter(fullPath);
+          if (fm === null) {
+            // Card failed to parse — still list it (as unknown) so the UI shows it.
             cards.push({ relativePath, name: parsed.name, type: parsed.type, tagName: "unknown", hasAttachments });
+            continue;
           }
+          const str = (key: string): string | undefined =>
+            typeof fm[key] === "string" ? (fm[key] as string) : undefined;
+          cards.push({
+            relativePath,
+            name: parsed.name,
+            type: parsed.type,
+            // The filename type is the discriminator (the old XML root tag).
+            tagName: parsed.type,
+            ...(str("status") !== undefined && { status: str("status") }),
+            ...(str("title") !== undefined && { title: str("title") }),
+            hasAttachments,
+          });
           continue;
         }
 

exec
/opt/homebrew/bin/bash -lc "rg -n \"loadCardFile\\(|loadCardFromText\\(|LoadedCard|kind\" callback-box/src callback-box/scripts callback-box/test | head -n 200" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/src/shared/markdoc-config.ts:149:    // anchored against (`version`, space-separated `kind:value` markers — a
callback-box/src/schemas/landmark.ts:96: * one or more *kinds* of content. `for` lists the kinds (e.g. `triage`,
callback-box/src/schemas/landmark.ts:155:  - for: [triage]           # kinds: triage (inbox→triage routing target) and/or commentary
callback-box/src/dev/reports/audit-report-2026-02-27T01-57-41.md:29:> - **Actions** — what kind of response to give (tone, depth, format)
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:1032:> There are several ways to extend this box, depending on what kind of capability you want to add:
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:1094:> That said, some types like **memo**, **record**, and **guide** are fairly flexible and can cover a wide range of content. Is there a specific kind of card you're looking for?
callback-box/test/chat-features.doctest.md:203:  activityChildren: '<card-activity kind="scrolled"/>\n<card-activity kind="explored">boat-water+road -> boats</card-activity>',
callback-box/test/chat-features.doctest.md:206:<card-activity kind="scrolled"/>
callback-box/test/chat-features.doctest.md:207:<card-activity kind="explored">boat-water+road -> boats</card-activity>
callback-box/src/schemas/image.tsx:67:  kind: z.string().optional(),
callback-box/src/schemas/image.tsx:113:  (bill, letter, form, receipt, statement, …). \`kind\` is a short
callback-box/src/schemas/image.tsx:145:  document?: { kind?: string; from?: string; dates?: Array<{ label: string; value: string }> };
callback-box/src/cli/commands/upload.ts:12:  .requiredOption("--as <kind>", "Destination kind (currently: scan)")
callback-box/src/cli/commands/upload.ts:23:        kind: options.as,
callback-box/src/dev/reports/audit-report-2026-02-27T01-35-58.md:141:> What kind of follow-up did you have in mind? I can help you write the specific command and schedule.
callback-box/src/dev/reports/audit-report-2026-02-27T01-35-58.md:266:> I want to make sure I'm looking in the right place — I haven't seen a rule about "the last element" in the docs I've checked so far. What kind of thread are you referring to?
callback-box/src/schemas/chat-thread.ts:20:  kind: z.literal("message"),
callback-box/src/schemas/chat-thread.ts:30:  kind: z.literal("seen"),
callback-box/src/schemas/chat-thread.ts:36:const ThreadEntry = z.discriminatedUnion("kind", [MessageEntry, SeenEntry]);
callback-box/src/schemas/chat-thread.ts:59:Each entry has a \`kind\` discriminator:
callback-box/src/schemas/chat-thread.ts:60:- \`kind: message\` with fields \`sender\`, \`sender-id?\`, \`time?\`, \`sent?\`, \`id?\`, \`text\`
callback-box/src/schemas/chat-thread.ts:61:- \`kind: seen\` with fields \`callback-in?\`, \`wait-for?\`, \`text?\`
callback-box/src/schemas/chat-thread.ts:69:Scan backward from the end of the \`entries:\` array. The last \`kind: seen\` or \`kind: message\` with \`sender: agent\` marks the boundary of what was previously processed. Everything after that boundary is new.
callback-box/src/schemas/chat-thread.ts:77:- A message entry with \`kind: message, sender: agent, text: "Your response"\` — to send a message. Do NOT set \`sent\` or \`id\`; the connector handles delivery.
callback-box/src/schemas/chat-thread.ts:78:- A seen entry with \`kind: seen\` — to acknowledge without responding. Use this for casual/social messages, messages not directed at you, or when there's nothing useful to add.
callback-box/src/schemas/chat-thread.ts:82:- Acknowledge (\`kind: seen\`) casual chatter, messages between other people, or when silence is appropriate
callback-box/src/schemas/chat-thread.ts:86:- \`{kind: seen, callback-in: 30m, text: "Check if anyone answered Alice's question"}\` — you'll be re-invoked in 30 minutes if no new messages arrive
callback-box/src/schemas/chat-thread.ts:143:    kind: "message",
callback-box/src/connectors/chat-utils.ts:133:    if (entry.kind === "message" && entry.sender === "agent" && entry.sent === undefined) {
callback-box/src/connectors/chat-utils.ts:153:      entry.kind === "message" &&
callback-box/src/dev/knowledge-audits.yaml:909:    watch_for: "Treats the activity kinds as low-confidence hints, not assertions of intent; knows modified = data changed"
callback-box/src/dev/knowledge-audits.yaml:913:      The four kinds (scrolled/navigated/explored/modified) are attention hints,
callback-box/src/dev/knowledge-audits.yaml:987:  # form, lists the closed kind set without inventing extras, and picks
callback-box/src/dev/knowledge-audits.yaml:1022:  - id: ack-kinds
callback-box/src/dev/knowledge-audits.yaml:1023:    prompt: "What kind values can <ack kind=\"...\"> use? List them."
callback-box/src/dev/knowledge-audits.yaml:1026:    watch_for: "Lists the closed kind set: created, appended, edited, todo-added, todo-completed, no-response. Doesn't invent extras like 'noted' or 'scheduled'."
callback-box/src/dev/knowledge-audits.yaml:1052:    watch_for: "Recognizes this is a pure-musing dump that warrants no action and no callout. Emits <ack kind=\"no-response\"/> (or just stays completely silent — both are acceptable). Does NOT write 'No response requested' or similar as prose."
callback-box/src/dev/knowledge-audits.yaml:1064:    watch_for: "Picks <ack> with kind=\"appended\". Either omits inner text or notes that inner text isn't needed because the action is obvious from the user's request."
callback-box/src/dev/knowledge-audits.yaml:1070:      agent should emit a bare <ack kind="appended" ref="..."/> — no text.
callback-box/src/dev/knowledge-audits.yaml:2117:  # and replied with a bare `<ack kind="created">` — textbook narration
callback-box/src/dev/knowledge-audits.yaml:2382:      Reaches for `cb search` (not grep) and knows the --kind / --json
callback-box/src/core/reactor/engine.ts:387:    await acquireFileLock(lockPath, { kind: "reactor" });
callback-box/test/scan-import-helpers.doctest.md:17:    kind: "photo",
callback-box/test/scan-import-helpers.doctest.md:35:    kind: "back",
callback-box/test/scan-import-helpers.doctest.md:90:resolved.map(r => `${r.index}:${r.analysis.kind} pair=${r.pairedWith}`).join(" | ")
callback-box/test/scan-import-helpers.doctest.md:164:pages6.set(1, [{ ...back(1), kind: "blank", has_text: false, text_blocks: [] }]);
callback-box/src/cli/commands/search.ts:18:  kind?: string[];
callback-box/src/cli/commands/search.ts:28:  .option("--kind <type...>", "Restrict to one or more card types")
callback-box/src/cli/commands/search.ts:44:        kinds: options.kind,
callback-box/src/webapp/routes/proxy-image.ts:78:  const kind = isIP(ip);
callback-box/src/webapp/routes/proxy-image.ts:79:  if (kind === 4) return isBlockedV4(ip);
callback-box/src/webapp/routes/proxy-image.ts:80:  if (kind === 6) return isBlockedV6(ip);
callback-box/src/schemas/procedure.ts:7: * instructions, and whys by kind (the engine runs them grouped, not
callback-box/src/schemas/procedure.ts:76:Each entry in \`steps\` has optional phases: \`precheck\` (should this step run?), \`run\` (the main action), \`validate\` (did it work?). Each phase groups its actions by kind:
callback-box/src/webapp/routes/chat-helpers.ts:48:   * `card-activity` snapshot attribute. Unrecognized kinds are dropped at
callback-box/src/webapp/routes/chat-helpers.ts:53:   * Per-kind free-text detail for the activity (e.g. the embedding query
callback-box/src/webapp/routes/chat-helpers.ts:55:   * activity kinds; non-kind keys and non-string values are dropped.
callback-box/src/webapp/routes/chat-helpers.ts:91: * kinds only), `cardState` (per-kind detail strings). Everything is filtered
callback-box/src/webapp/routes/chat-helpers.ts:99:  const kinds = Array.isArray(body.cardActivity) ? body.cardActivity.filter(isActivityKind) : [];
callback-box/src/webapp/routes/chat-helpers.ts:100:  if (kinds.length > 0) out.cardActivity = kinds;
callback-box/src/webapp/routes/chat-helpers.ts:103:    for (const [kind, detail] of Object.entries(body.cardState)) {
callback-box/src/webapp/routes/chat-helpers.ts:104:      if (isActivityKind(kind) && typeof detail === "string" && detail !== "") details[kind] = detail;
callback-box/src/connectors/telegram-outbound.ts:114:  if (!lastEntry || lastEntry.kind !== "seen") return;
callback-box/test/reactor-integration.doctest.md:283:  metadata: { kind: "reactor" },
callback-box/test/reactor-integration.doctest.md:314:  metadata: { kind: "reactor" },
callback-box/src/webapp/routes/views.ts:95:          const loaded = await loadCardFile(absPath, ctx);
callback-box/test/connector-telegram.doctest.md:185:  `---\ntype: chat-thread\nchat-id: "999"\nconnector: telegram\nentries:\n  - kind: message\n    sender: TestUser\n    time: "2024-01-01T00:00:00Z"\n    text: Hello\n  - kind: message\n    sender: agent\n    time: "2024-01-01T00:01:00Z"\n    text: Hi there!\n---\n`,
callback-box/src/core/generate-docs-procedure-guide.ts:90:Each phase (\`precheck\`/\`run\`/\`validate\`) groups its actions by kind: \`shells\`, \`agents\`, \`instructions\`, \`whys\` — each a list. Use YAML block scalars (\`|\`) for multi-line scripts and prompts.
callback-box/src/schemas/guide-templates.tsx:150:        instructions: "Append an entry to the thread's entries[] with kind: message, sender: agent, and text: <your reply>. Keep it conversational and concise.",
callback-box/src/schemas/guide-templates.tsx:155:        instructions: "Append an entry to entries[] with kind: seen. Optionally include text (note-to-self) and callback-in.",
callback-box/src/schemas/guide-templates.tsx:160:        instructions: "Append an entry to entries[] with kind: seen, callback-in: 30m (or other duration), and text: <what to check>. Schedules a re-invocation.",
callback-box/src/schemas/guide-templates.tsx:175:      approach: "Start conservative, observe what kinds of messages get follow-up questions when ignored",
callback-box/test/migrate-webpage-card.doctest.md:73:const wp = await loadCardFromText({ content: wpText, source: "store/reading/Foo.webpage.card", ctx });
callback-box/test/migrate-webpage-card.doctest.md:74:[wp.kind, wp.schema.type, wp.fields.source].join("|")
callback-box/test/migrate-webpage-card.doctest.md:77:const cm = await loadCardFromText({ content: cmText, source: "store/reading/Foo.attach/Foo.commentary.card", ctx });
callback-box/test/migrate-webpage-card.doctest.md:78:[cm.kind, cm.schema.type].join("|")
callback-box/test/migrate-webpage-card.doctest.md:148:const wp = await loadCardFromText({ content: wpText, source: "box/inbox/pages-saved/Bar.webpage.card", ctx });
callback-box/src/core/asset-manifest-scan.ts:34:  kind: "missing-file";
callback-box/src/core/asset-manifest-scan.ts:41:  kind: "hash-mismatch";
callback-box/src/core/asset-manifest-scan.ts:48:  kind: "manifest-malformed";
callback-box/src/core/asset-manifest-scan.ts:178:      kind: "manifest-malformed",
callback-box/src/core/asset-manifest-scan.ts:263:        kind: "hash-mismatch",
callback-box/src/core/asset-manifest-scan.ts:275:      kind: "missing-file",
callback-box/test/view-url.doctest.md:69:=> {"kind":"view","raw":"view:store/a.md"}
callback-box/test/view-url.doctest.md:72:=> {"kind":"relative","path":"notes.md"}
callback-box/test/view-url.doctest.md:75:=> {"kind":"relative","path":"../sibling.md"}
callback-box/test/view-url.doctest.md:78:=> {"kind":"external"}
callback-box/test/view-url.doctest.md:81:=> {"kind":"external"}
callback-box/test/view-url.doctest.md:84:=> {"kind":"external"}
callback-box/src/core/preactions/index.ts:90:    const loaded = await loadCardFile(cardPath, await buildLoadContext(boxRoot));
callback-box/test/asset-manifest-scan.doctest.md:139:print(`error kind: ${r.errors[0].kind}`);
callback-box/test/asset-manifest-scan.doctest.md:144:error kind: hash-mismatch
callback-box/test/asset-manifest-scan.doctest.md:164:print(`error kind: ${r.errors[0].kind}`);
callback-box/test/asset-manifest-scan.doctest.md:168:error kind: missing-file
callback-box/test/landmark-schema.doctest.md:362:## Destinations: `for` kinds
callback-box/test/landmark-schema.doctest.md:364:`findDestination` locates the destination advertising a given kind among
callback-box/test/retro-scan.doctest.md:70:  kind: "correction",
callback-box/test/retro-scan.doctest.md:105:ledger.map((e) => `${e.kind} ${e.sessionId} ${e.runId}: ${e.proposal}`).join("\n")
callback-box/test/parse-tags.doctest.md:125:paired ack form (`<ack kind="…">note</ack>`) hits exactly this.
callback-box/test/parse-tags.doctest.md:131:const tags = parseTags('<speech>hi</speech> <ack kind="appended" ref="x.card">a note</ack>', ["speech"]);
callback-box/test/structured-output-parsing.doctest.md:24:## Ack kinds registry
callback-box/test/structured-output-parsing.doctest.md:26:The closed set of recognized kinds.
callback-box/test/structured-output-parsing.doctest.md:29:ACK_KINDS.map((k) => k.kind).join(",")
callback-box/test/structured-output-parsing.doctest.md:39:## parseAcks — valid kinds
callback-box/test/structured-output-parsing.doctest.md:44:JSON.stringify(parseAcks("<ack kind=\"appended\" ref=\"a.card\"/>"))
callback-box/test/structured-output-parsing.doctest.md:45:=> [{"kind":"appended","ref":"a.card"}]
callback-box/test/structured-output-parsing.doctest.md:51:JSON.stringify(parseAcks("<ack kind=\"edited\" ref=\"a.md\">Reworked the intro</ack>"))
callback-box/test/structured-output-parsing.doctest.md:52:=> [{"kind":"edited","ref":"a.md","text":"Reworked the intro"}]
callback-box/test/structured-output-parsing.doctest.md:58:JSON.stringify(parseAcks("<ack kind=\"noted\"></ack>"))
callback-box/test/structured-output-parsing.doctest.md:61:JSON.stringify(parseAcks("<ack kind=\"created\"></ack>"))
callback-box/test/structured-output-parsing.doctest.md:62:=> [{"kind":"created"}]
callback-box/test/structured-output-parsing.doctest.md:69:Unknown kinds are silently dropped (with a console warning the caller
callback-box/test/structured-output-parsing.doctest.md:70:can ignore). Acks with no `kind` attribute are also dropped.
callback-box/test/structured-output-parsing.doctest.md:73:JSON.stringify(parseAcks("<ack kind=\"frob\"/>"))
callback-box/test/structured-output-parsing.doctest.md:84:  "prose <ack kind=\"created\" ref=\"a.card\"/> more <ack kind=\"frob\"/> end"
callback-box/test/structured-output-parsing.doctest.md:86:=> [{"kind":"created","ref":"a.card"}]
callback-box/test/structured-output-parsing.doctest.md:130:stripStructuredOutputTags("hello <ack kind=\"created\"/> world")
callback-box/test/structured-output-parsing.doctest.md:148:stripStructuredOutputTags("<chat-app prose=\"on\" open-card=\"x\">\n<card-activity kind=\"explored\">king -> chief</card-activity>\n</chat-app>kept")
callback-box/test/card-io.doctest.md:146:const loaded = await loadCardFromText({ content: text, source: "thread.email-thread.card", ctx });
callback-box/test/card-io.doctest.md:147:loaded.kind
callback-box/test/card-io.doctest.md:150:loaded.kind === "frontmatter" ? loaded.schema.type : "?"
callback-box/test/card-io.doctest.md:153:loaded.kind === "frontmatter" ? loaded.fields["thread-id"] : "?"
callback-box/test/card-io.doctest.md:157:Job cards use the dotted filename convention `Foo.<kind>.job.card` (the
callback-box/test/card-io.doctest.md:173:const loaded = await loadCardFromText({ content, source: "2026-06-09-gmail.intake.job.card", ctx: registryCtx });
callback-box/test/card-io.doctest.md:174:loaded.kind
callback-box/test/card-io.doctest.md:177:loaded.kind === "frontmatter" ? loaded.schema.type : "?"
callback-box/test/card-io.doctest.md:186:  try { await loadCardFromText({ content, source, ctx }); return "did not throw"; }
callback-box/test/box-schemas.doctest.md:25:    await loadCardFromText({ content, source, ctx });
callback-box/test/box-schemas.doctest.md:73:const card = await loadCardFromText({ content: WIDGET_CARD, source: "My.widget.card", ctx });
callback-box/test/box-schemas.doctest.md:74:[card.kind, card.schema.type, card.fields.size, card.fields.status, card.fields.body].join("|")
callback-box/test/chat-card-activity.doctest.md:4:the card open in the chat's two-pane companion layout. The four kinds project
callback-box/test/chat-card-activity.doctest.md:19:## Recognizing kinds
callback-box/test/chat-card-activity.doctest.md:31:`renderActivityChildren` emits one `<card-activity>` element per kind, in
callback-box/test/chat-card-activity.doctest.md:32:canonical order, dropping unrecognized kinds. A kind with a detail carries it as
callback-box/test/chat-card-activity.doctest.md:38:=> <card-activity kind="scrolled"/>
callback-box/test/chat-card-activity.doctest.md:41:=> <card-activity kind="explored">boat-water+road -> boats</card-activity>
callback-box/test/chat-card-activity.doctest.md:50:Multiple kinds come out in canonical order regardless of arrival order, one per
callback-box/test/chat-card-activity.doctest.md:55:=> "<card-activity kind=\"scrolled\"/>\n<card-activity kind=\"explored\">a &lt; b &amp; c</card-activity>"
callback-box/test/chat-card-activity.doctest.md:61:dropping unrecognized kinds. It backs the queued-send combine so an earlier
callback-box/test/chat-card-activity.doctest.md:75:## Per-kind detail (card-state)
callback-box/test/chat-card-activity.doctest.md:77:`reportActivity(kind, detail)` attaches a free-text detail per kind, carried as
callback-box/test/chat-card-activity.doctest.md:79:latest-wins per kind, dropping unrecognized kinds and empty strings — so a later
callback-box/test/chat-card-activity.doctest.md:80:queued send's detail for a kind overrides an earlier one.
callback-box/test/search-index.doctest.md:25:## Build: searchable cards index, operational kinds don't
callback-box/test/search-index.doctest.md:136:## Standalone .md files index as kind "markdown"; attach-scope files don't
callback-box/test/search-index.doctest.md:147:mdHit.hits[0].document.kind
callback-box/src/core/landmark/destination.ts:6: * names the kinds it accepts:
callback-box/src/core/landmark/destination.ts:19:/** Destination kinds the system understands. `for` may list any subset. */
callback-box/src/core/landmark/destination.ts:24: * Find the destination advertising `kind` among a landmark's `destinations`,
callback-box/src/core/landmark/destination.ts:29:  kind: DestinationKind,
callback-box/src/core/landmark/destination.ts:33:    if (dest.for.includes(kind)) return dest;
callback-box/src/core/commands/scan-import-reconcile.ts:80:  if (a.kind !== b.kind || a.paired_with_index !== b.paired_with_index) {
callback-box/src/core/commands/scan-import-reconcile.ts:98:    kind: "unsure",
callback-box/src/core/commands/scan-import-reconcile.ts:148:    if (a.kind === "blank") {
callback-box/src/core/commands/scan-import-reconcile.ts:153:    if (a.kind === "unsure") {
callback-box/src/core/commands/scan-import-reconcile.ts:158:    if (a.kind === "photo") {
callback-box/src/core/commands/scan-import-reconcile.ts:163:    if (a.kind === "back") {
callback-box/src/core/commands/scan-import-reconcile.ts:190:    if (partner && partner.analysis.kind === "back" && !used.has(partner.index)) {
callback-box/test/search-extract.doctest.md:4:documents when the body is long. Per-kind frontmatter folds into searchable
callback-box/test/search-extract.doctest.md:23:  const card = await loadCardFromText({ content: text, source: path, ctx });
callback-box/test/search-extract.doctest.md:42:docs[0].kind
callback-box/test/search-extract.doctest.md:74:JSON.stringify(declareInputFiles({ path: "box/inbox/email/t.attach/msg-001.email-message.card", card: await loadCardFromText({ content: "---\nmessage-id: \"<m1@example.com>\"\nthread-id: t1\nfrom: a@x.com\ndate: 2026-05-14T19:00:00Z\nsubject: s\nbody-file:\n  ref: attach/msg-001.body.txt\n---\n", source: "box/inbox/email/t.attach/msg-001.email-message.card", ctx }) }))
callback-box/test/search-extract.doctest.md:102:const card = await loadCardFromText({ content: cardText, source: path, ctx });
callback-box/test/search-extract.doctest.md:150:docs.every((d) => d.kind === "doc" && d.title === "The Analytical Engine")
callback-box/test/upload-helpers.doctest.md:26:    kind: "scan",
callback-box/test/upload-helpers.doctest.md:88:addEntry(l2, entry("deadbeef", { kind: "scan", sessionRelDir: "box/inbox/scan-y" }));
callback-box/test/upload-helpers.doctest.md:150:groups.map(g => `${g.kind}:${g.label}=${g.files.length}`).join(" | ")
callback-box/test/upload-helpers.doctest.md:163:groups2.map(g => `${g.kind}:${g.label}=${g.files.length}`).join(" | ")
callback-box/test/upload-helpers.doctest.md:179:groups3.map(g => `${g.kind}:${g.label}=${g.files.length}`).join(" | ")
callback-box/test/upload-helpers.doctest.md:189:groups4.map(g => `${g.kind}:${g.label}=${g.files.length}`).join(" | ")
callback-box/test/upload-helpers.doctest.md:203:groups5.map(g => `${g.kind}:${g.label}=${g.files.length}`).join(" | ")
callback-box/src/core/commands/upload-helpers.ts:39:  kind: "image-batch" | "pdf";
callback-box/src/core/commands/upload-helpers.ts:86:      kind: "pdf",
callback-box/src/core/commands/upload-helpers.ts:108:    groups.push({ kind: "image-batch", files: paths, label: prefix });
callback-box/src/core/commands/upload-helpers.ts:111:    groups.push({ kind: "image-batch", files: unmatched.toSorted(), label: "(loose images)" });
callback-box/src/core/commands/upload-helpers.ts:126:  /** Destination kind (e.g. "scan"). */
callback-box/src/core/commands/upload-helpers.ts:127:  kind: string;
callback-box/src/core/landmark/list-destinations.ts:2: * List the landmark destinations of a given kind across a box.
callback-box/src/core/landmark/list-destinations.ts:5: * kind (see `destination.ts`). Used by the clerk commentary endpoint to
callback-box/src/core/landmark/list-destinations.ts:7: * <kind> go?".
callback-box/src/core/landmark/list-destinations.ts:33:  kind: DestinationKind,
callback-box/src/core/landmark/list-destinations.ts:53:    if (findDestination(fields.destinations, kind) === null) continue;
callback-box/src/core/chat-session-prompts.ts:109:When the user has done something to the \`open-card\` since your last reply, the snapshot is a paired tag with one \`<card-activity kind="…">\` child element per kind of activity (a self-closing \`<chat-app …/>\` means nothing happened). Read these as **low-confidence hints about attention, not assertions of intent** — don't narrate them back or assume why. The kinds, least → most consequential: \`scrolled\` = paged through it (passive); \`navigated\` = followed a link to other content (active reading); \`explored\` = changed the view's parameters without changing data; \`modified\` = changed the underlying data. The element's text, when present, is a free-text **detail** the view supplied (e.g. \`<card-activity kind="explored">boat-water+road -> boats</card-activity>\`, or a modified path) — the closest you get to "what the user is looking at right now," still a hint, not the rendered card. For the precise change (which files, which commits), don't guess — run \`cb chat whats-changed\` (add \`--card <path>\` to scope to the open card); it reports commits since your last reply plus the uncommitted working tree. Example:
callback-box/src/core/chat-session-prompts.ts:113:<card-activity kind="scrolled"/>
callback-box/src/core/chat-session-prompts.ts:114:<card-activity kind="explored">boat-water+road -> boats</card-activity>
callback-box/src/core/chat-session-prompts.ts:127:  \`<ack kind="appended" ref="recipes/Bread.recipe.card"/>\`
callback-box/src/core/chat-session-prompts.ts:128:  \`<ack kind="edited" ref="docs/plan.md">Restructured the proofing section</ack>\`
callback-box/src/core/chat-session-prompts.ts:130:The \`kind\` attribute is required and must be one of:
callback-box/src/core/chat-session-prompts.ts:138:If no kind fits an action-style ack, don't use \`<ack>\` — write prose or a \`<callout>\` instead. Use inner text **conservatively**: omit it when the action is the obvious thing the user asked for; include it only when you did something the user couldn't have predicted from their input. Don't emit \`<ack kind="no-response"/>\` and other acks together — the no-response tag means "I literally did nothing."
callback-box/src/core/commands/describe-images-card.ts:102:    if (analysis.document_kind) doc.kind = analysis.document_kind;
callback-box/src/core/commands/describe-images.ts:138:    if (analysis.document_kind) parts.push(`kind=${analysis.document_kind}`);
callback-box/src/core/chat-card-activity.ts:7: * The four kinds describe, terse and referentially, what the user did to the
callback-box/src/core/chat-card-activity.ts:14: * Each kind can also carry an optional free-text **detail** string (e.g. the
callback-box/src/core/chat-card-activity.ts:16: * supplies via `reportActivity(kind, detail)`. Both ride the snapshot as
callback-box/src/core/chat-card-activity.ts:17: * `<card-activity kind="…">detail</card-activity>` child elements of
callback-box/src/core/chat-card-activity.ts:19: * Details are kept per-kind and latest-wins — typing `b`,`bo`,`boa`,`boat`
callback-box/src/core/chat-card-activity.ts:34:/** True if the string is one of the four recognized activity kinds. */
callback-box/src/core/chat-card-activity.ts:41: * list, dropping unrecognized kinds. Used to combine queued sends so an
callback-box/src/core/chat-card-activity.ts:54:/** Per-kind detail strings supplied via `reportActivity(kind, detail)`. */
callback-box/src/core/chat-card-activity.ts:58: * Merge several detail maps into one, latest-wins per kind, dropping

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/webapp/routes/views.ts | sed -n '80,170p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/preactions/index.ts | sed -n '60,130p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/core/frontmatter-field.ts | sed -n '1,180p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
    60	
    61	        if (result.modified) {
    62	          await persistContext(ctx);
    63	        }
    64	
    65	        if (result.error !== undefined && result.error !== "") {
    66	          console.log(`    Error: ${result.error}`);
    67	        } else if (result.message !== undefined && result.message !== "") {
    68	          console.log(`    ${result.message}`);
    69	        }
    70	      }
    71	    } catch (error) {
    72	      console.error(`  Pre-action ${action.name} failed:`, error);
    73	      results.push({
    74	        name: action.name,
    75	        result: { modified: false, error: (error as Error).message },
    76	      });
    77	    }
    78	  }
    79	
    80	  return results;
    81	}
    82	
    83	async function buildContext(input: {
    84	  boxRoot: string;
    85	  cardPath: string;
    86	}): Promise<PreActionContext | null> {
    87	  const { boxRoot, cardPath } = input;
    88	
    89	  try {
    90	    const loaded = await loadCardFile(cardPath, await buildLoadContext(boxRoot));
    91	    return {
    92	      boxRoot,
    93	      cardPath,
    94	      cardType: loaded.schema.type,
    95	      frontmatter: { schema: loaded.schema, fields: loaded.fields },
    96	    };
    97	  } catch (e) {
    98	    // Couldn't load as a known card — skip pre-actions for this file.
    99	    console.warn(`Could not load card for pre-actions: ${cardPath}:`, e);
   100	    return null;
   101	  }
   102	}
   103	
   104	async function persistContext(ctx: PreActionContext): Promise<void> {
   105	  // Rewrite the file with the (possibly mutated) fields.
   106	  await writeFile(ctx.cardPath, `---\n${stringifyYaml(ctx.frontmatter.fields)}---\n`);
   107	}
   108	
   109	registerPreAction(transcribePreAction);

 succeeded in 0ms:
     1	/**
     2	 * Dotted-path frontmatter field lookup for card files.
     3	 *
     4	 * Shared by the landmark navigation resolver (`landmark/resolve.ts`) and the
     5	 * `cb ls --format` command (`commands/ls.ts`). Both read a scalar field out of
     6	 * a card's YAML frontmatter by a dotted path — this replaces the old
     7	 * XPath-over-XML evaluation now that cards are YAML frontmatter.
     8	 */
     9	
    10	import * as fs from "node:fs/promises";
    11	import { parse as parseYaml } from "yaml";
    12	import { splitCardContent } from "../cards/index.js";
    13	
    14	/**
    15	 * Read a dotted field path out of a frontmatter mapping. `title` →
    16	 * `frontmatter.title`; `exif.camera` walks nested mappings. Missing or
    17	 * non-scalar values render as the empty string.
    18	 */
    19	export function lookupField(frontmatter: Record<string, unknown>, expr: string): string {
    20	  let cursor: unknown = frontmatter;
    21	  for (const key of expr.split(".")) {
    22	    if (cursor === null || typeof cursor !== "object") return "";
    23	    cursor = (cursor as Record<string, unknown>)[key];
    24	  }
    25	  if (cursor === null || cursor === undefined) return "";
    26	  if (typeof cursor === "object") return "";
    27	  return String(cursor);
    28	}
    29	
    30	/**
    31	 * Read + parse a card file's frontmatter mapping. Returns null when the file
    32	 * can't be read, has no frontmatter block, or the frontmatter isn't a YAML
    33	 * mapping (malformed YAML, an array, a scalar).
    34	 */
    35	export async function loadCardFrontmatter(absPath: string): Promise<Record<string, unknown> | null> {
    36	  let content: string;
    37	  try {
    38	    content = await fs.readFile(absPath, "utf-8");
    39	  } catch (_e) {
    40	    return null;
    41	  }
    42	  const split = splitCardContent(content);
    43	  if (!split.hasFrontmatter) return null;
    44	  let fm: unknown;
    45	  try {
    46	    fm = parseYaml(split.frontmatterText);
    47	  } catch (_e) {
    48	    return null;
    49	  }
    50	  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) return null;
    51	  return fm as Record<string, unknown>;
    52	}

 succeeded in 0ms:
    80	      const filePaths = new Set<string>();
    81	      for (const pattern of dependencies) {
    82	        const matches = await glob(pattern, { cwd: boxRoot, nodir: true });
    83	        for (const m of matches) {
    84	          if (m.endsWith(".card")) cardPaths.add(m);
    85	          else filePaths.add(m);
    86	        }
    87	      }
    88	
    89	      const ctx = await buildLoadContext(boxRoot);
    90	      const cards: ViewCard[] = [];
    91	
    92	      for (const relPath of cardPaths) {
    93	        try {
    94	          const absPath = path.join(boxRoot, relPath);
    95	          const loaded = await loadCardFile(absPath, ctx);
    96	          const viewCard = frontmatterViewCard(relPath, loaded.fields);
    97	          const attachments = await listAttachments(boxRoot, relPath);
    98	          if (attachments.length > 0) {
    99	            viewCard.attachments = attachments;
   100	          }
   101	          cards.push(viewCard);
   102	        } catch (_e) {
   103	          // Skip cards that fail to load (validation errors, etc.)
   104	        }
   105	      }
   106	
   107	      const files: ViewFile[] = [];
   108	      for (const relPath of [...filePaths].toSorted()) {
   109	        const meta = await statViewFile(boxRoot, relPath);
   110	        if (meta !== null) files.push(meta);
   111	      }
   112	
   113	      // Annotate git working-tree state so views can show unsaved/uncommitted
   114	      // indicators and decide when to offer a commit affordance.
   115	      const gitStatusOf = await buildGitStatusLookup(boxRoot);
   116	      if (gitStatusOf !== null) {
   117	        for (const file of files) annotateGitStatus(file, gitStatusOf);
   118	        for (const card of cards) {
   119	          for (const att of card.attachments ?? []) annotateGitStatus(att, gitStatusOf);
   120	        }
   121	      }
   122	
   123	      return { cards, files };
   124	    }
   125	  );
   126	}
   127	
   128	/** Phase-2 card → ViewCard: parsed fields in `frontmatter`, body split out. */
   129	function frontmatterViewCard(relPath: string, fields: Record<string, unknown>): ViewCard {
   130	  const frontmatter: Record<string, unknown> = {};
   131	  let body: string | undefined;
   132	  for (const [key, value] of Object.entries(fields)) {
   133	    if (key === "type") continue;
   134	    if (key === "body") {
   135	      // The body field is always named `body` — enforced by cardSchema().
   136	      if (typeof value === "string") body = value;
   137	      continue;
   138	    }
   139	    frontmatter[key] = value;
   140	  }
   141	  const type = fields["type"];
   142	  const viewCard: ViewCard = {
   143	    path: relPath,
   144	    tagName: typeof type === "string" ? type : "",
   145	    attrs: {},
   146	    frontmatter,
   147	  };
   148	  if (body !== undefined) viewCard.body = body;
   149	  if (typeof frontmatter["status"] === "string") viewCard.status = frontmatter["status"];
   150	  return viewCard;
   151	}
   152	
   153	type GitStatusLookup = (relPath: string) => "dirty" | "untracked" | null;
   154	
   155	/**
   156	 * One repo-wide status call mapped to a per-path lookup. Untracked entries
   157	 * from porcelain can be whole directories ("?? new-dir/"), so untracked
   158	 * matching is prefix-aware; dirty (modified/staged) entries are exact.
   159	 */
   160	async function buildGitStatusLookup(boxRoot: string): Promise<GitStatusLookup | null> {
   161	  if (!(await isRepo(boxRoot))) return null;
   162	  const status = await getStatus(boxRoot);
   163	  const dirty = new Set([...status.modified, ...status.staged]);
   164	  const untracked = status.untracked;
   165	  return (relPath: string) => {
   166	    if (dirty.has(relPath)) return "dirty";
   167	    for (const entry of untracked) {
   168	      if (entry === relPath || (entry.endsWith("/") && relPath.startsWith(entry))) {
   169	        return "untracked";
   170	      }

exec
/opt/homebrew/bin/bash -lc "rg -n \"createCardSchemaMap\\(\\)|createCardSchemaMap\\(["'^)]*'"\\)\" callback-box/src/core/commands callback-box/src/connectors callback-box/src/cli callback-box/src/webapp | sed -n '1,220p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/src/core/commands/describe-images-card.ts:23:    schemas: await createCardSchemaMap(),
callback-box/src/core/commands/describe-images-card.ts:31:    schemas: await createCardSchemaMap(),
callback-box/src/core/commands/scan-import.ts:206:  const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
callback-box/src/core/commands/answer.ts:55:      schemas: await createCardSchemaMap(),
callback-box/src/core/commands/assemble-timeline-helpers.ts:17:      schemas: await createCardSchemaMap(),
callback-box/src/core/commands/assemble-timeline-helpers.ts:33:      schemas: await createCardSchemaMap(),
callback-box/src/core/commands/transcribe-captures.ts:36:    schemas: await createCardSchemaMap(),
callback-box/src/core/commands/transcribe-captures.ts:44:    schemas: await createCardSchemaMap(),
callback-box/src/connectors/telegram-output-cards.ts:52:      const card = parseCardText(content, { source: relPath, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/connectors/gmail-drafts.ts:135:    schemas: await createCardSchemaMap(opts.boxRoot),
callback-box/src/connectors/gmail-drafts.ts:234:      schemas: await createCardSchemaMap(),
callback-box/src/webapp/context.ts:32:  const schemas = await createCardSchemaMap(root);
callback-box/src/webapp/routes/scheduler.ts:116:        const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/cli/commands/scheduled.ts:53:        const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/cli/commands/tick-utils.ts:71:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/webapp/trpc/routers/scheduler-schedules.ts:144:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/cli/commands/tick.ts:104:      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
callback-box/src/webapp/trpc/routers/todos.ts:65:      const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
callback-box/src/webapp/trpc/routers/scheduler.ts:152:      const card = parseCardText(content, { source: fileName, schemas: await createCardSchemaMap(ctx.boxRoot) });
callback-box/src/webapp/trpc/routers/card.ts:134:        const cardSchemas = await createCardSchemaMap(ctx.boxRoot);

codex
The scan-import rewrite looks structurally sound against `ImageSchema`: it writes `status`, boolean `has-text`, string enum `rotation`, `text: [{source, content}]`, and `subject-bbox` as the schema expects. I’m doing one last pass for deploy/runtime drift and stale references before I rank the findings.
exec
/opt/homebrew/bin/bash -lc 'git show main:cardworks/src/loader/loader.ts | rg -n "resolveRef|projectRoot|currentFile|NodeFileSystem|lintCard|listCards" -C 3' in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-jlrnGpbM' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-dWUbijiO' (errno=Operation not permitted)
2-import type { ElementNode } from "../parser/provenance.js";
3-import { parseCard } from "../parser/parse.js";
4-import { serialize as serializeElement } from "../serialize/serialize.js";
5:import { resolveRef, resolveRefs, type ResolvedRef } from "../refs/resolve.js";
6:import { NodeFileSystem } from "../fs/node-fs.js";
7-import { MemoryFileSystem } from "../fs/memory-fs.js";
8-import { SchemaRegistry } from "../schema/registry.js";
9-import { formatValidationError } from "../schema/format-error.js";
--
72-
73-/**
74- * Constructor arguments for {@link BaseCardLoader}, grouping the filesystem
75: * and loader options that come after the positional `projectRoot`.
76- */
77-interface BaseCardLoaderArgs {
78-  fs: FileSystem;
--
89-  protected readonly fs: FileSystem;
90-
91-  constructor(
92:    protected readonly projectRoot: string,
93-    { fs, options }: BaseCardLoaderArgs
94-  ) {
95-    this.fs = fs;
--
202-   * @param fromPath - The path of the file containing the reference
203-   * @returns The resolved reference result
204-   */
205:  async resolveRef(ref: string, fromPath: string): Promise<ResolvedRef> {
206:    return resolveRef(ref, {
207-      fs: this.fs,
208:      projectRoot: this.projectRoot,
209:      currentFile: fromPath,
210-    });
211-  }
212-
--
217-   * @param fromPath - The path of the file containing the references
218-   * @returns Array of resolved reference results
219-   */
220:  async resolveRefs(refs: string, fromPath: string): Promise<ResolvedRef[]> {
221:    return resolveRefs(refs, {
222-      fs: this.fs,
223:      projectRoot: this.projectRoot,
224:      currentFile: fromPath,
225-    });
226-  }
227-
--
239-   * Get the project root directory.
240-   */
241-  getProjectRoot(): string {
242:    return this.projectRoot;
243-  }
244-
245-  /**
--
320-    }
321-
322-    // Find all card files and update references
323:    const cardFiles = await this.listCards();
324-
325-    for (const cardPath of cardFiles) {
326-      // Skip the card being moved (we'll move it, not update refs in it)
--
365-  /**
366-   * List all card files in the project.
367-   */
368:  async listCards(): Promise<string[]> {
369:    return this.fs.glob(this.projectRoot, "**/*.card");
370-  }
371-
372-  /**
--
377-   */
378-  async findIncomingRefs(targetPath: string): Promise<CardReference[]> {
379-    const results: CardReference[] = [];
380:    const cardFiles = await this.listCards();
381-
382-    for (const cardPath of cardFiles) {
383-      // Skip the target card itself
--
419-   * Build the context passed to the reference-traversal helpers.
420-   */
421-  private refContext(): RefTraversalContext {
422:    return { fs: this.fs, projectRoot: this.projectRoot };
423-  }
424-}
425-
--
435- * ```
436- */
437-export class CardLoader extends BaseCardLoader {
438:  constructor(projectRoot: string, options?: CardLoaderOptions) {
439:    super(projectRoot, { fs: new NodeFileSystem(), options: options ?? {} });
440-  }
441-}
442-
--
457-export class MemoryCardLoader extends BaseCardLoader {
458-  private memoryFs: MemoryFileSystem;
459-
460:  constructor(projectRoot: string, options?: MemoryCardLoaderOptions) {
461-    options = options ?? {};
462-    const memoryFs = new MemoryFileSystem(options.files ?? {});
463:    super(projectRoot, { fs: memoryFs, options });
464-    this.memoryFs = memoryFs;
465-  }
466-

exec
/opt/homebrew/bin/bash -lc "git show main:cardworks/src/fs/node-fs.ts | nl -ba | sed -n '1,140p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
exec
/opt/homebrew/bin/bash -lc "git show main:callback-box/src/cli/lib/loader.ts | nl -ba | sed -n '1,140p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-ob5OKkjg' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-kgxyWYcB' (errno=Operation not permitted)
     1	/**
     2	 * CardLoader factory for callback box.
     3	 *
     4	 * Creates a configured CardLoader instance with all known schemas.
     5	 */
     6	
     7	import { CardLoader, MemoryCardLoader, type CardLoaderOptions } from "cardworks";
     8	import { createSchemaRegistry } from "../../schemas/registry.js";
     9	
    10	export interface CreateLoaderOptions {
    11	  /** Whether to require version attributes on cards */
    12	  requireVersion?: boolean;
    13	  /** Whether to indent serialized XML */
    14	  indent?: boolean;
    15	}
    16	
    17	/**
    18	 * Create a CardLoader for the given box root.
    19	 *
    20	 * Loads both built-in schemas and any box-local schemas from config/schemas/.
    21	 *
    22	 * @param boxRoot - The root directory of the callback box
    23	 * @param options - Optional configuration
    24	 * @returns A configured CardLoader
    25	 */
    26	export async function createLoader(
    27	  boxRoot: string,
    28	  options?: CreateLoaderOptions
    29	): Promise<CardLoader> {
    30	  options = options ?? {};
    31	  const loaderOptions: CardLoaderOptions = {
    32	    schemas: await createSchemaRegistry(boxRoot),
    33	    requireVersion: options.requireVersion ?? false,
    34	    indent: options.indent ?? false,
    35	  };
    36	
    37	  return new CardLoader(boxRoot, loaderOptions);
    38	}
    39	
    40	/**
    41	 * Parameters for createMemoryLoader
    42	 */
    43	export interface CreateMemoryLoaderParams {
    44	  projectRoot: string;
    45	  files?: Record<string, string>;
    46	  options?: CreateLoaderOptions;
    47	}
    48	
    49	/**
    50	 * Create an in-memory CardLoader for testing.
    51	 *
    52	 * @param params - Parameters object
    53	 * @returns A configured MemoryCardLoader
    54	 */
    55	export async function createMemoryLoader(
    56	  params: CreateMemoryLoaderParams
    57	): Promise<MemoryCardLoader> {
    58	  const { projectRoot } = params;
    59	  const files = params.files ?? {};
    60	  const options = params.options ?? {};
    61	  return new MemoryCardLoader(projectRoot, {
    62	    schemas: await createSchemaRegistry(),
    63	    requireVersion: options.requireVersion ?? false,
    64	    indent: options.indent ?? false,
    65	    files,
    66	  });
    67	}
    68	
    69	// Re-export CardLoader types for convenience
    70	export { CardLoader, MemoryCardLoader, ValidationError } from "cardworks";
    71	export type { ICardLoader, CardLoaderOptions } from "cardworks";

 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-NDzyye1g' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-HngPNMwY' (errno=Operation not permitted)
     1	import * as fs from "node:fs/promises";
     2	import * as path from "node:path";
     3	import type { FileSystem } from "./types.js";
     4	import { GLOB_SKIP_DIRS } from "./glob-skip.js";
     5	
     6	/**
     7	 * Context for a recursive directory walk, invariant across the recursion.
     8	 */
     9	interface WalkDirOptions {
    10	  basePath: string;
    11	  pattern: RegExp;
    12	  results: string[];
    13	}
    14	
    15	/**
    16	 * Node.js filesystem implementation.
    17	 */
    18	export class NodeFileSystem implements FileSystem {
    19	  async read(filePath: string): Promise<string> {
    20	    return fs.readFile(filePath, "utf-8");
    21	  }
    22	
    23	  async readBinary(filePath: string): Promise<Uint8Array> {
    24	    const buffer = await fs.readFile(filePath);
    25	    return new Uint8Array(buffer);
    26	  }
    27	
    28	  async write(filePath: string, content: string): Promise<void> {
    29	    // Ensure directory exists
    30	    const dir = path.dirname(filePath);
    31	    await fs.mkdir(dir, { recursive: true });
    32	    await fs.writeFile(filePath, content, "utf-8");
    33	  }
    34	
    35	  async exists(filePath: string): Promise<boolean> {
    36	    try {
    37	      await fs.access(filePath);
    38	      return true;
    39	    } catch (e) {
    40	      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
    41	        console.warn(`exists: access failed for ${filePath}`, e);
    42	      }
    43	      return false;
    44	    }
    45	  }
    46	
    47	  async list(dirPath: string): Promise<string[]> {
    48	    try {
    49	      return await fs.readdir(dirPath);
    50	    } catch (e) {
    51	      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
    52	        console.warn(`list: readdir failed for ${dirPath}`, e);
    53	      }
    54	      return [];
    55	    }
    56	  }
    57	
    58	  async glob(basePath: string, pattern: string): Promise<string[]> {
    59	    const results: string[] = [];
    60	
    61	    // Convert glob pattern to regex using placeholders
    62	    let regexPattern = pattern;
    63	
    64	    // First, protect ** and * with placeholders (using unlikely strings)
    65	    regexPattern = regexPattern.replace(/\*\*\//g, "<<GLOBSTARSLASH>>");
    66	    regexPattern = regexPattern.replace(/\*\*/g, "<<GLOBSTAR>>");
    67	    regexPattern = regexPattern.replace(/\*/g, "<<STAR>>");
    68	    regexPattern = regexPattern.replace(/\?/g, "<<QUESTION>>");
    69	
    70	    // Escape regex special chars
    71	    regexPattern = regexPattern.replace(/[$()+.[\\\]^{|}]/g, "\\$&");
    72	
    73	    // Replace placeholders with regex equivalents
    74	    regexPattern = regexPattern.replace(/<<GLOBSTARSLASH>>/g, "(.*/)?");
    75	    regexPattern = regexPattern.replace(/<<GLOBSTAR>>/g, ".*");
    76	    regexPattern = regexPattern.replace(/<<STAR>>/g, "[^/]*");
    77	    regexPattern = regexPattern.replace(/<<QUESTION>>/g, "[^/]");
    78	
    79	    // regexPattern is derived solely from the glob `pattern` via the controlled
    80	    // placeholder substitutions above, with all regex-special chars escaped, so
    81	    // it cannot inject arbitrary regex syntax.
    82	    // eslint-disable-next-line security/detect-non-literal-regexp
    83	    const regex = new RegExp(`^${regexPattern}$`);
    84	
    85	    // Recursively walk the directory
    86	    await this.walkDir(basePath, { basePath, pattern: regex, results });
    87	
    88	    return results.toSorted();
    89	  }
    90	
    91	  private async walkDir(
    92	    currentPath: string,
    93	    { basePath, pattern, results }: WalkDirOptions
    94	  ): Promise<void> {
    95	    let entries: string[];
    96	    try {
    97	      entries = await fs.readdir(currentPath);
    98	    } catch (e) {
    99	      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
   100	        console.warn(`walkDir: readdir failed for ${currentPath}`, e);
   101	      }
   102	      return;
   103	    }
   104	
   105	    for (const entry of entries) {
   106	      const fullPath = path.join(currentPath, entry);
   107	      const relativePath = path.relative(basePath, fullPath);
   108	
   109	      try {
   110	        const stat = await fs.stat(fullPath);
   111	        if (stat.isDirectory()) {
   112	          if (!GLOB_SKIP_DIRS.has(entry)) {
   113	            await this.walkDir(fullPath, { basePath, pattern, results });
   114	          }
   115	        } else if (stat.isFile()) {
   116	          if (pattern.test(relativePath)) {
   117	            results.push(fullPath);
   118	          }
   119	        }
   120	      } catch (e) {
   121	        // Skip files we can't stat; a vanished/inaccessible entry is expected.
   122	        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
   123	          console.warn(`walkDir: stat failed for ${fullPath}`, e);
   124	        }
   125	      }
   126	    }
   127	  }
   128	
   129	  async move(from: string, to: string): Promise<void> {
   130	    // Ensure target directory exists
   131	    const dir = path.dirname(to);
   132	    await fs.mkdir(dir, { recursive: true });
   133	    await fs.rename(from, to);
   134	  }
   135	
   136	  resolve(base: string, relative: string): string {
   137	    if (path.isAbsolute(relative)) {
   138	      return relative;
   139	    }
   140	    const baseDir = path.dirname(base);

exec
/opt/homebrew/bin/bash -lc "rg -n \"from \\\"cardworks\\\"|from 'cardworks'|require\\(['\\\"]cardworks|cardworks/\" callback-box/src callback-box/scripts callback-box/bin callback-box/deploy callback-box/package.json pnpm-workspace.yaml" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-20-05.md:277:> import { element, escapeText } from "cardworks";
callback-box/deploy/deploy.sh:123:    rm -rf /opt/callback/cardworks/node_modules \
callback-box/src/dev/reports/knowledge-report-2026-02-23T05-04-22.md:25:> import { element } from "cardworks";

exec
/opt/homebrew/bin/bash -lc "git show main:cardworks/src/fs/node-fs.ts | nl -ba | sed -n '136,152p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-DbSTiJuX' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Q1rpqOhe' (errno=Operation not permitted)
   136	  resolve(base: string, relative: string): string {
   137	    if (path.isAbsolute(relative)) {
   138	      return relative;
   139	    }
   140	    const baseDir = path.dirname(base);
   141	    return path.resolve(baseDir, relative);
   142	  }
   143	
   144	  async stat(filePath: string): Promise<{ mtime: Date; size: number }> {
   145	    const stats = await fs.stat(filePath);
   146	    return {
   147	      mtime: stats.mtime,
   148	      size: stats.size,
   149	    };
   150	  }
   151	}

exec
/opt/homebrew/bin/bash -lc "nl -ba callback-box/src/cli/commands/validate.ts | sed -n '220,420p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
   220	
   221	/** Validate the union of git-staged cards and any explicit card paths given. */
   222	async function collectStagedResults({ boxRoot, ctx, resolved, json }: CollectArgs): Promise<ValidationResults> {
   223	  const staged = await listStagedCards(boxRoot);
   224	  const explicit = resolved.filter(isCardFile);
   225	  const all = [...staged, ...explicit];
   226	  if (all.length === 0 && !json) {
   227	    console.log("No staged cards to validate.");
   228	  }
   229	  const cardSummary = all.length > 0 ? await lintCardsDispatch(all, { boxRoot, ctx }) : null;
   230	  return { cardSummary, mdSummary: null, attachErrors: [], claudeMdWarnings: [] };
   231	}
   232	
   233	/** Validate every card, markdown file, and attach layout in the box. */
   234	async function collectAllResults({ boxRoot, ctx }: CollectArgs): Promise<ValidationResults> {
   235	  const cardPaths = (await listBoxCardFiles(boxRoot)).filter((p) => !isTrashedCard(p));
   236	  const cardSummary = await lintCardsDispatch(cardPaths, { boxRoot, ctx });
   237	  const mdFiles = await findMarkdownFiles(boxRoot);
   238	  const mdSummary = mdFiles.length > 0 ? await lintMarkdownFiles(mdFiles) : null;
   239	  const attachErrors = await lintAttachLayout(boxRoot);
   240	  const claudeMdWarnings = await lintAllClaudeMd(boxRoot);
   241	  return { cardSummary, mdSummary, attachErrors, claudeMdWarnings };
   242	}
   243	
   244	/** Validate an explicit list of card/markdown paths; exit 1 on unknown types. */
   245	async function collectExplicitResults({ boxRoot, ctx, resolved }: CollectArgs): Promise<ValidationResults> {
   246	  const cardPaths = resolved.filter(isCardFile);
   247	  const mdPaths = resolved.filter(isMarkdownFile);
   248	  const unknown = resolved.filter((p) => !isCardFile(p) && !isMarkdownFile(p));
   249	  if (unknown.length > 0) {
   250	    console.error(`Error: not a card or markdown file: ${unknown.join(", ")}`);
   251	    process.exit(1);
   252	  }
   253	  const cardSummary = cardPaths.length > 0 ? await lintCardsDispatch(cardPaths, { boxRoot, ctx }) : null;
   254	  const mdSummary = mdPaths.length > 0 ? await lintMarkdownFiles(mdPaths) : null;
   255	  return { cardSummary, mdSummary, attachErrors: [], claudeMdWarnings: [] };
   256	}
   257	
   258	/** Print human-readable card/markdown/attach results to stdout. */
   259	function printTextResults({ cardSummary, mdSummary, attachErrors, claudeMdWarnings }: ValidationResults): void {
   260	  if (cardSummary !== null) {
   261	    const output = formatLintResults(cardSummary, { colors: true });
   262	    if (output) console.log(output);
   263	  }
   264	  if (mdSummary !== null) {
   265	    const output = formatMarkdownResults(mdSummary, { colors: true });
   266	    if (output) console.log(`\n${output}`);
   267	    if (mdSummary.totalErrors > 0) {
   268	      const fileWord = mdSummary.filesWithErrors === 1 ? "file" : "files";
   269	      console.log(
   270	        `\n${String(mdSummary.filesChecked)} markdown file${mdSummary.filesChecked === 1 ? "" : "s"} checked, ` +
   271	        `${String(mdSummary.totalErrors)} error${mdSummary.totalErrors === 1 ? "" : "s"} in ` +
   272	        `${String(mdSummary.filesWithErrors)} ${fileWord}`
   273	      );
   274	    }
   275	  }
   276	  if (attachErrors.length > 0) {
   277	    const output = formatAttachLintErrors(attachErrors, { colors: true });
   278	    console.log(`\n${output}`);
   279	    console.log(`\nAttach layout: ${attachErrors.length} issue(s)`);
   280	  }
   281	  if (claudeMdWarnings.length > 0) {
   282	    console.log(`\n${claudeMdWarnings.join("\n")}`);
   283	  }
   284	}
   285	
   286	/**
   287	 * Verify the git working tree is clean. Exits 1 (printing the dirty files) if
   288	 * not. Prints a confirmation line in non-JSON mode when clean.
   289	 */
   290	async function checkCommitted(boxRoot: string, { json }: { json: boolean }): Promise<void> {
   291	  const status = await getStatus(boxRoot);
   292	  if (!status.clean) {
   293	    const dirty = [...status.staged, ...status.modified, ...status.untracked];
   294	    console.error("\nGit working tree is not clean:");
   295	    for (const file of dirty) {
   296	      console.error(`  ${file}`);
   297	    }
   298	    process.exit(1);
   299	  }
   300	  if (!json) {
   301	    console.log("Git working tree is clean.");
   302	  }
   303	}
   304	
   305	function countTotalErrors({ cardSummary, mdSummary, attachErrors }: ValidationResults): number {
   306	  return (
   307	    (cardSummary !== null ? cardSummary.totalErrors : 0) +
   308	    (mdSummary !== null ? mdSummary.totalErrors : 0) +
   309	    attachErrors.length
   310	  );
   311	}
   312	
   313	export const validateCommand = new Command("validate")
   314	  .description("Validate cards and markdown in the box")
   315	  .argument("[paths...]", "Files to validate (cards or markdown). Omit to validate everything; pair with --staged to validate staged cards.")
   316	  .option("--all", "Validate all files in the box (default when no path given)")
   317	  .option("--staged", "Validate the cards currently staged in git")
   318	  .option("--hook", "Hook mode: read Claude Code PostToolUse JSON payload from stdin, validate the touched card. Errors go to stderr with exit code 2 so the agent sees feedback; non-card paths exit 0 silently.")
   319	  .option("--json", "Output results as JSON")
   320	  .option("--committed", "Also check that git working tree is clean")
   321	  .action(
   322	    async (
   323	      targetPaths: string[],
   324	      options: { all?: boolean; staged?: boolean; hook?: boolean; json?: boolean; committed?: boolean }
   325	    ) => {
   326	      try {
   327	        if (options.hook) {
   328	          await runHookMode();
   329	        }
   330	
   331	        const boxRoot = await requireBoxRoot();
   332	        const ctx = await buildLoadContext(boxRoot);
   333	        const json = options.json === true;
   334	
   335	        const resolved = targetPaths.map((p) =>
   336	          path.isAbsolute(p) ? p : path.join(process.cwd(), p)
   337	        );
   338	
   339	        const results = await collectResults(options, { boxRoot, ctx, resolved, json });
   340	
   341	        if (json) {
   342	          const payload = { cards: results.cardSummary, markdown: results.mdSummary, attach: results.attachErrors, claudeMd: results.claudeMdWarnings };
   343	          console.log(JSON.stringify(payload, null, 2));
   344	        } else {
   345	          printTextResults(results);
   346	        }
   347	
   348	        if (options.committed) {
   349	          await checkCommitted(boxRoot, { json });
   350	        }
   351	
   352	        if (countTotalErrors(results) > 0) {
   353	          process.exit(1);
   354	        }
   355	      } catch (error) {
   356	        console.error(`Error: ${(error as Error).message}`);
   357	        process.exit(1);
   358	      }
   359	    }
   360	  );

exec
/opt/homebrew/bin/bash -lc "git diff main...HEAD -- callback-box/test/card-lint.doctest.md | sed -n '1,260p'" in /Users/ianbicking/src/callback-worktrees/remove-cardworks
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-hSfx4f6E' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-6bf1ZAzu' (errno=Operation not permitted)
diff --git a/callback-box/test/card-lint.doctest.md b/callback-box/test/card-lint.doctest.md
index 01f1767f..a9532d2a 100644
--- a/callback-box/test/card-lint.doctest.md
+++ b/callback-box/test/card-lint.doctest.md
@@ -1,4 +1,4 @@
-# card-lint: dispatching XML and frontmatter cards
+# card-lint: validating frontmatter cards
 
 `lintCardsDispatch` is the validate-time counterpart to
 `loadCardFile`: it picks the right validator for each file based on
@@ -9,12 +9,9 @@ import { z } from "zod";
 import {
   body,
   cardSchema,
-  element,
   type CardSchema,
-  type ElementSchema,
-} from "cardworks";
+} from "../src/cards/index.js";
 import { makeTmpBox } from "./helpers/doctest-helpers.js";
-import { createLoader } from "../src/cli/lib/loader.js";
 import { lintCardsDispatch } from "../src/core/card-lint.js";
 import type { LoadCardContext } from "../src/core/card-io.js";
 import { CommentarySchema } from "../src/schemas/commentary.js";
@@ -52,10 +49,6 @@ const gadgetSchema: CardSchema = cardSchema("gadget", {
       : [],
 });
 
-const memoSchema: ElementSchema = element("memo", {
-  attrs: { status: z.string() },
-});
-
 const ctx: LoadCardContext = {
   cardSchemas: new Map<string, CardSchema>([
     ["email-thread", threadSchema],
@@ -64,7 +57,6 @@ const ctx: LoadCardContext = {
     ["extfile", ExtfileSchema],
     ["gadget", gadgetSchema],
   ]),
-  elementSchemas: new Map<string, ElementSchema>([["memo", memoSchema]]),
 };
 ```
 
@@ -80,10 +72,9 @@ await box.write(
   "box/inbox/email/thread-x.attach/msg-001.email-message.card",
   "---\ncontent-type: application/x-card+xml\n---\n<email-message message-id=\"m1\" thread-id=\"t1\"><from>a@x</from><date>2026-02-15T10:00:00Z</date><subject>hi</subject><body-file>attach/msg-001.body.txt</body-file></email-message>\n",
 );
-const loader = await createLoader(box.root);
 const result = await lintCardsDispatch(
   [box.path("box/inbox/email/thread-x.email-thread.card")],
-  { loader, ctx },
+  { boxRoot: box.root, ctx },
 );
 result.totalErrors
 => 0
@@ -100,10 +91,9 @@ await box.write(
   "box/inbox/email/broken.email-thread.card",
   "---\ntype: email-thread\nthread-id: t1\n---\n",
 );
-const loader = await createLoader(box.root);
 const result = await lintCardsDispatch(
   [box.path("box/inbox/email/broken.email-thread.card")],
-  { loader, ctx },
+  { boxRoot: box.root, ctx },
 );
 result.totalErrors
 => 1
@@ -124,10 +114,9 @@ await box.write(
   "box/inbox/notes/drift.doc.card",
   "---\ntype: doc\ntitle: Drift\nbogus-field: oops\n---\nBody.\n",
 );
-const loader = await createLoader(box.root);
 const result = await lintCardsDispatch(
   [box.path("box/inbox/notes/drift.doc.card")],
-  { loader, ctx },
+  { boxRoot: box.root, ctx },
 );
 result.totalErrors
 => 0
@@ -138,7 +127,7 @@ result.results[0]!.warnings.some(w => w.message.includes('Unknown frontmatter ke
 
 ## Broken refs in frontmatter cards are reported as warnings
 
-Each entry in a ref-declared field is resolved against the loader; missing
+Each entry in a ref-declared field is resolved against the box; missing
 targets surface as lint warnings (not errors) carrying the field path. Broken
 refs are warnings because they commonly arise from legitimate operations
 (referents being moved, archived, trashed, or hand-deleted), and treating
@@ -150,10 +139,9 @@ await box.write(
   "box/inbox/email/thread-x/thread.email-thread.card",
   "---\ntype: email-thread\nthread-id: t1\nsubject: hi\nparticipants:\n  - a@x\ndate-range:\n  start: 2026-02-15T10:00:00Z\n  end: 2026-02-15T10:30:00Z\nmessages:\n  - ref: thread.attach/missing.email-message.card\n---\n",
 );
-const loader = await createLoader(box.root);
 const result = await lintCardsDispatch(
   [box.path("box/inbox/email/thread-x/thread.email-thread.card")],
-  { loader, ctx },
+  { boxRoot: box.root, ctx },
 );
 result.totalErrors
 => 0
@@ -179,10 +167,9 @@ await box.write(
   "store/notes/Wordy.doc.card",
   "---\ntitle: Wordy\ncontains: " + longContains + "\n---\nbody\n",
 );
-const loader = await createLoader(box.root);
 const result = await lintCardsDispatch(
   [box.path("store/notes/Wordy.doc.card")],
-  { loader, ctx },
+  { boxRoot: box.root, ctx },
 );
 result.totalErrors
 => 0
@@ -198,7 +185,7 @@ result.results[0]!.warnings[0]!.message
 
 Refs carried by Markdoc tag attributes inside a card body (e.g.
 `{% source ref="..." %}`, `{% subrecipe ref="..." %}`) get the same
-broken-ref treatment as frontmatter refs — resolved against the loader,
+broken-ref treatment as frontmatter refs — resolved against the box,
 missing targets reported as warnings. The path field on the warning
 points at `body:<line>:<tagName>.<attr>` so the human can locate it.
 Ref paths follow the same convention as frontmatter refs: leading `/`
@@ -211,10 +198,9 @@ await box.write(
   "box/notes/Meeting.doc.card",
   "---\ntype: doc\ntitle: Meeting Notes\n---\nDana made the call: {% source ref=\"/box/people/missing.person.card\" as=\"verbatim\" %}{% /source %}\n",
 );
-const loader = await createLoader(box.root);
 const result = await lintCardsDispatch(
   [box.path("box/notes/Meeting.doc.card")],
-  { loader, ctx },
+  { boxRoot: box.root, ctx },
 );
 result.totalErrors
 => 0
@@ -241,30 +227,82 @@ await box.write(
   "box/notes/Meeting.doc.card",
   "---\ntype: doc\ntitle: Meeting Notes\n---\nDana said: {% source ref=\"/box/people/dana.person.card\" as=\"verbatim\" %}ship Friday{% /source %}\n",
 );
-const loader = await createLoader(box.root);
 const result = await lintCardsDispatch(
   [box.path("box/notes/Meeting.doc.card")],
-  { loader, ctx },
+  { boxRoot: box.root, ctx },
+);
+result.totalWarnings
+=> 0
+```
+
+## Ref existence honors `@version` stripping and `attach/` scope
+
+The broken-ref walk resolves refs the same way the cards do: a version-like
+`@x.y.z` suffix is stripped before the file is located (so a versioned ref to
+an existing card is not reported broken), and an `attach/`-prefixed ref resolves
+into the referring card's `<basename>.attach/` scope. These mirror the cardworks
+loader semantics the walk replaced.
+
+A versioned ref to an existing target lints clean — the `@1.2.3` is not treated
+as part of the filename:
+
+```
+const box = await makeTmpBox();
+await box.write("box/people/dana.person.card", "---\ntype: person\nname: Dana\n---\n");
+await box.write(
+  "box/notes/Ver.doc.card",
+  "---\ntype: doc\ntitle: V\n---\nSee {% source ref=\"/box/people/dana.person.card@1.2.3\" as=\"x\" %}{% /source %}\n",
+);
+const result = await lintCardsDispatch(
+  [box.path("box/notes/Ver.doc.card")],
+  { boxRoot: box.root, ctx },
 );
 result.totalWarnings
 => 0
 ```
 
-## XML cards still flow through the existing cardworks lintCard path
+An `attach/` ref resolving into the card's attach scope is clean; a missing one
+in the same scope warns:
 
 ```
 const box = await makeTmpBox();
 await box.write(
-  "box/inbox/Note.memo.card",
-  "---\ncontent-type: application/x-card+xml\n---\n<memo status=\"new\"/>\n",
+  "box/notes/Note.doc.card",
+  "---\ntype: doc\ntitle: N\n---\nok {% source ref=\"attach/photo.jpg\" as=\"a\" %}{% /source %} bad {% source ref=\"attach/missing.jpg\" as=\"b\" %}{% /source %}\n",
 );
-const loader = await createLoader(box.root);
+await box.write("box/notes/Note.attach/photo.jpg", "JPG");
 const result = await lintCardsDispatch(
-  [box.path("box/inbox/Note.memo.card")],
-  { loader, ctx },
+  [box.path("box/notes/Note.doc.card")],
+  { boxRoot: box.root, ctx },
+);
+result.totalWarnings
+=> 1
+
+result.results[0]!.warnings[0]!.message.includes("attach/missing.jpg does not exist")
+=> true
+```
+
+## A card whose type has no registered schema warns, never errors
+
+There's no XML loader fallback anymore: a `.card` with frontmatter whose
+filename type isn't a registered schema (a typo, or a box-local type the test
+ctx doesn't include) is surfaced as a non-blocking warning rather than failing.
+
+```
+const box = await makeTmpBox();
+await box.write(
+  "box/inbox/Note.unknowntype.card",
+  "---\nstatus: new\n---\n",
+);
+const result = await lintCardsDispatch(
+  [box.path("box/inbox/Note.unknowntype.card")],
+  { boxRoot: box.root, ctx },
 );
 result.totalErrors
 => 0
+
+result.results[0]!.warnings[0]!.message
+=> no schema registered for card type "unknowntype" — card not validated
 ```
 
 ## An attach-only commentary card with valid anchors lints clean
@@ -278,10 +316,9 @@ await box.write(
   "store/review/Plan.attach/Plan.commentary.card",
   "---\ntype: commentary\n---\n{% source pos=\"body; ~line 4\" version=\"sha256:9f3a1c2b\" %}{% quote %}a span{% /quote %}{% /source %}\n\nThis reads well.\n",
 );
-const loader = await createLoader(box.root);
 const result = await lintCardsDispatch(
   [box.path("store/review/Plan.attach/Plan.commentary.card")],
-  { loader, ctx },
+  { boxRoot: box.root, ctx },
 );
 result.totalErrors
 => 0
@@ -299,10 +336,9 @@ await box.write(
   "store/review/Stale.commentary.card",
   "---\ntype: commentary\ndefaultHref: \"file:/Users/x/doc.md\"\n---\nbody\n",
 );
-const loader = await createLoader(box.root);
 const result = await lintCardsDispatch(
   [box.path("store/review/Stale.commentary.card")],
-  { loader, ctx },
+  { boxRoot: box.root, ctx },
 );
 result.totalErrors
 => 0
@@ -323,10 +359,9 @@ await box.write(
   "store/review/RefFree.commentary.card",
   "---\ntype: commentary\n---\n{% source pos=\"body\" %}a span anchored to this page{% /source %}\n",
 );
-const loader = await createLoader(box.root);
 const result = await lintCardsDispatch(
   [box.path("store/review/RefFree.commentary.card")],
-  { loader, ctx },
+  { boxRoot: box.root, ctx },
 );
 result.totalErrors
 => 0

codex
**Findings**

1. High: retired migrators can still run and falsely mark themselves applied.  
`cb migrate --apply` runs every pending `MIGRATIONS` entry and appends it on exit code 0: [migrate.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/cli/commands/migrate.ts:162). The stubbed XML migrators exit 0 unconditionally, e.g. [image.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/scripts/migrate/image.ts:1). Fresh boxes are seeded as fully migrated, but existing boxes are not: [box.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/box.ts:62). So any existing box with a partial manifest can now “apply” `image`, `memo`, etc. without converting anything. Make these stubs fail loudly if matching legacy/XML cards remain, or keep the old migrators until there is no runnable path.

2. High: `.card` files with no frontmatter now validate cleanly.  
In the new dispatcher, known frontmatter cards are validated, unknown frontmatter cards warn, but non-frontmatter cards return `{ errors: [], warnings: [] }`: [card-lint.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/card-lint.ts:86). `cb validate --all` feeds every `*.card` into that dispatcher: [validate.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/cli/commands/validate.ts:233). On `main`, this path fell through to cardworks `lintCard`, so malformed legacy XML was visible. This should at least warn, and probably error, because it is now “not a recognized card.”

3. Medium: `callback-box/cards` can break on the server rebuild path.  
The export points to generated, gitignored `dist/cards/index.js`: [package.json](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/package.json:7), emitted only by `scripts/build-cli.mjs`: [build-cli.mjs](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/scripts/build-cli.mjs:51). `deploy.sh` builds it before rsync, but `rebuild-server.sh` pulls and rebuilds only deps/frontend before restarting: [rebuild-server.sh](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/deploy/rebuild-server.sh:16). If that path is used after this merges, box-local schema imports of `callback-box/cards` can resolve to a missing or stale generated file. Add `node scripts/build-cli.mjs` there too.

I did not find a ref-semantics regression in `ref-exists.ts`: it matches cardworks on version-like `@` stripping, fragment ignoring for existence, `/...` box-root resolution, `attach`/`attach/...`, and relative refs. The scan-import image writeback also matches `ImageSchema` field names and shapes.

Most important change before merge: make the retired migrator stubs fail loudly when they would have had work to do, instead of exiting 0 and letting `cb migrate` record a lie.
tokens used
220,427
**Findings**

1. High: retired migrators can still run and falsely mark themselves applied.  
`cb migrate --apply` runs every pending `MIGRATIONS` entry and appends it on exit code 0: [migrate.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/cli/commands/migrate.ts:162). The stubbed XML migrators exit 0 unconditionally, e.g. [image.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/scripts/migrate/image.ts:1). Fresh boxes are seeded as fully migrated, but existing boxes are not: [box.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/box.ts:62). So any existing box with a partial manifest can now “apply” `image`, `memo`, etc. without converting anything. Make these stubs fail loudly if matching legacy/XML cards remain, or keep the old migrators until there is no runnable path.

2. High: `.card` files with no frontmatter now validate cleanly.  
In the new dispatcher, known frontmatter cards are validated, unknown frontmatter cards warn, but non-frontmatter cards return `{ errors: [], warnings: [] }`: [card-lint.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/core/card-lint.ts:86). `cb validate --all` feeds every `*.card` into that dispatcher: [validate.ts](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/src/cli/commands/validate.ts:233). On `main`, this path fell through to cardworks `lintCard`, so malformed legacy XML was visible. This should at least warn, and probably error, because it is now “not a recognized card.”

3. Medium: `callback-box/cards` can break on the server rebuild path.  
The export points to generated, gitignored `dist/cards/index.js`: [package.json](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/package.json:7), emitted only by `scripts/build-cli.mjs`: [build-cli.mjs](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/scripts/build-cli.mjs:51). `deploy.sh` builds it before rsync, but `rebuild-server.sh` pulls and rebuilds only deps/frontend before restarting: [rebuild-server.sh](/Users/ianbicking/src/callback-worktrees/remove-cardworks/callback-box/deploy/rebuild-server.sh:16). If that path is used after this merges, box-local schema imports of `callback-box/cards` can resolve to a missing or stale generated file. Add `node scripts/build-cli.mjs` there too.

I did not find a ref-semantics regression in `ref-exists.ts`: it matches cardworks on version-like `@` stripping, fragment ignoring for existence, `/...` box-root resolution, `attach`/`attach/...`, and relative refs. The scan-import image writeback also matches `ImageSchema` field names and shapes.

Most important change before merge: make the retired migrator stubs fail loudly when they would have had work to do, instead of exiting 0 and letting `cb migrate` record a lie.
