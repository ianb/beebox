/**
 * cb init - Initialize a new callback box
 */

import { Command } from "commander";
import { resolve, join } from "node:path";
import { readFile, writeFile, rename, access } from "node:fs/promises";
import { initBox, installWorkflows, installGuides, installSchedules } from "../../core/box.js";
import { generateRules } from "./init-rules.js";
import { generateDocs, setDocIdDebug } from "../../core/generate-docs.js";
import { parseXml } from "cardworks";
import { parseNewsGuide, type NewsGuide } from "../../schemas/news-guide.js";

export const initCommand = new Command("init")
  .description("Initialize or update a callback box")
  .argument("[path]", "Path to initialize", ".")
  .option("--skip-git", "Skip git initialization")
  .option("-b, --branch <name>", "Initial branch name", "main")
  .option("--docid-debug", "Add DOCID markers to generated docs (persists until --no-docid-debug)")
  .action(async (targetPath: string, options: { skipGit?: boolean; branch: string; docidDebug?: boolean }) => {
    try {
      const { isUpdate } = await initBox(targetPath, {
        skipGit: options.skipGit,
        branch: options.branch,
      });

      if (isUpdate) {
        console.log(`Updated callback box at ${resolve(targetPath)}`);
        console.log("  Ensured standard directories exist");
        console.log("  Updated .gitignore");
      } else {
        console.log(`Initialized callback box at ${targetPath}`);

        if (!options.skipGit) {
          console.log("Git repository initialized with initial commit.");
        }

        console.log("\nDirectory structure created:");
        console.log("  box/inbox/          - Incoming items");
        console.log("  box/inbox/unhandled - Items with no clear destination");
        console.log("  box/questions/      - Pending questions");
        console.log("  box/resources/      - Synced external state");
        console.log("  store/archive/      - Processed items");
        console.log("  store/integrated/   - Feedback absorbed into briefs");
        console.log("  store/trash/        - Soft-deleted items");
        console.log("  config/             - Configuration");
        console.log("  .claude/            - Agent configuration");
      }

      // Install workflow templates
      const workflows = await installWorkflows(resolve(targetPath));
      if (workflows.length > 0) {
        console.log(`\nInstalled ${workflows.length} workflow(s) in config/workflows/`);
        for (const w of workflows) {
          console.log(`  ${w}`);
        }
      }

      // Migrate legacy guide formats (before installGuides so migrated files aren't overwritten)
      await migrateGuides(resolve(targetPath));

      // Install default guide cards
      const guides = await installGuides(resolve(targetPath));
      if (guides.length > 0) {
        console.log(`\nInstalled ${guides.length} guide(s) in config/`);
        for (const g of guides) {
          console.log(`  ${g}`);
        }
      }

      // Install default scheduled scripts
      const schedules = await installSchedules(resolve(targetPath));
      if (schedules.length > 0) {
        console.log(`\nInstalled ${schedules.length} schedule(s) in config/schedules/`);
        for (const s of schedules) {
          console.log(`  ${s}`);
        }
      }

      // Generate card-handling rules from schemas
      const generated = await generateRules(resolve(targetPath));
      if (generated.length > 0) {
        console.log(`\nGenerated ${generated.length} card rules in .claude/rules/`);
      }

      // Set or clear the docid-debug marker
      if (options.docidDebug !== undefined) {
        await setDocIdDebug(resolve(targetPath), options.docidDebug);
      }

      // Generate agent documentation (picks up docid-debug from marker file)
      await generateDocs(resolve(targetPath));
      console.log("Generated agent docs in .callback-box/ and docs/generated/");
      if (options.docidDebug) {
        console.log("  DOCID markers enabled (grep for DOCID: in prompt logs to verify inclusion)");
      }

      if (!isUpdate) {
        console.log("\nRun 'cb status' to see the current state.");
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

/**
 * Migrate legacy guide formats to the new generic guide schema.
 *
 * - news-guide.news-guide.card → news.guide.card
 */
async function migrateGuides(boxRoot: string): Promise<void> {
  const oldPath = join(boxRoot, "config/news-guide.news-guide.card");
  const newPath = join(boxRoot, "config/news.guide.card");

  // Only migrate if old exists and new doesn't
  try {
    await access(newPath);
    return; // New format already exists
  } catch {
    // Good — new doesn't exist yet
  }

  try {
    await access(oldPath);
  } catch {
    return; // Old doesn't exist either, nothing to migrate
  }

  try {
    const content = await readFile(oldPath, "utf-8");
    const root = await parseXml(content, "news-guide.news-guide.card");
    const parsed = parseNewsGuide(root as NewsGuide);

    // Build triage rules from interests and disinterests
    const triageRules: string[] = [];
    for (const interest of parsed.interests) {
      triageRules.push(
        `    <rule confidence="${interest.confidence}" source="${interest.source}"${interest.ref ? ` ref="${interest.ref}"` : ""}>${interest.topic}</rule>`
      );
    }
    for (const dis of parsed.disinterests) {
      triageRules.push(
        `    <rule confidence="${dis.confidence}" source="${dis.source}"${dis.ref ? ` ref="${dis.ref}"` : ""} action="Skip">${dis.topic}</rule>`
      );
    }

    // Build action instructions from preferences
    const prefNotes = parsed.preferences
      .map((p) => `${p.aspect}: ${p.description}`)
      .join("\n      ");

    // Build experiments
    const experimentsXml = parsed.experiments
      .map((e) => {
        const children: string[] = [];
        if (e.hypothesis) children.push(`      <hypothesis>${e.hypothesis}</hypothesis>`);
        if (e.approach) children.push(`      <approach>${e.approach}</approach>`);
        for (const o of e.observations) {
          const refAttr = o.ref ? ` ref="${o.ref}"` : "";
          const dateAttr = o.date ? ` date="${o.date}"` : "";
          children.push(`      <observation${refAttr}${dateAttr}>${o.text}</observation>`);
        }
        if (e.conclusion) children.push(`      <conclusion>${e.conclusion}</conclusion>`);
        const createdAttr = e.createdAt ? ` created-at="${e.createdAt}"` : "";
        const updatedAttr = e.updatedAt ? ` updated-at="${e.updatedAt}"` : "";
        return `    <experiment id="${e.id}" status="${e.status}"${createdAttr}${updatedAttr}>\n${children.join("\n")}\n    </experiment>`;
      })
      .join("\n");

    // Build reactions from reader reactions
    const reactionsXml = parsed.readerReactions
      .map((r) => `    <reaction id="${r.id}" sentiment="${r.sentiment}">${r.text}</reaction>`)
      .join("\n");

    // Build context notes
    const contextXml = parsed.contextNotes
      .map((c) => {
        const addedAttr = c.addedAt ? ` added-at="${c.addedAt}"` : "";
        return `    <context duration="${c.duration}"${addedAttr}>${c.text}</context>`;
      })
      .join("\n");

    const newContent = `<guide version="1.0.0" job-types="news-job">
  <applies-to>Use when processing news items from RSS feeds</applies-to>

  <triage>
${triageRules.join("\n")}
    <default-action action="Write Brief">When no specific rule applies, include if it seems technical and substantive</default-action>
  </triage>

  <actions>
    <action name="Write Brief">
      <when>After processing news items, when there are enough worth covering</when>
      <instructions>Group by theme. Use direct headlines. Include expandos for depth.${prefNotes ? `\n      ${prefNotes}` : ""}</instructions>
    </action>
    <action name="Skip">
      <when>Item doesn't match interests or is low quality</when>
      <instructions>Trash the item with cb trash</instructions>
    </action>
    <action name="Ask User">
      <when>Unsure about disposition or need clarification</when>
      <instructions>Create a question card in box/questions/</instructions>
    </action>
  </actions>

  <experiments>
${experimentsXml}
  </experiments>

  <reactions>
${reactionsXml}
  </reactions>

  <context-notes>
${contextXml}
  </context-notes>
</guide>
`;

    await writeFile(newPath, newContent, "utf-8");
    await rename(oldPath, oldPath + ".bak");
    console.log("\nMigrated config/news-guide.news-guide.card → config/news.guide.card");
    console.log("  Old file backed up as config/news-guide.news-guide.card.bak");
  } catch (err) {
    console.error(`  Warning: failed to migrate news guide: ${(err as Error).message}`);
  }
}
