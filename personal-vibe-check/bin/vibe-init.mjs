#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";

const cwd = process.cwd();

function readJson(path) {
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function ask(question, defaultValue) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

async function main() {
  console.log("vibe-init: bootstrapping project\n");

  const created = [];

  // 1. Check for package.json
  const pkgPath = join(cwd, "package.json");
  const pkg = readJson(pkgPath);
  if (!pkg) {
    console.error("Error: no package.json found. Run `npm init` first.");
    process.exit(1);
  }

  // 2. Add scripts
  if (!pkg.scripts) {
    pkg.scripts = {};
  }
  const scripts = {
    typecheck: "tsc --noEmit",
    lint: "eslint src/",
    "lint:oxlint": "oxlint -A no-unused-vars",
    "lint:knip": "knip",
    "lint:circular": "madge --circular --extensions ts,tsx src/",
    prepare: "husky",
  };
  let scriptsAdded = 0;
  for (const [name, cmd] of Object.entries(scripts)) {
    if (!pkg.scripts[name]) {
      pkg.scripts[name] = cmd;
      scriptsAdded++;
    }
  }
  if (scriptsAdded > 0) {
    writeJson(pkgPath, pkg);
    created.push(`Added ${scriptsAdded} scripts to package.json`);
  }

  // 3. Write eslint.config.mjs
  const eslintPath = join(cwd, "eslint.config.mjs");
  if (!existsSync(eslintPath)) {
    const hasReact =
      (pkg.dependencies && pkg.dependencies.react) ||
      (pkg.devDependencies && pkg.devDependencies.react);
    const reactOpt = hasReact ? "true" : "false";
    writeFileSync(
      eslintPath,
      `import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";\nexport default vibeCheck({ react: ${reactOpt} });\n`
    );
    created.push("Created eslint.config.mjs");
  }

  // 4. Write tsconfig.json
  const tsconfigPath = join(cwd, "tsconfig.json");
  if (!existsSync(tsconfigPath)) {
    const tsconfig = {
      extends: "@ianbicking/personal-vibe-check/tsconfig.base.json",
      compilerOptions: {
        jsx: "react-jsx",
        lib: ["DOM", "DOM.Iterable", "ES2022"],
      },
      include: ["src/**/*"],
    };
    writeJson(tsconfigPath, tsconfig);
    created.push("Created tsconfig.json");
  }

  // 5. Write knip.json
  const knipPath = join(cwd, "knip.json");
  if (!existsSync(knipPath)) {
    const entryInput = await ask(
      "Entry points for knip (comma-separated)",
      "src/index.ts"
    );
    const entries = entryInput.split(",").map((s) => s.trim());
    const knip = {
      $schema: "https://unpkg.com/knip@latest/schema.json",
      entry: entries,
      project: ["src/**/*.{ts,tsx}"],
      exclude: ["enumMembers", "duplicates", "types"],
    };
    writeJson(knipPath, knip);
    created.push("Created knip.json");
  }

  // 6. Install CLI tools + husky + lint-staged
  // Pin versions where needed for compatibility
  const toolDeps = {
    eslint: "^9",
    oxlint: null,
    knip: null,
    madge: null,
    husky: null,
    "lint-staged": null,
  };
  const devDeps = pkg.devDependencies || {};
  const missing = Object.entries(toolDeps)
    .filter(([name]) => !devDeps[name])
    .map(([name, version]) => (version ? `${name}@${version}` : name));
  if (missing.length > 0) {
    console.log(`\nInstalling ${missing.join(", ")}...`);
    execSync(`npm install --save-dev ${missing.join(" ")}`, { stdio: "inherit" });
    created.push(`Installed ${missing.join(", ")}`);
  }

  // Add lint-staged config if missing
  if (!pkg["lint-staged"]) {
    const freshPkg = readJson(pkgPath);
    freshPkg["lint-staged"] = {
      "src/**/*.{ts,tsx}": ["eslint"],
    };
    writeJson(pkgPath, freshPkg);
    created.push("Added lint-staged config to package.json");
  }

  // Set up husky pre-commit hook
  const huskyDir = join(cwd, ".husky");
  const preCommitPath = join(huskyDir, "pre-commit");
  if (!existsSync(preCommitPath)) {
    execSync("npx husky init", { stdio: "inherit" });
    writeFileSync(preCommitPath, "npx lint-staged\nnpm run typecheck\n");
    created.push("Created .husky/pre-commit");
  }

  // 7. Summary
  console.log("\n" + "─".repeat(40));
  if (created.length === 0) {
    console.log("vibe-init: everything already set up!");
  } else {
    console.log("vibe-init: done!\n");
    for (const item of created) {
      console.log(`  ✓ ${item}`);
    }
    console.log(
      "\nNext steps:\n  1. Run `npx vibe-check` to verify\n  2. Add CONVENTIONS.md content to your CLAUDE.md"
    );
  }
}

main();
