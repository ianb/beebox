import type { KnipConfig } from "knip";
import { doctestImports } from "./beebox/scripts/knip-doctest-imports.js";

/**
 * Knip runs from the MONOREPO ROOT, not from beebox.
 *
 * `.npmrc` sets `node-linker=hoisted`, so every package's dependencies are
 * installed into the root `node_modules` — `beebox/node_modules` holds
 * two entries. Run per-package, knip cannot map a binary a script invokes
 * (`eslint`, `tsc`, `tap`) back to the package declaring it, and reports the
 * same tool as an unlisted binary AND an unused devDependency at once. From
 * the root the modules are where knip expects, and that whole class goes away.
 *
 * One run also means the workspaces can see each other: bin/ imports
 * beebox/src by relative path, the frontend imports src/shared via
 * @shared/*, and beebox's doctests exercise frontend machines. Analyzed
 * separately, each side reads the others' live code as dead.
 */
const config: KnipConfig = {
  workspaces: {
    // Monorepo tooling: bin/ (the dev router, hooks, generators) and dev/.
    ".": {
      entry: ["bin/*.ts", "bin/**/*.test.ts"],
      project: ["bin/**/*.ts"],
      // Invoked through bin/browse, a shell script knip does not read.
      ignoreDependencies: ["agent-browser"],
    },
    "beebox": {
      entry: [
        "src/webapp/server.ts",
        "src/schemas/index.ts",
        "src/connectors/index.ts",
        "src/cli/index.ts",
        "src/webapp/server-main.ts",
        "src/dev/gen-image.ts",
        // The box-facing specifiers (beebox/cards, ./schema, ./server)
        // need no entry: knip reads package.json "exports" and maps the dist
        // paths back through tsconfig. Same for the frontend's main.tsx, which
        // its Vite config names.
        //
        // The suite is a consumer too: an export reached only from a test is
        // used. Doctests are markdown — see `compilers` below.
        "test/**/*.ts",
        "test/**/*.doctest.md",
        "scripts/**/*.ts",
      ],
      project: [
        "src/**/*.{ts,tsx}",
        "!src/frontend/**",
        "test/**/*.ts",
        "test/**/*.doctest.md",
        "scripts/**/*.ts",
      ],
      ignoreDependencies: [
        // Resolved dynamically, so no static import exists to find:
        // gmail-gws.ts does createRequire().resolve("@googleworkspace/cli/run.js"),
        // and the two ansi packages are require()d only when rendering fails.
        "@googleworkspace/cli",
        "@parcel/markdown-ansi",
        "ansi-to-html",
        // Its config block lives in beebox/package.json, but the runner
        // is the monorepo-root .husky/pre-commit — knip sees neither end.
        "lint-staged",
        // Frontend deps, reached from test/frontend/*.doctest.md.
        "xstate",
        "@ianbicking/canvas-loop",
      ],
      // Two doctests dynamic-import a module from inside a template literal
      // that a spawned subprocess evaluates, so the specifier is relative to
      // the package root rather than to the .md file. The edge is real; only
      // knip's resolution of it from this location fails.
      ignoreUnresolved: [
        "./src/webapp/auth-capabilities.ts",
        "./src/webapp/box-config-write.ts",
      ],
    },
    "beebox/src/frontend": {
      entry: ["src/components/view-widgets/node-entry.tsx"],
      project: ["src/**/*.{ts,tsx}"],
      ignoreDependencies: [
        // Named as a plain string in vite.config.ts's babel plugin list, and
        // the runtime it injects is never imported by hand (React 18 needs it;
        // 19 ships its own).
        "babel-plugin-react-compiler",
        "react-compiler-runtime",
        // Config block lives here, runner is the root .husky/pre-commit.
        "lint-staged",
      ],
    },
  },
  // Out of scope for this config. Each is its own package with its own
  // backlog; folding them in is a separate piece of work, not a config line.
  ignoreWorkspaces: [
    "agent-doctest",
    "browse",
    "browse/**",
    "beebox/pub-worker",
    "beebox-clerk",
    "canvas-loop",
    "personal-vibe-check",
    "scan-uploader",
    "site",
    "workstreams-app",
  ],
  ignoreBinaries: [
    // System tools, not npm packages — there is no dependency to declare.
    // launchctl (bin/schedules install) and claude (the headless launcher's
    // install-time probe) are the same kind.
    "launchctl",
    "claude",
    "pdfinfo",
    "pdftotext",
    "pdftoppm",
    "qpdf",
    "uvx",
    "tar",
    "ps",
    "lsof",
    // beebox's own bin, invoked as an installed command by the smoke test.
    "bbx",
    // A tracked executable in this repo, run by the root `dev` script.
    "bin/workstreams",
    // `pnpm --dir site build` and a GitHub Actions job named `build`; neither
    // is a binary, knip's script and workflow parsers just read them as one.
    "build",
  ],
  exclude: ["enumMembers", "duplicates", "types"],
  // `@public` marks an export consumed from outside its own package in a way
  // the graph cannot show. Carried at the declaration, naming the consumer, so
  // the exemption is auditable there rather than as a list in this file.
  tags: ["-public"],
  // Doctests are markdown; knip parses TypeScript. Without this every export
  // whose only consumer is a doctest reads as dead. See the module's header.
  compilers: { md: doctestImports },
};

export default config;
