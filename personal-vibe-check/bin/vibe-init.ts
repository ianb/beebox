#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";

const cwd = process.cwd();

/**
 * Narrow an unknown value to a plain object we can safely index. Used
 * instead of an `as` cast when reading fields out of `JSON.parse` output.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) {
    return null;
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
  return isRecord(parsed) ? parsed : null;
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function ask(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

// 2. Add scripts
function addScripts(pkgPath: string, pkg: Record<string, unknown>): string[] {
  const existingScripts = isRecord(pkg.scripts) ? pkg.scripts : {};
  const scripts: Record<string, string> = {
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
    if (!(name in existingScripts)) {
      existingScripts[name] = cmd;
      scriptsAdded++;
    }
  }
  pkg.scripts = existingScripts;
  if (scriptsAdded === 0) return [];
  writeJson(pkgPath, pkg);
  return [`Added ${scriptsAdded} scripts to package.json`];
}

// 3. Write eslint.config.ts
function writeEslintConfig(pkg: Record<string, unknown>): string[] {
  const eslintPath = join(cwd, "eslint.config.ts");
  if (existsSync(eslintPath)) return [];
  const dependencies = isRecord(pkg.dependencies) ? pkg.dependencies : {};
  const devDependencies = isRecord(pkg.devDependencies) ? pkg.devDependencies : {};
  const hasReact = Boolean(dependencies.react) || Boolean(devDependencies.react);
  const reactOpt = hasReact ? "true" : "false";
  writeFileSync(
    eslintPath,
    `import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";\nexport default vibeCheck({ react: ${reactOpt} });\n`,
  );
  return ["Created eslint.config.ts"];
}

// 3b. Write prettier.config.ts
function writePrettierConfig(): string[] {
  const prettierPath = join(cwd, "prettier.config.ts");
  if (existsSync(prettierPath)) return [];
  writeFileSync(
    prettierPath,
    'export { default } from "@ianbicking/personal-vibe-check/prettier";\n',
  );
  return ["Created prettier.config.ts"];
}

// 4. Write tsconfig.json
function writeTsconfig(): string[] {
  const tsconfigPath = join(cwd, "tsconfig.json");
  if (existsSync(tsconfigPath)) return [];
  const tsconfig = {
    extends: "@ianbicking/personal-vibe-check/tsconfig.base.json",
    compilerOptions: {
      jsx: "react-jsx",
      lib: ["DOM", "DOM.Iterable", "ES2022"],
    },
    include: ["src/**/*"],
  };
  writeJson(tsconfigPath, tsconfig);
  return ["Created tsconfig.json"];
}

// 5. Write knip.json
async function writeKnipConfig(): Promise<string[]> {
  const knipPath = join(cwd, "knip.json");
  if (existsSync(knipPath)) return [];
  const entryInput = await ask("Entry points for knip (comma-separated)", "src/index.ts");
  const entries = entryInput.split(",").map((s) => s.trim());
  const knip = {
    $schema: "https://unpkg.com/knip@latest/schema.json",
    entry: entries,
    project: ["src/**/*.{ts,tsx}"],
    exclude: ["enumMembers", "duplicates", "types"],
  };
  writeJson(knipPath, knip);
  return ["Created knip.json"];
}

// 6. Install CLI tools + husky + lint-staged (pin versions where needed for compatibility)
function installToolDeps(pkg: Record<string, unknown>): string[] {
  const toolDeps: Record<string, string | null> = {
    eslint: "^9",
    prettier: null,
    oxlint: null,
    knip: null,
    madge: null,
    husky: null,
    "lint-staged": null,
  };
  const devDeps = isRecord(pkg.devDependencies) ? pkg.devDependencies : {};
  const missing = Object.entries(toolDeps)
    .filter(([name]) => !(name in devDeps))
    .map(([name, version]) => (version ? `${name}@${version}` : name));
  if (missing.length === 0) return [];
  console.log(`\nInstalling ${missing.join(", ")}...`);
  execSync(`npm install --save-dev ${missing.join(" ")}`, { stdio: "inherit" });
  return [`Installed ${missing.join(", ")}`];
}

// Add lint-staged config if missing
function addLintStagedConfig(pkgPath: string, pkg: Record<string, unknown>): string[] {
  if ("lint-staged" in pkg) return [];
  const freshPkg = readJson(pkgPath);
  if (!freshPkg) return [];
  freshPkg["lint-staged"] = {
    "src/**/*.{ts,tsx}": ["prettier --write", "eslint"],
  };
  writeJson(pkgPath, freshPkg);
  return ["Added lint-staged config to package.json"];
}

// Set up husky pre-commit hook
function setupHuskyHook(): string[] {
  const huskyDir = join(cwd, ".husky");
  const preCommitPath = join(huskyDir, "pre-commit");
  if (existsSync(preCommitPath)) return [];
  execSync("npx husky init", { stdio: "inherit" });
  writeFileSync(preCommitPath, "npx lint-staged\nnpm run typecheck\n");
  return ["Created .husky/pre-commit"];
}

function groupHasCommand(group: unknown, ...commands: string[]): boolean {
  if (!isRecord(group) || !Array.isArray(group.hooks)) return false;
  return group.hooks.some((h: unknown) => {
    if (!isRecord(h)) return false;
    return h.type === "command" && typeof h.command === "string" && commands.includes(h.command);
  });
}

function removeOldStopHook(hooks: Record<string, unknown>): void {
  if (!Array.isArray(hooks.Stop)) return;
  hooks.Stop = hooks.Stop.filter((group: unknown) => !groupHasCommand(group, "npx vibe-check"));
  if (Array.isArray(hooks.Stop) && hooks.Stop.length === 0) {
    delete hooks.Stop;
  }
}

// 7. Set up Claude Code PostToolUse lint hook
function setupClaudeHook(): string[] {
  const claudeDir = join(cwd, ".claude");
  const claudeSettingsPath = join(claudeDir, "settings.json");
  const lintHookCommand = "npx vibe-check lint --hook";
  // Also detect old shell script hook for migration
  const oldShellHookCommand = '"$CLAUDE_PROJECT_DIR"/.claude/hooks/lint-check.sh';

  const claudeSettings = readJson(claudeSettingsPath) || {};
  const hooks = isRecord(claudeSettings.hooks) ? claudeSettings.hooks : {};
  claudeSettings.hooks = hooks;
  const postToolHooks = hooks.PostToolUse;

  const hasLintHook =
    Array.isArray(postToolHooks) &&
    postToolHooks.some((group: unknown) =>
      groupHasCommand(group, lintHookCommand, oldShellHookCommand),
    );
  if (hasLintHook) return [];

  if (!Array.isArray(hooks.PostToolUse)) {
    hooks.PostToolUse = [];
  }
  removeOldStopHook(hooks);
  const postToolUseArr = hooks.PostToolUse;
  if (Array.isArray(postToolUseArr)) {
    postToolUseArr.push({
      matcher: "Edit|Write",
      hooks: [{ type: "command", command: lintHookCommand }],
    });
  }
  mkdirSync(claudeDir, { recursive: true });
  writeJson(claudeSettingsPath, claudeSettings);
  return ["Added lint hook to .claude/settings.json"];
}

// 8. Copy conventions.md and add @conventions.md to CLAUDE.md
function copyConventions(): string[] {
  const created: string[] = [];
  const selfDir = import.meta.dirname;
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
  return created;
}

function printSummary(created: string[]): void {
  console.log("\n" + "─".repeat(40));
  if (created.length === 0) {
    console.log("vibe-init: everything already set up!");
    return;
  }
  console.log("vibe-init: done!\n");
  for (const item of created) {
    console.log(`  ✓ ${item}`);
  }
  console.log(
    "\nNext steps:\n  1. Run `npx vibe-check` to verify\n  2. Review CLAUDE.md and .claude/settings.json",
  );
}

async function main() {
  console.log("vibe-init: bootstrapping project\n");

  // 1. Check for package.json
  const pkgPath = join(cwd, "package.json");
  const pkg = readJson(pkgPath);
  if (!pkg) {
    console.error("Error: no package.json found. Run `npm init` first.");
    process.exit(1);
  }

  const created: string[] = [
    ...addScripts(pkgPath, pkg),
    ...writeEslintConfig(pkg),
    ...writePrettierConfig(),
    ...writeTsconfig(),
    ...(await writeKnipConfig()),
    ...installToolDeps(pkg),
    ...addLintStagedConfig(pkgPath, pkg),
    ...setupHuskyHook(),
    ...setupClaudeHook(),
    ...copyConventions(),
  ];

  printSummary(created);
}

main();
