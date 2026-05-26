import { run } from "../runner.js";

export async function open(url: string): Promise<void> {
  await run(["open", url]);
}
