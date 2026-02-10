/**
 * cb init-rules - Generate .claude/rules/ files from card schemas.
 *
 * Each card type with instructions gets a rule file that auto-loads
 * when an agent reads or edits a matching card file.
 */

import { Command } from "commander";
import { resolve, join } from "node:path";
import { mkdir, writeFile, readdir, unlink } from "node:fs/promises";
import { schemas } from "../../schemas/registry.js";

/**
 * Generate rules files from schema instructions.
 *
 * Exported so `cb init` can call it directly.
 */
export async function generateRules(boxRoot: string): Promise<string[]> {
  const rulesDir = join(boxRoot, ".claude", "rules");
  await mkdir(rulesDir, { recursive: true });

  // Clean up old generated card rules
  try {
    const existing = await readdir(rulesDir);
    for (const file of existing) {
      if (file.startsWith("card-") && file.endsWith(".md")) {
        await unlink(join(rulesDir, file));
      }
    }
  } catch {
    // Directory may not exist yet, that's fine
  }

  const generated: string[] = [];

  for (const schema of schemas) {
    if (!schema.instructions) continue;

    const glob = `**/*.${schema.tagName}.card`;
    const filename = `card-${schema.tagName}.md`;
    const content = `---
paths:
  - "${glob}"
---

${schema.instructions.trim()}
`;

    await writeFile(join(rulesDir, filename), content);
    generated.push(filename);
  }

  return generated;
}

export const initRulesCommand = new Command("init-rules")
  .description("Generate .claude/rules/ files from card schemas")
  .argument("[path]", "Box root path", ".")
  .action(async (targetPath: string) => {
    try {
      const boxRoot = resolve(targetPath);
      const generated = await generateRules(boxRoot);

      if (generated.length === 0) {
        console.log("No schemas with instructions found.");
      } else {
        console.log(`Generated ${generated.length} rule files in .claude/rules/:`);
        for (const file of generated) {
          console.log(`  ${file}`);
        }
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });
