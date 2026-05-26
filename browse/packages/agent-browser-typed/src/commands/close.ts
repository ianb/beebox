import { run } from "../runner.js";

export async function close(options: { all?: boolean }): Promise<void> {
  const args: string[] = ["close"];
  if (options.all === true) args.push("--all");
  await run(args);
}
