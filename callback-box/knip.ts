import type { KnipConfig } from "knip";
import { doctestImports } from "./scripts/knip-doctest-imports.js";

/**
 * Backend and frontend are configured as one knip run rather than two, because
 * they share code: the frontend imports `src/shared/**` through `@shared/*`.
 * Analyzed separately, every such export reads as dead on the backend side.
 */
const config: KnipConfig = {
  workspaces: {
    ".": {
      entry: [
        "src/webapp/server.ts",
        "src/schemas/index.ts",
        "src/connectors/index.ts",
        "src/cli/index.ts",
        "src/webapp/server-main.ts",
        "src/dev/gen-image.ts",
        // Published specifiers (package.json "exports"). Boxes import these,
        // so they are entry points even with no in-repo importer.
        "src/cards/index.ts",
        "src/exports/schema.ts",
        "src/exports/server.ts",
        // The suite is a consumer too: an export reached only from a test is
        // used. Doctests are markdown — see `compilers` below.
        "test/**/*.ts",
        "test/**/*.doctest.md",
        "field-tests/**/*.doctest.md",
        "scripts/**/*.ts",
      ],
      project: [
        "src/**/*.{ts,tsx}",
        "!src/frontend/**",
        "test/**/*.ts",
        "test/**/*.doctest.md",
        "field-tests/**/*.doctest.md",
        "scripts/**/*.ts",
      ],
      ignoreDependencies: [
        "@ianbicking/personal-vibe-check",
        "@parcel/markdown-ansi",
        "ansi-to-html",
        "agent-doctest",
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
    "src/frontend": {
      entry: ["src/main.tsx", "src/components/view-widgets/node-entry.tsx"],
      project: ["src/**/*.{ts,tsx}"],
    },
  },
  exclude: ["enumMembers", "duplicates", "types"],
  // `@public` marks an export consumed from OUTSIDE this package — bin/ and the
  // other monorepo checkouts import a handful of modules by relative path, and
  // a package-scoped knip run cannot see those importers. The tag carries the
  // consumer's name at the declaration, so the exemption is auditable there
  // rather than accumulating as an opaque list in this file.
  tags: ["-public"],
  // Doctests are markdown; knip parses TypeScript. Without this every export
  // whose only consumer is a doctest reads as dead. See the module's header.
  compilers: { md: doctestImports },
};

export default config;
