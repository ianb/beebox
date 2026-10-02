/** Deterministic construction and merging for triage follow-up todos. */
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { isMap, isSeq, parseDocument } from "yaml";
import { parseCardText } from "../card-io.js";
import { splitCardContent } from "../../exports/cards.js";
import { createCardSchemaMap } from "../../schemas.js";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { getBoxTime } from "../../lib/time.js";
import { loadBoxTimezone } from "../box/config.js";
import { invariant } from "../../shared/invariant.js";
import { TodoEntrySchema, TodosFieldSchema, type TodoEntry } from "../../shared/todo-model.js";

const TODO_TEXT = "Review this item and follow up as needed";

export async function getTriageTodoDate(boxRoot: string): Promise<string> {
  const timeZone = await loadBoxTimezone(boxRoot) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(getBoxTime(boxRoot));
  const part = (type: string): string => {
    const value = parts.find((candidate) => candidate.type === type)?.value;
    invariant(value !== undefined, `Missing ${type} in localized todo date`);
    return value;
  };
  return `${part("year")}-${part("month")}-${part("day")}`;
}

interface TriageTodoQuestion {
  destinationRef: string;
  question: string;
  created: string;
}

class TriageTodoQuestionError extends Error {
  constructor() {
    super("Triage todo question must be nonempty");
    this.name = "TriageTodoQuestionError";
  }
}

function createTriageTodo(input: TriageTodoQuestion): TodoEntry & { id: string } {
  const normalizedQuestion = input.question.trim();
  if (!normalizedQuestion) throw new TriageTodoQuestionError();
  const id = createHash("sha256").update(`${input.destinationRef}\n${normalizedQuestion}`).digest("hex").slice(0, 12);
  const todo = TodoEntrySchema.parse({
    id: `triage-${id}`,
    text: `${TODO_TEXT}: “${normalizedQuestion}”`,
    assigned: "agent",
    by: "agent",
    created: input.created,
    "see-also": [{ ref: input.destinationRef }],
  });
  invariant(todo.id !== undefined, "Constructed triage todo must have a stable ID");
  return { ...todo, id: todo.id };
}

/** Existing matching entries win in full, preserving done/recheck state. */
function mergeTriageTodo(existing: TodoEntry[] | undefined, todo: TodoEntry): TodoEntry[] {
  const entries = existing ?? [];
  if (entries.some((entry) => entry.id === todo.id)) return entries;
  return [...entries, todo];
}

class TriageTodoTargetError extends Error {
  constructor({ file, detail }: { file: string; detail: string }) {
    super(`Cannot annotate triage target ${file}: ${detail}`);
    this.name = "TriageTodoTargetError";
  }
}

export async function planTriageTodoAnnotation(input: {
  file: string;
  boxRoot: string;
  destinationRef: string;
  question: string;
  created: string;
}): Promise<{ before: string; after: string; beforeDigest: string; afterDigest: string; todoId: string; changed: boolean }> {
  if (!input.file.endsWith(".card")) throw new TriageTodoTargetError({ file: input.file, detail: "positive follow-up requires a card with frontmatter" });
  const before = await fs.readFile(input.file, "utf8");
  const beforeDigest = createHash("sha256").update(before).digest("hex");
  const schemas = await createCardSchemaMap(input.boxRoot);
  const parsed = parseCardText(before, { source: input.file, schemas });
  const entries = TodosFieldSchema.parse(parsed.fields.todos);
  const todo = createTriageTodo({ destinationRef: input.destinationRef, question: input.question, created: input.created });
  const merged = mergeTriageTodo(entries, todo);
  if (merged === entries) return { before, after: before, beforeDigest, afterDigest: beforeDigest, todoId: todo.id, changed: false };
  const split = splitCardContent(before);
  const document = parseDocument(split.frontmatterText);
  if (document.errors.length > 0 || !isMap(document.contents)) throw new TriageTodoTargetError({ file: input.file, detail: "frontmatter must be a YAML mapping" });
  const existingTodos = document.get("todos", true);
  if (existingTodos === undefined) document.set("todos", merged);
  else if (isSeq(existingTodos)) existingTodos.add(todo);
  else throw new TriageTodoTargetError({ file: input.file, detail: "todos must be a YAML sequence" });
  const yaml = document.toString({ lineWidth: 0 });
  const content = `---\n${yaml.endsWith("\n") ? yaml : `${yaml}\n`}---\n${split.body}`;
  const afterDigest = createHash("sha256").update(content).digest("hex");
  return { before, after: content, beforeDigest, afterDigest, todoId: todo.id, changed: true };
}

/** Validate and atomically annotate an existing card; raw files cannot carry todos. */
export async function annotateTriageCard(input: {
  file: string;
  boxRoot: string;
  destinationRef: string;
  question: string;
  created: string;
}): Promise<{ beforeDigest: string; afterDigest: string; todoId: string; changed: boolean }> {
  const plan = await planTriageTodoAnnotation(input);
  if (plan.changed) await writeFileAtomic(input.file, { content: plan.after });
  return { beforeDigest: plan.beforeDigest, afterDigest: plan.afterDigest, todoId: plan.todoId, changed: plan.changed };
}
