/**
 * Package-root scaffolding for shapeVersion 3 boxes (the one-root layout —
 * `docs/implemented-plans/one-root-box-layout.md`). `bbx engine init` on a path with no
 * existing box detects a fresh init and scaffolds the npm-package half
 * (`package.json`, `tsconfig.json`, `src/`) directly at the box root; the
 * operational half (the marker, the underscore areas, `.gitignore`) is
 * `initBox` in `./index.js`, run on the SAME directory right after. An
 * existing box is left in place — `bbx engine init` re-runs its provisioning
 * without moving anything.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { initBox, isValidBox } from "./structure/core.js";
import { ENGINE_LINK, ENGINE_LINK_SPEC, ensureEngineLink } from "./engine-link.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import { fileExists } from "../../lib/file-exists.js";

const EnginePackageJsonSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});
const FrontendPackageJsonSchema = z.object({
  devDependencies: z.record(z.string(), z.string()).optional(),
});

export type BoxInitMode = "fresh" | "update";

/**
 * Thrown when a fresh `bbx engine init` would overwrite a package.json it didn't
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
 * Dependencies whose install scripts a box's `pnpm install` must be allowed
 * to run (pnpm 10 blocks every postinstall by default; non-interactively a
 * blocked build is a hard error). Written into each box's package.json as
 * `pnpm.onlyBuiltDependencies` and passed as `--allow-build` flags by the
 * smoke scripts. The two shell copies — `docker/Dockerfile` and
 * `docker/entrypoint.sh` — must be updated by hand; no script compares them.
 */
export const BOX_BUILT_DEPENDENCIES = [
  "esbuild",
  "@googleworkspace/cli",
];

export interface BoxTarget {
  mode: BoxInitMode;
  /** The box root — the ONE root; `package.json` (with its `beebox` shape
   * block), `_content/`, `_config/`, `node_modules`/`src/` all live here (or will). */
  boxRoot: string;
}

/**
 * Decide what `bbx engine init <path>` is looking at: an existing box
 * (`isValidBox`: a beebox package.json beside `_config/`, so a clone counts)
 * or nothing yet.
 */
export async function detectBoxTarget(targetPath: string): Promise<BoxTarget> {
  const resolvedRoot = path.resolve(targetPath);
  const mode: BoxInitMode = (await isValidBox(resolvedRoot)) ? "update" : "fresh";
  return { mode, boxRoot: resolvedRoot };
}

const NATIVE_ALIAS_PREFIX = "npm:typescript@";

/** The engine's `@typescript/native` dependency is missing or not an `npm:typescript@` alias. */
class EngineTypescriptAliasError extends Error {
  readonly spec: string | undefined;
  constructor(spec: string | undefined) {
    super(`Expected @typescript/native to be "${NATIVE_ALIAS_PREFIX}<range>" in the engine's dependencies, found ${spec ?? "nothing"}`);
    this.name = "EngineTypescriptAliasError";
    this.spec = spec;
  }
}

/** `npm:typescript@7.0.2` → `7.0.2`. */
function boxTypescriptRange(spec: string | undefined): string {
  if (spec?.startsWith(NATIVE_ALIAS_PREFIX) !== true || spec.length === NATIVE_ALIAS_PREFIX.length) {
    throw new EngineTypescriptAliasError(spec);
  }
  return spec.slice(NATIVE_ALIAS_PREFIX.length);
}

interface EngineVersions {
  /**
   * `typescript`'s version range: the TypeScript 7 version the engine runs
   * (its `@typescript/native` alias). A box has no typescript-eslint, so it
   * uses the plain name.
   */
  typescript: string;
  /** `@types/node`'s version range, read from the engine's own `devDependencies`. */
  typesNode: string;
  /** `@types/react`'s version range, read from the engine's frontend workspace member. */
  typesReact: string;
  /** `react`/`react-dom` ranges, read from the engine's own `dependencies`. */
  react: string;
  reactDom: string;
  /** `zod`'s range, read from the engine's own `dependencies`. */
  zod: string;
}

/**
 * Read the versions the scaffolded box's `package.json` pins:
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
    typescript: boxTypescriptRange(engine.dependencies?.["@typescript/native"]),
    typesNode: engine.devDependencies?.["@types/node"] ?? "^22.0.0",
    typesReact: frontend.devDependencies?.["@types/react"] ?? "^18.3.0",
    react: engine.dependencies?.react ?? "^18.3.1",
    reactDom: engine.dependencies?.["react-dom"] ?? "^18.3.1",
    zod: engine.dependencies?.zod ?? "^4.4.3",
  };
}

/**
 * Scaffold the npm-package half of a fresh box: `package.json`,
 * `tsconfig.json`, `src/`. Idempotent in the sense that every write is a
 * plain overwrite, but it's only ever called for a genuinely fresh init (see
 * `detectBoxTarget`) — an existing box root is never touched by `bbx engine init`.
 *
 * Deliberately does NOT run `pnpm install`. Instead it points the engine
 * link (`.beebox/engine`, `./engine-link.ts`) at the running engine's
 * `PACKAGE_ROOT` and, when `node_modules/` is absent, links
 * `node_modules/beebox` to it the way `pnpm install` would, so the box is
 * loadable (native schema/view resolution) before a real install happens.
 *
 * `detectBoxTarget` only checks whether `targetPath` is a *box* — a plain
 * non-empty directory (an existing project, a directory with an unrelated
 * package.json) still reads as "fresh." Overwriting that directory's
 * `package.json` would silently clobber someone else's package, so a
 * pre-existing `package.json` is a hard conflict; `tsconfig.json` is only
 * written when absent, so a directory that already has its own is left
 * alone. `AGENTS.md` and `.gitignore` are NOT written here — `initBox`
 * (`./index.js`, run right after on the same root) owns both, since they
 * cover the operational half too (the AGENTS.md `@`-includes, the merged
 * ignore rules).
 * @param options.symlinkBeeBox - Whether to make the engine link and
 *   `node_modules/beebox`.
 *   Production `bbx engine init` wants it (native schema/view resolution); cheap
 *   fixtures that only read/write cards don't, and skip it. Defaults to true.
 * @throws BoxPackageConflictError if `boxRoot` already has a `package.json`
 */
export async function scaffoldPackageRoot(
  boxRoot: string,
  options?: { symlinkBeeBox?: boolean }
): Promise<void> {
  const symlinkBeeBox = options?.symlinkBeeBox ?? true;
  await fs.mkdir(boxRoot, { recursive: true });

  const packageJsonPath = path.join(boxRoot, "package.json");
  if (await fileExists(packageJsonPath)) {
    throw new BoxPackageConflictError(
      `Cannot initialize a beebox package at ${boxRoot}: it already has a ` +
        "package.json. Fresh `bbx engine init` scaffolds a new coding-session package there and " +
        "won't overwrite an existing one — remove it first, or run `bbx engine init` on the " +
        "directory only after confirming it's meant to become a box package."
    );
  }

  const versions = await readEngineVersions();
  // The portable spec resolves through the gitignored engine link, so the
  // tracked value is the same on every machine. `BBX_INIT_BEEBOX_SPEC` pins
  // something else, such as the release smoke tests' `file:<tarball>`.
  const beeBoxSpec = process.env.BBX_INIT_BEEBOX_SPEC ?? ENGINE_LINK_SPEC;
  const packageJson = {
    name: path.basename(boxRoot),
    private: true,
    type: "module",
    // react/react-dom are DIRECT deps of the box, not left to hoisting:
    // node-target compiled views externalize react/jsx-runtime, and pnpm's
    // strict isolation does not place beebox's transitive react at the
    // box root — without these, `bbx view check` and view-metadata import fail
    // on any JSX view in a real (installed, non-symlinked) box. Ranges match
    // the engine's so the single-React-instance invariant holds.
    dependencies: {
      "beebox": beeBoxSpec,
      react: versions.react,
      "react-dom": versions.reactDom,
      // Every box-local card schema imports `zod` — `cardSchema()` takes zod
      // types for its fields. A box scaffolded without it loaded its schemas
      // to a bare `Cannot find package 'zod'` warning, and cards of that type
      // then validated as if the schema had never been written.
      zod: versions.zod,
    },
    // typescript + the type packages the base tsconfig's `lib` needs
    // (`ES2023, DOM`) to typecheck box code (schemas and views) — pinned to
    // the same ranges this engine itself develops against, so `pnpm exec tsc`
    // in the box behaves the same as it does here. `bbx engine init` writes these
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
    path.join(boxRoot, "tsconfig.json"),
    JSON.stringify({ extends: "beebox/tsconfig.base.json", include: ["src"] }, null, 2) + "\n"
  );

  await fs.mkdir(path.join(boxRoot, "src"), { recursive: true });

  if (symlinkBeeBox) {
    if (beeBoxSpec === ENGINE_LINK_SPEC) await ensureEngineLink(boxRoot, PACKAGE_ROOT);
    const nodeModulesDir = path.join(boxRoot, "node_modules");
    if (!(await fileExists(nodeModulesDir))) {
      await fs.mkdir(nodeModulesDir, { recursive: true });
      // The same relative link `pnpm install` makes for the portable spec.
      const target = beeBoxSpec === ENGINE_LINK_SPEC ? path.join("..", ENGINE_LINK) : PACKAGE_ROOT;
      await fs.symlink(target, path.join(nodeModulesDir, "beebox"), "dir");
    }
  }
}

/** A scaffolded shapeVersion-3 box: one root. */
export interface ScaffoldedBox {
  /** The box root — where `package.json`/`node_modules`/`src/`,
   * and every `_`-prefixed operational area live. */
  boxRoot: string;
}

/**
 * Build a valid shapeVersion-3 box at `target`: the npm-package half
 * (`scaffoldPackageRoot`) then the operational half (`initBox`), both on the
 * SAME root. This is the single composition that `bbx engine init` (fresh), the
 * `init` test, and every test fixture (`makeTmpBox`, `test-server`)
 * delegate to, so a valid box is produced exactly one way.
 *
 * Does NOT initialize git or run `bbx engine init`'s card installers — callers that
 * need those add them on top (production `bbx engine init` inits git at the root
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
  return { boxRoot };
}

/**
 * Write `content` to `filePath` only if nothing is there yet. Used for the
 * package scaffold files that a directory might already have its own
 * version of (`tsconfig.json`) — unlike `package.json`, which is a hard
 * conflict, this is fine to leave in place.
 */
async function writeFileIfAbsent(filePath: string, content: string): Promise<void> {
  if (await fileExists(filePath)) return;
  await fs.writeFile(filePath, content);
}
