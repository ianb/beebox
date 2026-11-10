/**
 * The brief `bbx engine intentions check` prints for the `refresh-intentions`
 * agent: per listed place, the landmark card, what changed since its last
 * review, its open todos, the questions about its cards, and its most
 * recently changed cards. The rules the agent follows are in the procedure's
 * prompt (`templates/procedures/refresh-intentions.procedure.card`); this is
 * the material.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { parseFrontmatterObject } from "../../../exports/cards.js";
import { extractRefs } from "../../../cards/extract-refs.js";
import { BOX_DIRS } from "../../../lib/paths/core.js";
import { questionState } from "../../../schemas/question.js";
import { titleFromFilename } from "../../../shared/card-name.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { resolveContainedRef } from "../../ref-exists.js";
import { formatTodoLocation } from "../../todo/collect-types.js";
import { runTodoQuery } from "../../todo/query.js";
import { ownsPath, recentlyChanged, type Place } from "../places.js";

export interface ListedPlace {
  place: Place;
  reason: string;
  /** Paths under the place changed since its last review, newest first. */
  changed: string[];
}

interface OpenQuestion {
  path: string;
  prompt: string;
  /** Box-relative paths of the cards the question refers to. */
  targets: string[];
}

const MAX_CHANGED = 30;
const MAX_TODOS = 20;
const RECENT_CARDS = 10;
/** How many of the place's latest commits to read for its recently changed cards. */
const RECENT_COMMITS = 100;

const HEADER = `# Places to review

Each place below changed since its intention was last reviewed (or was never
reviewed). For each: its landmark card, the paths changed since the last
review, its open todos, questions that refer to its cards, and its most
recently changed cards.`;

function capped(lines: string[], max: number): string {
  if (lines.length === 0) return "(none)";
  const shown = lines.slice(0, max).join("\n");
  return lines.length > max ? `${shown}\n- … and ${String(lines.length - max)} more` : shown;
}

/** Pending and put-away questions, with the cards each refers to. */
async function loadOpenQuestions(boxRoot: string): Promise<OpenQuestion[]> {
  const files = await glob("**/*.question.card", { cwd: path.join(boxRoot, BOX_DIRS.questions), nodir: true, posix: true });
  const out: OpenQuestion[] = [];
  for (const file of files.toSorted()) {
    const relPath = `${BOX_DIRS.questions}/${file}`;
    const fields = parseFrontmatterObject(await fs.readFile(path.join(boxRoot, relPath), "utf-8"));
    if (fields === null) continue; // unreadable frontmatter: `bbx validate` reports it
    const state = questionState(fields);
    if (state !== "pending" && state !== "dismissed") continue;
    const prompt = typeof fields.prompt === "string" ? fields.prompt : "(no prompt)";
    const targets = extractRefs(fields)
      .map(({ ref }) => resolveContainedRef({ boxRoot, fromPath: path.join(boxRoot, relPath), ref }))
      .filter((target) => target !== null);
    out.push({ path: relPath, prompt, targets });
  }
  return out;
}

async function openTodos(boxRoot: string, place: Place): Promise<string[]> {
  const result = await runTodoQuery(boxRoot, {
    query: { here: place.dir === "." ? "" : place.dir, includeReferring: false, params: { status: ["open"], scope: "all" } },
    since: null,
  });
  const lines: string[] = [];
  for (const group of result.groups) {
    for (const row of group.rows) {
      for (const item of row.items) {
        if (item.matching && ownsPath(place, item.path)) lines.push(`- ${formatTodoLocation(item)}: ${item.text}`);
      }
    }
  }
  return lines;
}

async function cardTitle(boxRoot: string, relPath: string): Promise<string | null> {
  let content: string;
  try {
    content = await fs.readFile(path.join(boxRoot, relPath), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null; // deleted or moved since that commit
    throw e;
  }
  const title = parseFrontmatterObject(content)?.title;
  return typeof title === "string" && title.trim() !== "" ? title.trim() : titleFromFilename(relPath);
}

async function recentCards(boxRoot: string, place: Place): Promise<string[]> {
  const paths = await recentlyChanged(boxRoot, { place, commits: RECENT_COMMITS });
  const lines: string[] = [];
  for (const relPath of paths) {
    if (lines.length >= RECENT_CARDS) break;
    if (!relPath.endsWith(".card") || relPath === place.landmark) continue;
    const title = await cardTitle(boxRoot, relPath);
    if (title !== null) lines.push(`- ${relPath}: ${title}`);
  }
  return lines;
}

async function renderPlace(boxRoot: string, { listed, questions }: { listed: ListedPlace; questions: OpenQuestion[] }): Promise<string> {
  const { place, reason, changed } = listed;
  const landmark = await fs.readFile(path.join(boxRoot, place.landmark), "utf-8");
  const asked = questions
    .filter((q) => q.targets.some((target) => ownsPath(place, target)))
    .map((q) => `- ${q.path}: ${q.prompt}`);
  return [
    `## ${place.landmark} (${reason})`,
    `### Landmark card\n\n\`\`\`\`markdown\n${landmark.trimEnd()}\n\`\`\`\``,
    `### Changed since the last review\n\n${capped(changed.map((p) => `- ${p}`), MAX_CHANGED)}`,
    `### Open todos\n\n${capped(await openTodos(boxRoot, place), MAX_TODOS)}`,
    `### Questions about cards here\n\n${capped(asked, MAX_TODOS)}`,
    `### Most recently changed cards\n\n${capped(await recentCards(boxRoot, place), RECENT_CARDS)}`,
  ].join("\n\n");
}

export async function renderBrief(boxRoot: string, listed: readonly ListedPlace[]): Promise<string> {
  const questions = await loadOpenQuestions(boxRoot);
  const sections: string[] = [HEADER];
  for (const entry of listed) sections.push(await renderPlace(boxRoot, { listed: entry, questions }));
  return `${sections.join("\n\n")}\n`;
}
