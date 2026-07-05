/**
 * Package-root scaffolding for shapeVersion 2 boxes (see "The box
 * repository" in `docs/implemented-plans/boxes-as-packages-v2.md`). `cb init` on a path
 * with no existing box detects a fresh init and lays down BOTH halves: a
 * thin coding-session package at the target path, and the operational box
 * at `<target>/content/`. An existing box (legacy or v2) is left in its
 * current shape — conversion is a later migration (Track H), not init's job.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isValidBox } from "./box.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";

export type BoxInitMode = "fresh" | "update-legacy" | "update-v2";

/**
 * Thrown when a fresh `cb init` would overwrite a package.json it didn't
 * create — the target directory already has one, so scaffolding blindly
 * risks clobbering an unrelated package.
 */
export class BoxPackageConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoxPackageConflictError";
  }
}

export interface BoxTarget {
  mode: BoxInitMode;
  /** The operational root — where `.cb-box`, `box/`, `config/`, etc. live (or will). */
  boxRoot: string;
  /** The package root — where `package.json`/`node_modules`/`src/` live (or
   * will). Equals `boxRoot` for a legacy box. */
  packageRoot: string;
}

/**
 * Decide what `cb init <path>` is looking at: an existing legacy box (marker
 * at the target itself), an existing v2 box (marker at `<target>/content`),
 * or nothing yet. A fresh init always scaffolds the v2 layout — there is no
 * "legacy fresh init" anymore; existing legacy boxes just keep working in
 * place until migrated (Track H).
 */
export async function detectBoxTarget(targetPath: string): Promise<BoxTarget> {
  const resolvedRoot = path.resolve(targetPath);
  if (await isValidBox(resolvedRoot)) {
    return { mode: "update-legacy", boxRoot: resolvedRoot, packageRoot: resolvedRoot };
  }
  const contentRoot = path.join(resolvedRoot, "content");
  if (await isValidBox(contentRoot)) {
    return { mode: "update-v2", boxRoot: contentRoot, packageRoot: resolvedRoot };
  }
  return { mode: "fresh", boxRoot: contentRoot, packageRoot: resolvedRoot };
}

const ROOT_GITIGNORE = `node_modules/

# Trick dependencies (installed by agent) -- see src/tricks/
src/tricks/node_modules/
`;

const ROOT_CLAUDE_MD = `# Box Package

This is a callback-box PACKAGE. The live, operational box is \`content/\` --
that's where an agent (chat, wakeup, scheduled run) actually works; it never
sees this directory's package machinery directly.

- \`src/\` holds box-authored code (schemas, views, tricks) -- edited in a
  coding session opened at this root, not by the operating agent.
- \`content/\` is the box: cards, config, runtime state. Its own \`CLAUDE.md\`
  is the operating agent's context.
- This package depends on \`callback-box\` (see \`package.json\`) the way any
  Node package depends on a library.
`;

interface EngineVersions {
  /** The engine's own package version, to pin the scaffolded `callback-box` dependency. */
  engine: string;
  /** `typescript`'s version range, read from the engine's own `dependencies`. */
  typescript: string;
  /** `@types/node`'s version range, read from the engine's own `devDependencies`. */
  typesNode: string;
  /** `@types/react`'s version range, read from the engine's frontend workspace member. */
  typesReact: string;
  /** `react`/`react-dom` ranges, read from the engine's own `dependencies`. */
  react: string;
  reactDom: string;
}

/**
 * Read the versions the scaffolded box's `package.json` pins: the running
 * engine's own version (for the `callback-box` dependency), plus
 * `typescript`/`@types/node`/`@types/react` at the exact ranges this engine
 * itself develops against (for the box's `devDependencies`, so `tsc` in the
 * box behaves the same as `tsc` in the engine). `@types/react` lives in the
 * frontend workspace member's `package.json`, not the engine's own — views
 * are the only box code that needs DOM/JSX types. That file (metadata only,
 * no `node_modules`) ships in the release tarball's `files` allowlist
 * specifically so this read works from an installed package, not just a
 * monorepo checkout.
 */
async function readEngineVersions(): Promise<EngineVersions> {
  const [rawEngine, rawFrontend] = await Promise.all([
    fs.readFile(path.join(PACKAGE_ROOT, "package.json"), "utf-8"),
    fs.readFile(path.join(PACKAGE_ROOT, "src/frontend/package.json"), "utf-8"),
  ]);
  const engine = JSON.parse(rawEngine) as {
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const frontend = JSON.parse(rawFrontend) as { devDependencies?: Record<string, string> };
  return {
    engine: engine.version ?? "0.0.0",
    typescript: engine.dependencies?.typescript ?? "^5.7.0",
    typesNode: engine.devDependencies?.["@types/node"] ?? "^22.0.0",
    typesReact: frontend.devDependencies?.["@types/react"] ?? "^18.3.0",
    react: engine.dependencies?.react ?? "^18.3.1",
    reactDom: engine.dependencies?.["react-dom"] ?? "^18.3.1",
  };
}

/**
 * Scaffold the coding-session half of a fresh v2 box: `package.json`,
 * `tsconfig.json`, a thin root `CLAUDE.md`, and a root `.gitignore`.
 * Idempotent in the sense that every write is a plain overwrite, but it's
 * only ever called for a genuinely fresh init (see `detectBoxTarget`) — an
 * existing package root is never touched by `cb init`.
 *
 * Deliberately does NOT run `pnpm install` — the `callback-box` dependency
 * isn't resolvable through a real registry/tarball channel yet (Track F).
 * Instead, when `node_modules/` is absent, it symlinks
 * `node_modules/callback-box` straight at the running engine's own
 * `PACKAGE_ROOT` — the same trick the v2 fixture doctests and `cb view test`
 * use — so the box is loadable (`getBoxShape`'s dependency check, native
 * schema/view resolution) before a real install ever happens. Track F's real
 * install replaces this symlink with an actual dependency.
 *
 * `detectBoxTarget` only checks whether `targetPath` (and `targetPath/content`)
 * is a *box* — a plain non-empty directory (an existing project, a directory
 * with an unrelated package.json) still reads as "fresh." Overwriting that
 * directory's `package.json` would silently clobber someone else's package,
 * so a pre-existing `package.json` is a hard conflict; the other three
 * scaffold files (`tsconfig.json`, `CLAUDE.md`, `.gitignore`) are only
 * written when absent, so a directory that already has its own is left
 * alone.
 * @throws BoxPackageConflictError if `packageRoot` already has a `package.json`
 */
export async function scaffoldPackageRoot(packageRoot: string): Promise<void> {
  await fs.mkdir(packageRoot, { recursive: true });

  const packageJsonPath = path.join(packageRoot, "package.json");
  if (await pathExists(packageJsonPath)) {
    throw new BoxPackageConflictError(
      `Cannot initialize a callback-box package at ${packageRoot}: it already has a ` +
        "package.json. Fresh `cb init` scaffolds a new coding-session package there and " +
        "won't overwrite an existing one — remove it first, or run `cb init` on the " +
        "directory only after confirming it's meant to become a box package."
    );
  }

  const versions = await readEngineVersions();
  // The dependency spec for `callback-box` itself. Defaults to a bare semver
  // range against the running engine's own version — meaningless to resolve
  // via a real install today (there's no registry; Track F's "Now" channel
  // is a tarball, not `npm publish` — see "Distribution (decision 2)" in
  // docs/implemented-plans/boxes-as-packages-v2.md), but harmless, since scaffolding
  // immediately symlinks `node_modules/callback-box` at the running engine
  // instead of installing anything. A release/install tool that DOES want a
  // real `pnpm install` to resolve this dependency (pinning a tarball path
  // or URL, e.g. the release smoke test) overrides it via
  // `CB_INIT_CALLBACK_BOX_SPEC` before calling `cb init`.
  const callbackBoxSpec = process.env.CB_INIT_CALLBACK_BOX_SPEC ?? `^${versions.engine}`;
  const packageJson = {
    name: path.basename(packageRoot),
    private: true,
    type: "module",
    // react/react-dom are DIRECT deps of the box, not left to hoisting:
    // node-target compiled views externalize react/jsx-runtime, and pnpm's
    // strict isolation does not place callback-box's transitive react at the
    // box root — without these, `cb view test` and view-metadata import fail
    // on any JSX view in a real (installed, non-symlinked) box. Ranges match
    // the engine's so the single-React-instance invariant holds.
    dependencies: {
      "callback-box": callbackBoxSpec,
      react: versions.react,
      "react-dom": versions.reactDom,
    },
    // typescript + the type packages the base tsconfig's `lib` needs
    // (`ES2023, DOM`) to typecheck box code (schemas and views) — pinned to
    // the same ranges this engine itself develops against, so `pnpm exec tsc`
    // in the box behaves the same as it does here. `cb init` writes these
    // once at scaffold time; nothing keeps them in sync afterward (a stale
    // box devDependency is the box owner's `cb upgrade` to fix, same as any
    // other dependency drift).
    devDependencies: {
      typescript: versions.typescript,
      "@types/node": versions.typesNode,
      "@types/react": versions.typesReact,
    },
    // pnpm 10 refuses to run any dependency's postinstall/install script by
    // default (a supply-chain guard) — without this, a fresh `pnpm install`
    // silently leaves better-sqlite3 (event bus storage) and the others
    // below without their compiled native/generated bits, and the box fails
    // at first boot with an opaque "Could not locate the bindings file"
    // error nowhere near where the dependency was declared. The engine's own
    // monorepo allowlists the same packages workspace-wide (`onlyBuiltDependencies`
    // in the root `pnpm-workspace.yaml`); a standalone box has no workspace
    // file to inherit that from, so it needs its own copy. Found by the F1
    // release smoke test's `cb serve` step, which failed exactly this way
    // against a real fresh install.
    pnpm: {
      onlyBuiltDependencies: ["better-sqlite3", "@google/genai", "esbuild", "protobufjs"],
    },
  };
  await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");

  await writeFileIfAbsent(
    path.join(packageRoot, "tsconfig.json"),
    JSON.stringify({ extends: "callback-box/tsconfig.base.json", include: ["src"] }, null, 2) + "\n"
  );

  await writeFileIfAbsent(path.join(packageRoot, "CLAUDE.md"), ROOT_CLAUDE_MD);
  await writeFileIfAbsent(path.join(packageRoot, ".gitignore"), ROOT_GITIGNORE);

  await fs.mkdir(path.join(packageRoot, "src"), { recursive: true });

  const nodeModulesDir = path.join(packageRoot, "node_modules");
  if (!(await pathExists(nodeModulesDir))) {
    await fs.mkdir(nodeModulesDir, { recursive: true });
    await fs.symlink(PACKAGE_ROOT, path.join(nodeModulesDir, "callback-box"), "dir");
  }
}

/** Whether `filePath` exists, tolerating (only) the not-found case. */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (_e) {
    // ENOENT is the expected "doesn't exist yet" case — the error carries no
    // other actionable info.
    return false;
  }
}

/**
 * Write `content` to `filePath` only if nothing is there yet. Used for the
 * package scaffold files that a directory might already have its own
 * version of (`tsconfig.json`, `CLAUDE.md`, `.gitignore`) — unlike
 * `package.json`, which is a hard conflict, these are fine to leave in place.
 */
async function writeFileIfAbsent(filePath: string, content: string): Promise<void> {
  if (await pathExists(filePath)) return;
  await fs.writeFile(filePath, content);
}
