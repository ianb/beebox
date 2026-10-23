import * as fs from "node:fs/promises";
import type { z } from "zod";
import { errnoCode } from "../shared/error-guards.js";

/**
 * Read a JSON state file whose loss only costs repeated work. A missing file,
 * an unreadable one, invalid JSON, and a wrong shape all give `fresh()`; every
 * case but a missing file warns, prefixed with `label`. `name` is how the
 * warning refers to the file (usually its box-relative path).
 */
export async function loadJsonStateOrFresh<T>(opts: {
  filePath: string;
  name: string;
  label: string;
  schema: z.ZodType<T>;
  fresh: () => T;
}): Promise<T> {
  const { filePath, name, label, schema, fresh } = opts;
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") console.warn(`${label}: could not read ${name}, starting fresh:`, e);
    return fresh();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    console.warn(`${label}: ${name} is not valid JSON, starting fresh:`, e);
    return fresh();
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`${label}: ${name} did not match the expected shape, starting fresh`);
    return fresh();
  }
  return parsed.data;
}
