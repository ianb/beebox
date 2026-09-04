/**
 * Package-root scaffolding for shapeVersion 3 boxes (the one-root layout —
 * `docs/plans/one-root-box-layout.md`). `bbx init` on a path with no
 * existing box detects a fresh init and scaffolds the npm-package half
 * (`package.json`, `tsconfig.json`, `src/`) directly at the box root; the
 * operational half (the marker, the underscore areas, `.gitignore`) is
 * `initBox` in `./index.js`, run on the SAME directory right after. An
 * existing box is left in place — `bbx init` re-runs its provisioning
 * without moving anything.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { initBox, isValidBox } from "./index.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";

const EnginePackageJsonSchema = z.object({
  version: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});
const FrontendPackageJsonSchema = z.object({
  devDependencies: z.record(z.string(), z.string()).optional(),
});

export type BoxInitMode = "fresh" | "update";

/**
 * Thrown when a fresh `bbx init` would overwrite a package.json it didn't
 * create — the target directory already has one, so scaffolding blindly
 * risks clobbering an unrelated package.
 */
export class BoxPackageConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoxPackageConflictError";
  }
}

/**
 * The dependency spec `bbx init` writes for `beebox` itself when
 * `BBX_INIT_BBX_BOX_SPEC` doesn't override it (release/install tools
 * pin a tarball via that env var — e.g. the smoke tests' `file:<tarball>`).
 *
 * When the running engine is a source checkout (not installed under some
 * `node_modules/`, as a tarball install or `pnpm dlx` cache would be),
 * default to `link:<checkout>` so the box's own `pnpm install` — required
 * for a v2 box to resolve react/typescript for real — actually works.
 * A bare `^<version>` range is unresolvable (beebox isn't on npm)
 * and aborts the box's entire install with a registry 404, taking every
 * other dependency down with it. For an installed engine the bare range
 * remains the fallback: `link:` into a disposable dlx cache would be
 * worse, and those flows set `BBX_INIT_BBX_BOX_SPEC` explicitly.
 */
function defaultBeeBoxSpec(engineVersion: string): string {
  const installed = PACKAGE_ROOT.split(path.sep).includes("node_modules");
  return installed ? `^${engineVersion}` : `link:${PACKAGE_ROOT}`;
}

/**
 * Dependencies whose install scripts a box's `pnpm install` must be allowed
 * to run (pnpm 10 blocks every postinstall by default; non-interactively a
 * blocked build is a hard error). Written into each box's package.json as
 * `pnpm.onlyBuiltDependencies` and passed as `--allow-build` flags by the
 * smoke scripts. The two shell copies — `docker/Dockerfile` and
 * `docker/entrypoint.sh` — must be updated by hand; `docker/smoke-docker.sh`
 * fails the image build when they drift.
 */
export const BOX_BUILT_DEPENDENCIES = [
  "better-sqlite3",
  "esbuild",
  "@google/genai",
  "protobufjs",
  "@googleworkspace/cli",
];

export interface BoxTarget {
  mode: BoxInitMode;
  /** The box root — the ONE root; `.beebox/box.json`, `_content/`,
   * `_config/`, `package.json`/`node_modules`/`src/` all live here (or will). */
  boxRoot: string;
  /**
   * @deprecated Alias for `boxRoot` — shapeVersion 3 has one root. Kept so
   * callers that still read `.packageRoot` (init.ts, its doctest) keep
   * compiling and stay correct; a later track deletes it.
   */
  packageRoot: string;
}

/**
 * Decide what `bbx init <path>` is looking at: an existing box (marker at
 * the target itself) or nothing yet.
 */
export async function detectBoxTarget(targetPath: string): Promise<BoxTarget> {
  const resolvedRoot = path.resolve(targetPath);
  const mode: BoxInitMode = (await isValidBox(resolvedRoot)) ? "update" : "fresh";
  return { mode, boxRoot: resolvedRoot, packageRoot: resolvedRoot };
}

interface EngineVersions {
  /** The engine's own package version, to pin the scaffolded `beebox` dependency. */
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
 * engine's own version (for the `beebox` dependency), plus
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
  const engine = EnginePackageJsonSchema.parse(JSON.parse(rawEngine));
  const frontend = FrontendPackageJsonSchema.parse(JSON.parse(rawFrontend));
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
 * Scaffold the npm-package half of a fresh box: `package.json`,
 * `tsconfig.json`, `src/`. Idempotent in the sense that every write is a
 * plain overwrite, but it's only ever called for a genuinely fresh init (see
 * `detectBoxTarget`) — an existing box root is never touched by `bbx init`.
 *
 * Deliberately does NOT run `pnpm install` — the `beebox` dependency
 * isn't resolvable through a real registry/tarball channel yet (Track F).
 * Instead, when `node_modules/` is absent, it symlinks
 * `node_modules/beebox` straight at the running engine's own
 * `PACKAGE_ROOT` — the same trick the fixture doctests and `bbx view test`
 * use — so the box is loadable (`getBoxShape`'s dependency check, native
 * schema/view resolution) before a real install ever happens. Track F's real
 * install replaces this symlink with an actual dependency.
 *
 * `detectBoxTarget` only checks whether `targetPath` is a *box* — a plain
 * non-empty directory (an existing project, a directory with an unrelated
 * package.json) still reads as "fresh." Overwriting that directory's
 * `package.json` would silently clobber someone else's package, so a
 * pre-existing `package.json` is a hard conflict; `tsconfig.json` is only
 * written when absent, so a directory that already has its own is left
 * alone. `CLAUDE.md` and `.gitignore` are NOT written here — `initBox`
 * (`./index.js`, run right after on the same root) owns both, since they
 * cover the operational half too (the CLAUDE.md `@`-includes, the merged
 * ignore rules).
 * @param options.symlinkBeeBox - Whether to symlink
 *   `node_modules/beebox` at the running engine's `PACKAGE_ROOT`.
 *   Production `bbx init` wants it (native schema/view resolution); cheap
 *   fixtures that only read/write cards don't, and skip it. Defaults to true.
 * @throws BoxPackageConflictError if `packageRoot` already has a `package.json`
 */
export async function scaffoldPackageRoot(
  packageRoot: string,
  options?: { symlinkBeeBox?: boolean }
): Promise<void> {
  const symlinkBeeBox = options?.symlinkBeeBox ?? true;
  await fs.mkdir(packageRoot, { recursive: true });

  const packageJsonPath = path.join(packageRoot, "package.json");
  if (await pathExists(packageJsonPath)) {
    throw new BoxPackageConflictError(
      `Cannot initialize a beebox package at ${packageRoot}: it already has a ` +
        "package.json. Fresh `bbx init` scaffolds a new coding-session package there and " +
        "won't overwrite an existing one — remove it first, or run `bbx init` on the " +
        "directory only after confirming it's meant to become a box package."
    );
  }

  const versions = await readEngineVersions();
  const beeBoxSpec = process.env.BBX_INIT_BEEBOX_SPEC ?? defaultBeeBoxSpec(versions.engine);
  const packageJson = {
    name: path.basename(packageRoot),
    private: true,
    type: "module",
    // react/react-dom are DIRECT deps of the box, not left to hoisting:
    // node-target compiled views externalize react/jsx-runtime, and pnpm's
    // strict isolation does not place beebox's transitive react at the
    // box root — without these, `bbx view test` and view-metadata import fail
    // on any JSX view in a real (installed, non-symlinked) box. Ranges match
    // the engine's so the single-React-instance invariant holds.
    dependencies: {
      "beebox": beeBoxSpec,
      react: versions.react,
      "react-dom": versions.reactDom,
    },
    // typescript + the type packages the base tsconfig's `lib` needs
    // (`ES2023, DOM`) to typecheck box code (schemas and views) — pinned to
    // the same ranges this engine itself develops against, so `pnpm exec tsc`
    // in the box behaves the same as it does here. `bbx init` writes these
    // once at scaffold time; nothing keeps them in sync afterward (a stale
    // box devDependency is the box owner's `bbx upgrade` to fix, same as any
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
    // release smoke test's `bbx serve` step, which failed exactly this way
    // against a real fresh install.
    pnpm: {
      onlyBuiltDependencies: BOX_BUILT_DEPENDENCIES,
    },
  };
  await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");

  await writeFileIfAbsent(
    path.join(packageRoot, "tsconfig.json"),
    JSON.stringify({ extends: "beebox/tsconfig.base.json", include: ["src"] }, null, 2) + "\n"
  );

  await fs.mkdir(path.join(packageRoot, "src"), { recursive: true });

  if (symlinkBeeBox) {
    const nodeModulesDir = path.join(packageRoot, "node_modules");
    if (!(await pathExists(nodeModulesDir))) {
      await fs.mkdir(nodeModulesDir, { recursive: true });
      await fs.symlink(PACKAGE_ROOT, path.join(nodeModulesDir, "beebox"), "dir");
    }
  }
}

/** A scaffolded shapeVersion-3 box: one root. */
export interface ScaffoldedBox {
  /**
   * @deprecated Alias for `boxRoot` — shapeVersion 3 has one root. Kept so
   * callers that still read `.packageRoot` keep compiling and stay correct;
   * a later track deletes it.
   */
  packageRoot: string;
  /** The box root — where `package.json`/`node_modules`/`src/`,
   * `.beebox/box.json`, and every `_`-prefixed operational area live. */
  boxRoot: string;
}

/**
 * Build a valid shapeVersion-3 box at `target`: the npm-package half
 * (`scaffoldPackageRoot`) then the operational half (`initBox`), both on the
 * SAME root. This is the single composition that `bbx init` (fresh), the
 * `init` doctest, and every test fixture (`makeTmpBox`, `test-server`)
 * delegate to, so a valid box is produced exactly one way.
 *
 * Does NOT initialize git or run `bbx init`'s card installers — callers that
 * need those add them on top (production `bbx init` inits git at the root
 * and runs the installers; fixtures skip both).
 *
 * @param target - The box root to create.
 * @param options.deps - Symlink `node_modules/beebox` at the running
 *   engine (native schema/view resolution). Needed by view-compile /
 *   box-local-schema fixtures; skipped by default so card-only fixtures pay
 *   nothing.
 */
export async function scaffoldBoxRoot(
  target: string,
  options?: { deps?: boolean }
): Promise<ScaffoldedBox> {
  const boxRoot = path.resolve(target);
  await scaffoldPackageRoot(boxRoot, { symlinkBeeBox: options?.deps ?? false });
  await initBox(boxRoot, { skipGit: true });
  return { packageRoot: boxRoot, boxRoot };
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
 * version of (`tsconfig.json`) — unlike `package.json`, which is a hard
 * conflict, this is fine to leave in place.
 */
async function writeFileIfAbsent(filePath: string, content: string): Promise<void> {
  if (await pathExists(filePath)) return;
  await fs.writeFile(filePath, content);
}
