#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
    format: "prettier --write src/",
    "format:check": "prettier --check src/",
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
      `import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";\nexport default vibeCheck({ react: ${reactOpt} });\n`,
    );
    created.push("Created eslint.config.mjs");
  }

  // 3b. Write prettier.config.mjs
  const prettierPath = join(cwd, "prettier.config.mjs");
  if (!existsSync(prettierPath)) {
    writeFileSync(
      prettierPath,
      `export { default } from "@ianbicking/personal-vibe-check/prettier";\n`,
    );
    created.push("Created prettier.config.mjs");
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
    const entryInput = await ask("Entry points for knip (comma-separated)", "src/index.ts");
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
    prettier: null,
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
      "src/**/*.{ts,tsx}": ["prettier --write", "eslint"],
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

  // 7. Set up Claude Code PostToolUse lint hook
  const claudeDir = join(cwd, ".claude");
  const claudeSettingsPath = join(claudeDir, "settings.json");
  const lintHookCommand = "npx vibe-check lint --hook";
  const claudeSettings = readJson(claudeSettingsPath) || {};
  const postToolHooks = claudeSettings.hooks && claudeSettings.hooks.PostToolUse;
  // Also detect old shell script hook for migration
  const oldShellHookCommand = '"$CLAUDE_PROJECT_DIR"/.claude/hooks/lint-check.sh';
  const hasLintHook =
    Array.isArray(postToolHooks) &&
    postToolHooks.some(
      (group) =>
        Array.isArray(group.hooks) &&
        group.hooks.some(
          (h) =>
            h.type === "command" &&
            (h.command === lintHookCommand || h.command === oldShellHookCommand),
        ),
    );
  if (!hasLintHook) {
    if (!claudeSettings.hooks) {
      claudeSettings.hooks = {};
    }
    if (!Array.isArray(claudeSettings.hooks.PostToolUse)) {
      claudeSettings.hooks.PostToolUse = [];
    }
    // Remove old Stop vibe-check hook if present
    if (Array.isArray(claudeSettings.hooks.Stop)) {
      claudeSettings.hooks.Stop = claudeSettings.hooks.Stop.filter(
        (group) =>
          !(
            Array.isArray(group.hooks) &&
            group.hooks.some((h) => h.type === "command" && h.command === "npx vibe-check")
          ),
      );
      if (claudeSettings.hooks.Stop.length === 0) {
        delete claudeSettings.hooks.Stop;
      }
    }
    claudeSettings.hooks.PostToolUse.push({
      matcher: "Edit|Write",
      hooks: [{ type: "command", command: lintHookCommand }],
    });
    mkdirSync(claudeDir, { recursive: true });
    writeJson(claudeSettingsPath, claudeSettings);
    created.push("Added lint hook to .claude/settings.json");
  }

  // 8. Copy conventions.md and add @conventions.md to CLAUDE.md
  const selfDir = dirname(fileURLToPath(import.meta.url));
  const srcConventions = join(selfDir, "..", "conventions.md");
  const destConventions = join(cwd, "conventions.md");
  if (!existsSync(destConventions)) {
    copyFileSync(srcConventions, destConventions);
    created.push("Copied conventions.md into project");
  }
  const claudeMdPath = join(cwd, "CLAUDE.md");
  const claudeMdContent = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, "utf-8") : "";
  if (!claudeMdContent.includes("@conventions.md")) {
    const separator =
      claudeMdContent.length > 0 && !claudeMdContent.endsWith("\n")
        ? "\n\n"
        : claudeMdContent.length > 0
          ? "\n"
          : "";
    writeFileSync(claudeMdPath, claudeMdContent + separator + "@conventions.md\n");
    created.push("Added @conventions.md to CLAUDE.md");
  }

  // 9. Summary
  console.log("\n" + "─".repeat(40));
  if (created.length === 0) {
    console.log("vibe-init: everything already set up!");
  } else {
    console.log("vibe-init: done!\n");
    for (const item of created) {
      console.log(`  ✓ ${item}`);
    }
    console.log(
      "\nNext steps:\n  1. Run `npx vibe-check` to verify\n  2. Review CLAUDE.md and .claude/settings.json",
    );
  }
}

main();
