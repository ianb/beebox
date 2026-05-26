import { run } from "../runner.js";

export async function press(key: string): Promise<void> {
  await run(["press", key]);
}
