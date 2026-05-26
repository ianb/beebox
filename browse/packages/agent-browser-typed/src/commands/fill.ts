import { run } from "../runner.js";

export async function fill(selector: string, text: string): Promise<void> {
  await run(["fill", selector, text]);
}
