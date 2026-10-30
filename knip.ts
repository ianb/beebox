import type { KnipConfig } from "knip";

/**
 * Knip runs from the MONOREPO ROOT, not from beebox.
 *
 * `pnpm-workspace.yaml` sets `nodeLinker: hoisted`, so every package's dependencies are
 * installed into the root `node_modules` — `beebox/node_modules` holds
 * two entries. Run per-package, knip cannot map a binary a script invokes
 * (`eslint`, `tsc`, `tap`) back to the package declaring it, and reports the
 * same tool as an unlisted binary AND an unused devDependency at once. From
 * the root the modules are where knip expects, and that whole class goes away.
 *
 * One run also means the workspaces can see each other: bin/ imports
 * beebox/src by relative path, the frontend imports src/shared via
 * @shared/*, and beebox's tests exercise frontend machines. Analyzed
 * separately, each side reads the others' live code as dead.
 */
const config: KnipConfig = {
  workspaces: {
    // Monorepo tooling: bin/ (the dev router, hooks, generators) and dev/.
    ".": {
      entry: ["bin/*.ts", "bin/**/*.test.ts"],
      project: ["bin/**/*.ts"],
    },
    "beebox": {
      entry: [
        "src/webapp/server/app.ts",
        "src/schemas.ts",
        "src/connectors.ts",
        "src/cli/entry/run.ts",
        "src/webapp/server-main.ts",
        "src/dev/gen-image.ts",
        // Declarative-only `defineRegistry` completeness declaration
        // (docs/implemented-plans/file-layout.md rule 1/4): `appRouter` is built from the
        // same `routerMembers` object, but nothing imports the registry
        // module for its own sake.
        "src/webapp/trpc/routers.ts",
        // The box-facing specifiers (beebox/cards, ./schema, ./server)
        // need no entry: knip reads package.json "exports" and maps the dist
        // paths back through tsconfig. Same for the frontend's main.tsx, which
        // its Vite config names.
        //
        // The suite is a consumer too: an export reached only from a test is
        // used.
        "test/**/*.ts",
        "src/scripts/**/*.ts",
      ],
      project: [
        "src/**/*.{ts,tsx}",
        "!src/frontend/**",
        "!src/schemas/*/list-entry.tsx",
        "test/**/*.ts",
        "src/scripts/**/*.ts",
      ],
      ignoreDependencies: [
        // Resolved dynamically, so no static import exists to find:
        // gmail-gws.ts does createRequire().resolve("@googleworkspace/cli/run.js").
        "@googleworkspace/cli",
        // lib/twemoji.ts does require_.resolve("@twemoji/svg/package.json")
        // to find the asset directory; there is no import of the package.
        "@twemoji/svg",
        // Its config block lives in beebox/package.json, but the runner
        // is the monorepo-root .husky/pre-commit — knip sees neither end.
        "lint-staged",
        "markdown-it",
      ],
    },
    "beebox/src/frontend": {
      entry: [
        "src/exports/view-widgets.tsx",
        // Bundled on its own into the deploy page by
        // beebox/src/scripts/build-deploy-page.ts, which names it by path.
        "src/deploy-page/poll.ts",
        // The suite is a consumer too: an export reached only from a test is
        // used.
        "test/**/*.ts",
      ],
      project: ["src/**/*.{ts,tsx,css}", "../schemas/*/list-entry.tsx", "test/**/*.{ts,tsx}"],
      ignoreDependencies: [
        // Named as a plain string in vite.config.ts's babel plugin list, and
        // the runtime it injects is never imported by hand (React 18 needs it;
        // 19 ships its own).
        "babel-plugin-react-compiler",
        "react-compiler-runtime",
        // Never imported: test/helpers/dom-globals.ts imports
        // @happy-dom/global-registrator, which takes happy-dom as ^20.14.6.
        // Listing it here pins the shim itself (docs/implemented-plans/frontend-dom-harness.md).
        "happy-dom",
      ],
    },
  },
  // Out of scope for this config. Each is its own package with its own
  // backlog; folding them in is a separate piece of work, not a config line.
  ignoreWorkspaces: [
    "tap-check",
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
    // (knip 6 no longer reports launchctl, claude, tar, ps or lsof.)
    "pdfinfo",
    "pdftotext",
    "pdftoppm",
    "qpdf",
    "uvx",
    // bin/deploy-lock.test.ts reads the deploy log with `tail`.
    "tail",
    // box-growth/bytes.ts measures disk use with `du -sk`.
    "du",
    // test/lib/typescript/syntax.test.ts counts its own child processes with `pgrep -P`.
    "pgrep",
    // beebox's own bin, invoked as an installed command by the smoke test.
    "bbx",
    // beebox package scripts, invoked across the workspace boundary:
    // bin/deferred-issues.ts and bin/lib/manual-testing.sh run
    // `pnpm --dir beebox doc-check`, and the root postinstall runs
    // `pnpm --dir beebox exec tap build`. Knip reads the command word as a
    // binary this workspace must declare; the declaring package is beebox.
    "doc-check",
    "tap",
    // `pnpm --dir site build` and a GitHub Actions job named `build`; neither
    // is a binary, knip's script and workflow parsers just read them as one.
    "build",
  ],
  exclude: ["enumMembers", "duplicates", "types"],
  // `@public` marks an export consumed from outside its own package in a way
  // the graph cannot show. Carried at the declaration, naming the consumer, so
  // the exemption is auditable there rather than as a list in this file.
  tags: ["-public"],
};

export default config;
