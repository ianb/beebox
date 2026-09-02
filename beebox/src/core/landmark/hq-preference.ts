import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Document, parseDocument } from "yaml";
import { splitCardContent } from "../../cards/frontmatter.js";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { withCardLock } from "../../lib/card-lock.js";
import { stageAndCommitPaths } from "../../lib/git.js";

export type LandmarkHqPreference = "inherit" | "on" | "off";

class LandmarkMissingError extends Error {
  constructor() {
    super("This chat has no landmark.");
    this.name = "LandmarkMissingError";
  }
}

class LandmarkFrontmatterMissingError extends Error {
  constructor() {
    super("The landmark has no readable frontmatter.");
    this.name = "LandmarkFrontmatterMissingError";
  }
}

class LandmarkFrontmatterMalformedError extends Error {
  constructor() {
    super("The landmark frontmatter is malformed.");
    this.name = "LandmarkFrontmatterMalformedError";
  }
}

function render(doc: Document, body: string): string {
  const yaml = doc.toString({ lineWidth: 0 });
  return `---\n${yaml.endsWith("\n") ? yaml : `${yaml}\n`}---\n${body}`;
}

/** Change only the HQ seed on the one canonical landmark card in a directory. */
export async function setLandmarkHqPreference(options: {
  boxRoot: string;
  contextDir: string;
  value: LandmarkHqPreference;
}): Promise<{ path: string; commitWarning: string | null }> {
  const entries = await fs.readdir(path.join(options.boxRoot, options.contextDir));
  const landmarkName = entries.filter((name) => name.endsWith(".landmark.card")).toSorted()[0];
  if (landmarkName === undefined) throw new LandmarkMissingError();
  const relativePath = options.contextDir === "" ? landmarkName : `${options.contextDir}/${landmarkName}`;
  const absolutePath = path.join(options.boxRoot, relativePath);

  await withCardLock(absolutePath, async () => {
    const content = await fs.readFile(absolutePath, "utf-8");
    const split = splitCardContent(content);
    if (!split.hasFrontmatter) throw new LandmarkFrontmatterMissingError();
    const doc = split.frontmatterText.trim() === "" ? new Document({}) : parseDocument(split.frontmatterText);
    if (doc.errors.length > 0) throw new LandmarkFrontmatterMalformedError();
    if (options.value === "inherit") {
      doc.deleteIn(["navigation", "chat-app", "hq-dictation"]);
    } else {
      doc.setIn(["navigation", "chat-app", "hq-dictation"], options.value);
    }
    await writeFileAtomic(absolutePath, { content: render(doc, split.body) });
  });

  let commitWarning: string | null = null;
  try {
    await stageAndCommitPaths(options.boxRoot, {
      paths: [relativePath],
      message: `Set landmark HQ dictation: ${options.value}`,
    });
  } catch (_error) {
    commitWarning = "Saved, but the Git commit failed.";
  }
  return { path: relativePath, commitWarning };
}
