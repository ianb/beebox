/** Caller-owned trial files: validated at read, never silently overwritten. */
import * as fs from "node:fs/promises";
import type { Command } from "commander";
import type { z } from "zod";
import { errorMessage } from "../../../shared/error-guards.js";

export interface OutputOptions { out?: string; overwrite?: boolean; json?: boolean }
export function withInheritedJson(command: Command, options: OutputOptions): OutputOptions {
  return { ...options, json: options.json === true || command.optsWithGlobals<{ json?: boolean }>().json === true };
}
export async function readJson<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await fs.readFile(file, "utf8")));
}
export async function output(value: unknown, options: OutputOptions & { summary: string }): Promise<void> {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (options.out) await fs.writeFile(options.out, serialized, { flag: options.overwrite ? "w" : "wx" });
  if (options.json) process.stdout.write(serialized);
  else console.log(`${options.summary}${options.out ? `\nSaved ${options.out}` : ""}`);
}
export async function cliAction(action: () => Promise<void>): Promise<void> {
  try { await action(); }
  catch (error) { console.error(`Triage: ${errorMessage(error)}`); process.exitCode = 1; }
}
