import { run } from "../runner.js";

export async function click(selector: string, options: { newTab?: boolean }): Promise<void> {
  const args: string[] = ["click", selector];
  if (options.newTab === true) args.push("--new-tab");
  await run(args);
}
